//! 本机来源授权、可恢复批次与跨进程文件使用保护。

use crate::{FolioDatabase, StorageError};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    fs::{File, OpenOptions},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

pub fn new_operation_id() -> Result<String, StorageError> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(StorageError::RandomId)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSource {
    pub id: String,
    pub platform: String,
    pub locator: String,
    pub display_name: String,
    pub snapshot_path: String,
    pub available: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OperationStatus {
    Pending,
    Running,
    AwaitingDecision,
    Succeeded,
    Failed,
    Cancelled,
    Skipped,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationItem {
    pub id: String,
    pub source: String,
    pub name: String,
    pub action: String,
    pub stage: String,
    pub status: OperationStatus,
    pub fingerprint: Option<String>,
    pub destination: Option<String>,
    pub error_key: Option<String>,
    #[serde(default)]
    pub analysis: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationBatch {
    pub id: String,
    pub items: Vec<OperationItem>,
    pub cancel_requested: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformFontOperation {
    pub id: String,
    pub source_path: String,
    pub installed_path: String,
    pub fingerprint: String,
    pub registry_name: Option<String>,
    pub persistent: bool,
    pub registered: bool,
}

/// 文件锁由内核随进程退出释放；等待网络或用户决策不占用 SQLite 事务。
#[derive(Debug)]
pub struct ResourceGuard(File);
impl ResourceGuard {
    pub fn acquire(database: &Path, resource: &str, exclusive: bool) -> Result<Self, StorageError> {
        let parent = database.parent().ok_or(StorageError::InvalidOperation)?;
        let directory = parent.join(".folio-locks");
        std::fs::create_dir_all(&directory)?;
        let key = blake3::hash(resource.as_bytes()).to_hex().to_string();
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(directory.join(key))?;
        let result = if exclusive {
            fs2::FileExt::try_lock_exclusive(&file)
        } else {
            fs2::FileExt::try_lock_shared(&file)
        };
        result.map_err(|error| {
            // Windows 锁冲突未必映射为 WouldBlock，按 fs2 的平台错误码识别。
            if error.raw_os_error() == fs2::lock_contended_error().raw_os_error() {
                StorageError::ResourceBusy
            } else {
                error.into()
            }
        })?;
        Ok(Self(file))
    }
}
impl Drop for ResourceGuard {
    fn drop(&mut self) {
        let _ = fs2::FileExt::unlock(&self.0);
    }
}

impl FolioDatabase {
    /// 切换应用容器时保留来源标识、收藏和设备策略，仅重定位本机路径。
    pub fn relocate_local_directory(&mut self, old: &Path, new: &Path) -> Result<(), StorageError> {
        use crate::path_codec::{decode_path, encode_path, PathPlatform};
        if !old.is_absolute() || !new.is_absolute() || old == new {
            return Err(StorageError::InvalidOperation);
        }
        let canonical_old = old.canonicalize().unwrap_or_else(|_| old.to_path_buf());
        let checked: String = self
            .conn
            .query_row("PRAGMA quick_check", [], |row| row.get(0))?;
        if checked != "ok" {
            return Err(StorageError::InvalidOperation);
        }
        let tx = self.conn.transaction()?;
        for table in ["library_roots", "source_files", "font_source_policies"] {
            let rows = {
                let mut statement = tx.prepare(&format!(
                    "SELECT DISTINCT path_platform,path_bytes,display_path FROM {table}"
                ))?;
                let values = statement
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, Vec<u8>>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                values
            };
            for (platform, bytes, display) in rows {
                let path = decode_path(PathPlatform::parse(&platform)?, &bytes, &display)?.path;
                if let Ok(relative) = path
                    .strip_prefix(old)
                    .or_else(|_| path.strip_prefix(&canonical_old))
                {
                    let encoded = encode_path(&new.join(relative));
                    tx.execute(&format!("UPDATE {table} SET path_platform=?1,path_bytes=?2,display_path=?3 WHERE path_platform=?4 AND path_bytes=?5"),params![encoded.platform.as_str(),encoded.bytes,encoded.display,platform,bytes])?;
                }
            }
        }
        let paths = {
            let mut statement = tx.prepare(
                "SELECT fingerprint,local_path FROM sync_assets WHERE local_path IS NOT NULL",
            )?;
            let values = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            values
        };
        for (fingerprint, path) in paths {
            if let Ok(relative) = Path::new(&path)
                .strip_prefix(old)
                .or_else(|_| Path::new(&path).strip_prefix(&canonical_old))
            {
                tx.execute(
                    "UPDATE sync_assets SET local_path=?1 WHERE fingerprint=?2",
                    params![new.join(relative).to_string_lossy(), fingerprint],
                )?;
            }
        }
        let policies = {
            let mut statement=tx.prepare("SELECT fingerprint,source_platform,source_bytes FROM font_file_policies WHERE source_platform IS NOT NULL AND source_bytes IS NOT NULL")?;
            let values = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            values
        };
        for (fingerprint, platform, bytes) in policies {
            let path = decode_path(PathPlatform::parse(&platform)?, &bytes, "")?.path;
            if let Ok(relative) = path
                .strip_prefix(old)
                .or_else(|_| path.strip_prefix(&canonical_old))
            {
                let encoded = encode_path(&new.join(relative));
                tx.execute("UPDATE font_file_policies SET source_platform=?1,source_bytes=?2 WHERE fingerprint=?3",params![encoded.platform.as_str(),encoded.bytes,fingerprint])?;
            }
        }
        let sources = {
            let mut statement = tx.prepare("SELECT id,snapshot_path FROM local_sources")?;
            let values = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            values
        };
        for (id, path) in sources {
            if let Ok(relative) = Path::new(&path)
                .strip_prefix(old)
                .or_else(|_| Path::new(&path).strip_prefix(&canonical_old))
            {
                tx.execute(
                    "UPDATE local_sources SET snapshot_path=?1 WHERE id=?2",
                    params![new.join(relative).to_string_lossy(), id],
                )?;
            }
        }
        tx.commit()?;
        self.refresh(crate::RefreshMode::Incremental)?;
        Ok(())
    }
    pub fn save_external_source(&self, source: &ExternalSource) -> Result<(), StorageError> {
        if source.id.is_empty()
            || source.locator.is_empty()
            || !matches!(source.platform.as_str(), "android" | "ios")
            || !Path::new(&source.snapshot_path).is_absolute()
        {
            return Err(StorageError::InvalidOperation);
        }
        self.conn.execute("INSERT INTO local_sources(id,platform,locator,display_name,snapshot_path,available) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET locator=excluded.locator,display_name=excluded.display_name,snapshot_path=excluded.snapshot_path,available=excluded.available",
            params![source.id,source.platform,source.locator,source.display_name,source.snapshot_path,source.available])?;
        Ok(())
    }
    pub fn external_sources(&self) -> Result<Vec<ExternalSource>, StorageError> {
        let mut statement = self.conn.prepare("SELECT id,platform,locator,display_name,snapshot_path,available FROM local_sources ORDER BY id")?;
        let rows = statement.query_map([], |row| {
            Ok(ExternalSource {
                id: row.get(0)?,
                platform: row.get(1)?,
                locator: row.get(2)?,
                display_name: row.get(3)?,
                snapshot_path: row.get(4)?,
                available: row.get(5)?,
            })
        })?;
        rows.collect::<Result<_, _>>().map_err(Into::into)
    }
    pub fn remove_external_source(&self, id: &str) -> Result<(), StorageError> {
        let source = self
            .external_sources()?
            .into_iter()
            .find(|value| value.id == id)
            .ok_or(StorageError::InvalidOperation)?;
        if let Some(root) = self
            .list_roots()?
            .into_iter()
            .find(|root| root.path == Path::new(&source.snapshot_path))
        {
            self.conn.execute(
                "DELETE FROM library_roots WHERE id=?1",
                [root.id.as_bytes().as_slice()],
            )?;
        }
        self.conn
            .execute("DELETE FROM local_sources WHERE id=?1", [id])?;
        self.remove_sync_metadata(&format!("local_source:{id}:reason"))?;
        Ok(())
    }
    pub fn save_operation_batch(&self, batch: &OperationBatch) -> Result<(), StorageError> {
        if batch.id.is_empty() || batch.items.len() > 10_000 {
            return Err(StorageError::InvalidOperation);
        }
        let payload = serde_json::to_string(batch)?;
        let time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| StorageError::InvalidTimestamp)?
            .as_millis()
            .min(i64::MAX as u128) as i64;
        self.conn.execute("INSERT INTO operation_batches(id,payload,updated_at_ms) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at_ms=excluded.updated_at_ms", params![batch.id,payload,time])?;
        Ok(())
    }
    pub fn operation_batch(&self, id: &str) -> Result<Option<OperationBatch>, StorageError> {
        let payload: Option<String> = self
            .conn
            .query_row(
                "SELECT payload FROM operation_batches WHERE id=?1",
                [id],
                |row| row.get(0),
            )
            .optional()?;
        payload
            .map(|value| serde_json::from_str(&value).map_err(Into::into))
            .transpose()
    }
    pub fn operation_batches(&self) -> Result<Vec<OperationBatch>, StorageError> {
        let mut statement = self
            .conn
            .prepare("SELECT payload FROM operation_batches ORDER BY updated_at_ms DESC,id")?;
        let values = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        values
            .into_iter()
            .map(|value| serde_json::from_str(&value).map_err(Into::into))
            .collect()
    }
    pub fn save_platform_font_operation(
        &self,
        operation: &PlatformFontOperation,
    ) -> Result<(), StorageError> {
        if operation.id.is_empty() {
            return Err(StorageError::InvalidOperation);
        }
        self.conn.execute("INSERT INTO platform_font_operations(id,payload) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", params![operation.id,serde_json::to_string(operation)?])?;
        Ok(())
    }
    pub fn platform_font_operations(&self) -> Result<Vec<PlatformFontOperation>, StorageError> {
        let mut statement = self
            .conn
            .prepare("SELECT payload FROM platform_font_operations ORDER BY id")?;
        let values = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        values
            .into_iter()
            .map(|value| serde_json::from_str(&value).map_err(Into::into))
            .collect()
    }
    pub fn remove_platform_font_operation(&self, id: &str) -> Result<(), StorageError> {
        self.conn
            .execute("DELETE FROM platform_font_operations WHERE id=?1", [id])?;
        Ok(())
    }
    pub fn reference_path_available(&self, path: &Path) -> Result<bool, StorageError> {
        Ok(self
            .external_sources()?
            .iter()
            .all(|source| !path.starts_with(&source.snapshot_path) || source.available))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_state_survives_cache_rebuild_and_does_not_create_sync_events() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("library.sqlite");
        let db = FolioDatabase::open(&path).unwrap();
        let source = ExternalSource {
            id: "one".into(),
            platform: "android".into(),
            locator: "content://test/font".into(),
            display_name: "Font".into(),
            snapshot_path: directory
                .path()
                .join("ReferenceCache/one")
                .to_string_lossy()
                .into_owned(),
            available: false,
        };
        db.save_external_source(&source).unwrap();
        let batch = OperationBatch {
            id: "batch".into(),
            items: vec![OperationItem {
                id: "item".into(),
                source: source.id.clone(),
                name: "font.ttf".into(),
                action: "collectActivate".into(),
                stage: "activate".into(),
                status: OperationStatus::Failed,
                fingerprint: Some("ab".repeat(32)),
                destination: Some("managed.ttf".into()),
                analysis: None,
                error_key: Some("workflow.error.operationFailed".into()),
            }],
            cancel_requested: false,
        };
        db.save_operation_batch(&batch).unwrap();
        db.clear_catalog_cache().unwrap();
        drop(db);
        let db = FolioDatabase::open(&path).unwrap();
        assert_eq!(
            db.operation_batch("batch").unwrap().unwrap().items[0].stage,
            "activate"
        );
        assert_eq!(db.external_sources().unwrap()[0].locator, source.locator);
        assert!(db.list_sync_events().unwrap().is_empty());
        assert!(!db
            .reference_path_available(Path::new(&source.snapshot_path).join("font.ttf").as_path())
            .unwrap());
    }
    #[test]
    fn container_relocation_preserves_root_identity_favorites_and_source_protection() {
        let temp = tempfile::tempdir().unwrap();
        let old = temp.path().join("old");
        let new = temp.path().join("new");
        std::fs::create_dir_all(old.join("fonts")).unwrap();
        std::fs::create_dir_all(new.join("fonts")).unwrap();
        let sample =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/fonts/Lato-Regular.ttf");
        std::fs::copy(&sample, old.join("fonts/one.ttf")).unwrap();
        std::fs::copy(&sample, new.join("fonts/one.ttf")).unwrap();
        let mut db = FolioDatabase::open(new.join("folio.sqlite")).unwrap();
        let added = db.add_root(old.join("fonts"), true).unwrap();
        let root = match added {
            crate::AddRootOutcome::Created(root) | crate::AddRootOutcome::Existing(root) => root,
        };
        let face = db
            .refresh(crate::RefreshMode::Incremental)
            .unwrap()
            .catalog
            .faces()
            .next()
            .unwrap()
            .identity_id;
        db.set_favorite(face, true).unwrap();
        db.relocate_local_directory(&old, &new).unwrap();
        assert_eq!(db.list_roots().unwrap()[0].id, root.id);
        assert_eq!(db.list_roots().unwrap()[0].path, new.join("fonts"));
        assert!(
            matches!(db.add_root(new.join("fonts"),true).unwrap(),crate::AddRootOutcome::Existing(value) if value.id==root.id)
        );
        assert_eq!(
            db.readable_font_files().unwrap().keys().next().unwrap(),
            &new.join("fonts/one.ttf").canonicalize().unwrap()
        );
        assert!(db
            .library_state_snapshot()
            .unwrap()
            .favorites
            .contains(&face));
        db.relocate_local_directory(&old, &new).unwrap();
        assert_eq!(db.list_roots().unwrap().len(), 1);
    }
    #[test]
    fn read_leases_prevent_cleanup_until_all_readers_close() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("library.sqlite");
        let first = ResourceGuard::acquire(&path, "file:one", false).unwrap();
        let second = ResourceGuard::acquire(&path, "file:one", false).unwrap();
        assert!(matches!(
            ResourceGuard::acquire(&path, "file:one", true),
            Err(StorageError::ResourceBusy)
        ));
        drop(first);
        assert!(ResourceGuard::acquire(&path, "file:one", true).is_err());
        drop(second);
        let exclusive = ResourceGuard::acquire(&path, "file:one", true).unwrap();
        assert!(matches!(
            ResourceGuard::acquire(&path, "file:one", false),
            Err(StorageError::ResourceBusy)
        ));
        assert!(ResourceGuard::acquire(&path, "file:other", true).is_ok());
        drop(exclusive);
        assert!(ResourceGuard::acquire(&path, "file:one", false).is_ok());
    }
}
