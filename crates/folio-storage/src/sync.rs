//! WebDAV 同步的设备本地记录；远端协议由 folio-sync 独立定义。

use folio_core::{normalize_search, Collection, FontIdentityId, SmartFolder};
use rusqlite::{params, OptionalExtension, Transaction};

use crate::{FolioDatabase, StorageError};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredSyncEvent {
    pub id: String,
    pub device_id: String,
    pub sequence: i64,
    pub payload: String,
    pub published: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredSyncAsset {
    pub fingerprint: String,
    pub filename: String,
    pub extension: String,
    pub local_path: Option<String>,
    pub remote_payload: String,
    pub cloud_only: bool,
    pub deleted: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredSyncConflict {
    pub id: String,
    pub kind: String,
    pub payload: String,
}

fn random_device_id() -> Result<String, StorageError> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(StorageError::RandomId)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn ensure_device_id(tx: &Transaction<'_>) -> Result<String, StorageError> {
    tx.execute(
        "INSERT OR IGNORE INTO sync_metadata(key,value) VALUES('device_id',?1)",
        [random_device_id()?],
    )?;
    Ok(tx.query_row(
        "SELECT value FROM sync_metadata WHERE key='device_id'",
        [],
        |row| row.get(0),
    )?)
}

fn next_local_sequence(tx: &Transaction<'_>, device_id: &str) -> Result<i64, StorageError> {
    let saved = tx
        .query_row(
            "SELECT value FROM sync_metadata WHERE key='next_sequence'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(1)
        .max(1);
    Ok(saved.max(sequence_after_events(tx, device_id)?))
}

fn sequence_after_events(tx: &Transaction<'_>, device_id: &str) -> Result<i64, StorageError> {
    let greatest: Option<i64> = tx.query_row(
        "SELECT MAX(sequence) FROM sync_events WHERE device_id=?1",
        [device_id],
        |row| row.get(0),
    )?;
    Ok(greatest
        .map(|value| {
            value
                .checked_add(1)
                .ok_or(StorageError::SyncSequenceExhausted)
        })
        .transpose()?
        .unwrap_or(1))
}

impl FolioDatabase {
    pub fn sync_metadata(&self, key: &str) -> Result<Option<String>, StorageError> {
        Ok(self
            .conn
            .query_row(
                "SELECT value FROM sync_metadata WHERE key=?1",
                [key],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn set_sync_metadata(&self, key: &str, value: &str) -> Result<(), StorageError> {
        self.conn.execute(
            "INSERT INTO sync_metadata(key,value) VALUES(?1,?2) \
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn remove_sync_metadata(&self, key: &str) -> Result<(), StorageError> {
        self.conn
            .execute("DELETE FROM sync_metadata WHERE key=?1", [key])?;
        Ok(())
    }

    pub fn sync_device_id(&self) -> Result<String, StorageError> {
        self.conn.execute(
            "INSERT OR IGNORE INTO sync_metadata(key,value) VALUES('device_id',?1)",
            [random_device_id()?],
        )?;
        Ok(self.conn.query_row(
            "SELECT value FROM sync_metadata WHERE key='device_id'",
            [],
            |row| row.get(0),
        )?)
    }

    pub fn reset_sync_remote_state(&mut self) -> Result<(), StorageError> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM sync_events", [])?;
        tx.execute("DELETE FROM sync_assets", [])?;
        tx.execute("DELETE FROM sync_remote_cursors", [])?;
        tx.execute("DELETE FROM sync_conflicts", [])?;
        tx.execute("DELETE FROM sync_metadata WHERE key IN ('device_id','user_baseline','next_sequence','last_successful_sync_ms')", [])?;
        tx.commit()?;
        Ok(())
    }

    pub fn append_sync_event(&mut self, payload: &str) -> Result<StoredSyncEvent, StorageError> {
        let tx = self.conn.transaction()?;
        let device_id = ensure_device_id(&tx)?;
        let sequence = next_local_sequence(&tx, &device_id)?;
        let following = sequence
            .checked_add(1)
            .ok_or(StorageError::SyncSequenceExhausted)?;
        tx.execute(
            "INSERT INTO sync_metadata(key,value) VALUES('next_sequence',?1) \
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [following.to_string()],
        )?;
        let event = StoredSyncEvent {
            id: format!("{device_id}-{sequence:020}"),
            device_id,
            sequence,
            payload: payload.to_owned(),
            published: false,
        };
        tx.execute(
            "INSERT INTO sync_events(id,device_id,sequence,payload,published) VALUES(?1,?2,?3,?4,0)",
            params![event.id, event.device_id, event.sequence, event.payload],
        )?;
        tx.commit()?;
        Ok(event)
    }

    /// 根据已保存事件重建同步序号与连续接收游标。
    pub fn rebuild_sync_indexes(&mut self) -> Result<(), StorageError> {
        let tx = self.conn.transaction()?;
        let device_id = ensure_device_id(&tx)?;
        let next = sequence_after_events(&tx, &device_id)?;
        tx.execute(
            "INSERT INTO sync_metadata(key,value) VALUES('next_sequence',?1) \
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [next.to_string()],
        )?;
        tx.execute("DELETE FROM sync_remote_cursors", [])?;
        let mut statement =
            tx.prepare("SELECT device_id,sequence FROM sync_events ORDER BY device_id,sequence")?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        let mut current_device = String::new();
        let mut cursor = 0_i64;
        for row in rows {
            let (device, sequence) = row?;
            if device != current_device {
                if !current_device.is_empty() && cursor > 0 {
                    tx.execute(
                        "INSERT INTO sync_remote_cursors(device_id,last_sequence) VALUES(?1,?2)",
                        params![current_device, cursor],
                    )?;
                }
                current_device = device;
                cursor = 0;
            }
            if cursor.checked_add(1) == Some(sequence) {
                cursor += 1;
            }
        }
        if !current_device.is_empty() && cursor > 0 {
            tx.execute(
                "INSERT INTO sync_remote_cursors(device_id,last_sequence) VALUES(?1,?2)",
                params![current_device, cursor],
            )?;
        }
        drop(statement);
        tx.commit()?;
        Ok(())
    }

    pub fn insert_remote_sync_event(&self, event: &StoredSyncEvent) -> Result<bool, StorageError> {
        let inserted = self.conn.execute(
            "INSERT OR IGNORE INTO sync_events(id,device_id,sequence,payload,published) \
             VALUES(?1,?2,?3,?4,1)",
            params![event.id, event.device_id, event.sequence, event.payload],
        )? != 0;
        if inserted {
            let mut cursor = self.sync_remote_cursor(&event.device_id)?;
            loop {
                let next: Option<i64> = self
                    .conn
                    .query_row(
                        "SELECT sequence FROM sync_events WHERE device_id=?1 AND sequence=?2",
                        params![event.device_id, cursor + 1],
                        |row| row.get(0),
                    )
                    .optional()?;
                if next.is_none() {
                    break;
                }
                cursor += 1;
            }
            self.conn.execute(
                "INSERT INTO sync_remote_cursors(device_id,last_sequence) VALUES(?1,?2) \
                 ON CONFLICT(device_id) DO UPDATE SET last_sequence=excluded.last_sequence",
                params![event.device_id, cursor],
            )?;
        }
        Ok(inserted)
    }

    pub fn sync_remote_cursor(&self, device_id: &str) -> Result<i64, StorageError> {
        Ok(self
            .conn
            .query_row(
                "SELECT last_sequence FROM sync_remote_cursors WHERE device_id=?1",
                [device_id],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or(0))
    }

    pub fn mark_sync_event_published(&self, id: &str) -> Result<(), StorageError> {
        self.conn
            .execute("UPDATE sync_events SET published=1 WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn list_sync_events(&self) -> Result<Vec<StoredSyncEvent>, StorageError> {
        let mut stmt = self.conn.prepare(
            "SELECT id,device_id,sequence,payload,published FROM sync_events ORDER BY device_id,sequence",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(StoredSyncEvent {
                id: row.get(0)?,
                device_id: row.get(1)?,
                sequence: row.get(2)?,
                payload: row.get(3)?,
                published: row.get(4)?,
            })
        })?;
        rows.collect::<Result<_, _>>().map_err(Into::into)
    }

    pub fn upsert_sync_asset(&self, asset: &StoredSyncAsset) -> Result<(), StorageError> {
        self.conn.execute(
            "INSERT INTO sync_assets(fingerprint,filename,extension,local_path,remote_payload,cloud_only,deleted) \
             VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(fingerprint) DO UPDATE SET \
             filename=excluded.filename,extension=excluded.extension, \
             local_path=excluded.local_path,remote_payload=excluded.remote_payload, \
             cloud_only=excluded.cloud_only,deleted=excluded.deleted",
            params![asset.fingerprint, asset.filename, asset.extension, asset.local_path,
                asset.remote_payload, asset.cloud_only, asset.deleted],
        )?;
        Ok(())
    }

    pub fn list_sync_assets(&self) -> Result<Vec<StoredSyncAsset>, StorageError> {
        let mut stmt = self.conn.prepare(
            "SELECT fingerprint,filename,extension,local_path,remote_payload,cloud_only,deleted \
             FROM sync_assets ORDER BY fingerprint",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(StoredSyncAsset {
                fingerprint: row.get(0)?,
                filename: row.get(1)?,
                extension: row.get(2)?,
                local_path: row.get(3)?,
                remote_payload: row.get(4)?,
                cloud_only: row.get(5)?,
                deleted: row.get(6)?,
            })
        })?;
        rows.collect::<Result<_, _>>().map_err(Into::into)
    }

    pub fn insert_sync_conflict(&self, conflict: &StoredSyncConflict) -> Result<(), StorageError> {
        self.conn.execute(
            "INSERT INTO sync_conflicts(id,kind,payload,resolved) VALUES(?1,?2,?3,0) \
             ON CONFLICT(id) DO NOTHING",
            params![conflict.id, conflict.kind, conflict.payload],
        )?;
        Ok(())
    }

    pub fn list_sync_conflicts(&self) -> Result<Vec<StoredSyncConflict>, StorageError> {
        let mut stmt = self.conn.prepare(
            "SELECT id,kind,payload FROM sync_conflicts WHERE resolved=0 ORDER BY kind,id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(StoredSyncConflict {
                id: row.get(0)?,
                kind: row.get(1)?,
                payload: row.get(2)?,
            })
        })?;
        rows.collect::<Result<_, _>>().map_err(Into::into)
    }

    pub fn resolve_sync_conflict(&self, id: &str) -> Result<(), StorageError> {
        self.conn
            .execute("UPDATE sync_conflicts SET resolved=1 WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn upsert_remote_smart_folder(&self, folder: &SmartFolder) -> Result<(), StorageError> {
        let key = normalize_search(&folder.name);
        if key.is_empty() {
            return Err(StorageError::InvalidSmartFolderName);
        }
        serde_json::from_str::<serde_json::Value>(&folder.query_json)?;
        self.conn.execute(
            "INSERT INTO smart_folders(id,name,normalized_name,query_json,created_at_ns,updated_at_ns,icon,color) \
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(id) DO UPDATE SET \
             name=excluded.name,normalized_name=excluded.normalized_name,query_json=excluded.query_json, \
             icon=excluded.icon,color=excluded.color, \
             updated_at_ns=excluded.updated_at_ns",
            params![folder.id.as_bytes().as_slice(), folder.name, key, folder.query_json,
                folder.created_at_ns, folder.updated_at_ns, folder.icon.key(), folder.color.key()],
        ).map_err(|error| {
            if matches!(&error, rusqlite::Error::SqliteFailure(code, _)
                if code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE) {
                StorageError::SmartFolderNameConflict
            } else {
                error.into()
            }
        })?;
        Ok(())
    }

    pub fn upsert_remote_collection(&self, collection: &Collection) -> Result<(), StorageError> {
        let key = normalize_search(&collection.name);
        if key.is_empty() {
            return Err(StorageError::InvalidCollectionName);
        }
        self.conn.execute(
            "INSERT INTO collections(id,name,normalized_name,created_at_ns,updated_at_ns,icon,color) \
             VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO UPDATE SET \
             name=excluded.name,normalized_name=excluded.normalized_name, \
             updated_at_ns=excluded.updated_at_ns,icon=excluded.icon,color=excluded.color",
            params![collection.id.as_bytes().as_slice(), collection.name, key,
                collection.created_at_ns, collection.updated_at_ns,
                collection.icon.key(), collection.color.key()],
        ).map_err(|error| {
            if matches!(&error, rusqlite::Error::SqliteFailure(code, _)
                if code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE) {
                StorageError::CollectionNameConflict
            } else {
                error.into()
            }
        })?;
        Ok(())
    }

    pub fn set_recent_at(&self, id: FontIdentityId, timestamp: i64) -> Result<(), StorageError> {
        self.conn.execute(
            "INSERT INTO recent_fonts(identity_id,last_accessed_at_ns) VALUES(?1,?2) \
             ON CONFLICT(identity_id) DO UPDATE SET last_accessed_at_ns=max(last_accessed_at_ns,excluded.last_accessed_at_ns)",
            params![id.as_bytes().as_slice(), timestamp],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_cursor_advances_only_across_contiguous_events() {
        let dir = tempfile::tempdir().unwrap();
        let db = FolioDatabase::open(dir.path().join("folio.sqlite")).unwrap();
        let device_id = "aa".repeat(16);
        let event = |sequence| StoredSyncEvent {
            id: format!("{device_id}-{sequence:020}"),
            device_id: device_id.clone(),
            sequence,
            payload: "{}".to_owned(),
            published: true,
        };
        db.insert_remote_sync_event(&event(2)).unwrap();
        assert_eq!(db.sync_remote_cursor(&device_id).unwrap(), 0);
        db.insert_remote_sync_event(&event(1)).unwrap();
        assert_eq!(db.sync_remote_cursor(&device_id).unwrap(), 2);
    }

    #[test]
    fn local_sequence_recovers_from_missing_or_stale_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = FolioDatabase::open(dir.path().join("folio.sqlite")).unwrap();
        let first = db.append_sync_event("{}").unwrap();
        assert_eq!(first.sequence, 1);
        db.set_sync_metadata("next_sequence", "1").unwrap();
        assert_eq!(db.append_sync_event("{}").unwrap().sequence, 2);
        db.remove_sync_metadata("next_sequence").unwrap();
        assert_eq!(db.append_sync_event("{}").unwrap().sequence, 3);
        db.insert_remote_sync_event(&StoredSyncEvent {
            id: format!("{}-{:020}", first.device_id, 8),
            device_id: first.device_id,
            sequence: 8,
            payload: "{}".to_owned(),
            published: true,
        })
        .unwrap();
        assert_eq!(db.append_sync_event("{}").unwrap().sequence, 9);
    }

    #[test]
    fn rebuilding_indexes_preserves_events_and_repairs_cursors() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = FolioDatabase::open(dir.path().join("folio.sqlite")).unwrap();
        db.set_sync_metadata("sync_profile", "kept").unwrap();
        let collection = db.create_collection("保留的收藏夹").unwrap();
        let local = db.append_sync_event("local").unwrap();
        let remote = "aa".repeat(16);
        for sequence in [1, 2, 4] {
            db.insert_remote_sync_event(&StoredSyncEvent {
                id: format!("{remote}-{sequence:020}"),
                device_id: remote.clone(),
                sequence,
                payload: format!("remote-{sequence}"),
                published: true,
            })
            .unwrap();
        }
        let before = db.list_sync_events().unwrap();
        db.set_sync_metadata("next_sequence", "99").unwrap();
        db.conn
            .execute(
                "UPDATE sync_remote_cursors SET last_sequence=99 WHERE device_id=?1",
                [&remote],
            )
            .unwrap();
        db.rebuild_sync_indexes().unwrap();
        assert_eq!(
            db.sync_metadata("next_sequence").unwrap().as_deref(),
            Some("2")
        );
        assert_eq!(db.sync_remote_cursor(&remote).unwrap(), 2);
        assert_eq!(db.sync_remote_cursor(&local.device_id).unwrap(), 1);
        assert_eq!(
            db.sync_metadata("sync_profile").unwrap().as_deref(),
            Some("kept")
        );
        assert_eq!(db.list_sync_events().unwrap(), before);
        assert_eq!(db.list_collections().unwrap()[0].id, collection.id);
    }

    #[test]
    fn remote_reset_rotates_device_identity() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = FolioDatabase::open(dir.path().join("folio.sqlite")).unwrap();
        let old = db.append_sync_event("{}").unwrap();
        db.set_sync_metadata("sync_profile", "kept").unwrap();
        db.reset_sync_remote_state().unwrap();
        let next = db.append_sync_event("{}").unwrap();
        assert_ne!(next.device_id, old.device_id);
        assert_eq!(next.sequence, 1);
        assert_eq!(
            db.sync_metadata("sync_profile").unwrap().as_deref(),
            Some("kept")
        );
    }
}
