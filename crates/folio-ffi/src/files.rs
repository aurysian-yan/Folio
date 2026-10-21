//! 不依赖应用运行时的原生文件服务。

use crate::FolioFfiError;
use folio_storage::{ExternalSource, FolioDatabase, OperationBatch, ResourceGuard};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

type Result<T> = std::result::Result<T, FolioFfiError>;
fn document_error(value: folio_sync::SyncError) -> FolioFfiError {
    let key = match value {
        folio_sync::SyncError::InvalidId => "workflow.error.invalidRequest",
        folio_sync::SyncError::Authentication | folio_sync::SyncError::PermissionDenied => {
            "workflow.error.permission"
        }
        folio_sync::SyncError::Cancelled => "workflow.error.cancelled",
        folio_sync::SyncError::InvalidFont => "workflow.error.invalidFont",
        _ => "workflow.error.sourceUnavailable",
    };
    FolioFfiError::operation(key)
}
fn error(value: impl std::fmt::Display) -> FolioFfiError {
    FolioFfiError::operation(value)
}

#[derive(uniffi::Object)]
pub struct FolioFileService {
    database: PathBuf,
    managed: PathBuf,
    batches: Mutex<std::collections::BTreeMap<String, ResourceGuard>>,
}
#[uniffi::export]
impl FolioFileService {
    #[uniffi::constructor]
    pub fn open(database_path: String, managed_directory: String) -> Result<Arc<Self>> {
        FolioDatabase::open(&database_path).map_err(error)?;
        Ok(Arc::new(Self {
            database: database_path.into(),
            managed: managed_directory.into(),
            batches: Mutex::new(std::collections::BTreeMap::new()),
        }))
    }
    pub fn relocate(&self, old_directory: String) -> Result<()> {
        let new = self
            .database
            .parent()
            .ok_or_else(|| error("workflow.error.invalidRequest"))?;
        FolioDatabase::open(&self.database)
            .map_err(error)?
            .relocate_local_directory(Path::new(&old_directory), new)
            .map_err(error)
    }
    pub fn documents(&self, parent: String) -> Result<String> {
        serde_json::to_string(
            &folio_sync::provided_documents(&self.database, &parent).map_err(document_error)?,
        )
        .map_err(error)
    }
    pub fn document(&self, id: String) -> Result<String> {
        serde_json::to_string(
            &folio_sync::provided_document(&self.database, &id).map_err(document_error)?,
        )
        .map_err(error)
    }
    pub fn read(&self, id: String) -> Result<Arc<FolioFileRead>> {
        let document =
            folio_sync::provided_document(&self.database, &id).map_err(document_error)?;
        let fingerprint = document
            .fingerprint
            .ok_or_else(|| error("workflow.error.invalidRequest"))?;
        Ok(Arc::new(FolioFileRead {
            database: self.database.clone(),
            managed: self.managed.clone(),
            fingerprint,
            cancelled: AtomicBool::new(false),
            guard: Mutex::new(None),
        }))
    }
    pub fn sources(&self) -> Result<String> {
        serde_json::to_string(&source_values(
            &FolioDatabase::open(&self.database).map_err(error)?,
        )?)
        .map_err(error)
    }
    pub fn save_source(&self, value: String) -> Result<()> {
        let extra: serde_json::Value = serde_json::from_str(&value).map_err(error)?;
        let source: ExternalSource = serde_json::from_value(extra.clone()).map_err(error)?;
        let expected = self
            .database
            .parent()
            .ok_or_else(|| error("workflow.error.invalidRequest"))?
            .join("ReferenceCache")
            .join(&source.id);
        if source.id.is_empty()
            || source.id.len() > 128
            || !source
                .id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
            || Path::new(&source.snapshot_path) != expected
        {
            return Err(error("workflow.error.invalidRequest"));
        }
        let _guard =
            ResourceGuard::acquire(&self.database, "library-write", true).map_err(error)?;
        let mut db = FolioDatabase::open(&self.database).map_err(error)?;
        db.save_external_source(&source).map_err(error)?;
        let reason = extra["unavailableReason"]
            .as_str()
            .filter(|value| matches!(*value, "permission" | "offline" | "unavailable"))
            .unwrap_or("unavailable");
        db.set_sync_metadata(
            &format!("local_source:{}:reason", source.id),
            if source.available { "" } else { reason },
        )
        .map_err(error)?;
        if source.available {
            db.add_root(&expected, true).map_err(error)?;
            db.refresh(folio_storage::RefreshMode::Incremental)
                .map_err(error)?;
        }
        Ok(())
    }
    pub fn remove_source(&self, id: String) -> Result<()> {
        let _guard =
            ResourceGuard::acquire(&self.database, "library-write", true).map_err(error)?;
        FolioDatabase::open(&self.database)
            .map_err(error)?
            .remove_external_source(&id)
            .map_err(error)
    }
    pub fn begin_batch(&self, id: String) -> Result<()> {
        let mut batches = self.batches.lock().map_err(error)?;
        if batches.contains_key(&id) {
            return Err(error("workflow.error.busy"));
        }
        let guard =
            ResourceGuard::acquire(&self.database, &format!("batch:{id}"), true).map_err(error)?;
        batches.insert(id, guard);
        Ok(())
    }
    pub fn end_batch(&self, id: String) {
        if let Ok(mut batches) = self.batches.lock() {
            batches.remove(&id);
        }
    }
    pub fn batches(&self) -> Result<String> {
        use folio_storage::OperationStatus;
        let db = FolioDatabase::open(&self.database).map_err(error)?;
        let mut batches = db.operation_batches().map_err(error)?;
        for batch in &mut batches {
            let abandoned = batch.items.iter().any(|item| {
                item.action == "export"
                    && matches!(
                        item.status,
                        OperationStatus::Running
                            | OperationStatus::Pending
                            | OperationStatus::AwaitingDecision
                    )
            });
            if !abandoned {
                continue;
            }
            let Ok(_guard) =
                ResourceGuard::acquire(&self.database, &format!("batch:{}", batch.id), true)
            else {
                continue;
            };
            for item in &mut batch.items {
                if item.action == "export"
                    && matches!(
                        item.status,
                        OperationStatus::Running
                            | OperationStatus::Pending
                            | OperationStatus::AwaitingDecision
                    )
                {
                    item.status = OperationStatus::Failed;
                    item.error_key = Some("workflow.error.interrupted".into());
                }
            }
            db.save_operation_batch(batch).map_err(error)?;
        }
        serde_json::to_string(&batches).map_err(error)
    }
    pub fn save_batch(&self, value: String) -> Result<()> {
        let batch: OperationBatch = serde_json::from_str(&value).map_err(error)?;
        FolioDatabase::open(&self.database)
            .map_err(error)?
            .save_operation_batch(&batch)
            .map_err(error)
    }
    pub fn health(&self) -> Result<String> {
        let db = FolioDatabase::open(&self.database).map_err(error)?;
        serde_json::to_string(&serde_json::json!({"scanned":db.sync_metadata("local_scan_completed").map_err(error)?.is_some(),"issues":db.cached_file_issues().map_err(error)?,"sources":source_values(&db)?.into_iter().filter(|item| item["available"] == false).map(|item| serde_json::json!({"id":item["id"],"name":item["displayName"],"kind":item["unavailableReason"]})).collect::<Vec<_>>()})).map_err(error)
    }
}

#[derive(uniffi::Object)]
pub struct FolioFileRead {
    database: PathBuf,
    managed: PathBuf,
    fingerprint: String,
    cancelled: AtomicBool,
    guard: Mutex<Option<ResourceGuard>>,
}
#[uniffi::export]
impl FolioFileRead {
    pub fn open(&self, password: String) -> Result<String> {
        if self.cancelled.load(Ordering::Acquire) {
            return Err(error("workflow.error.cancelled"));
        }
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(error)?
            .block_on(folio_sync::materialize_document(
                &self.database,
                &self.managed,
                &self.fingerprint,
                &password,
                &self.cancelled,
            ))
            .map_err(document_error)?;
        let guard =
            ResourceGuard::acquire(&self.database, &format!("file:{}", self.fingerprint), false)
                .map_err(error)?;
        let path = folio_sync::readable_document(&self.database, &self.fingerprint)
            .map_err(document_error)?
            .ok_or_else(|| error("workflow.error.sourceUnavailable"))?;
        let mut held = self.guard.lock().map_err(error)?;
        if self.cancelled.load(Ordering::Acquire) {
            return Err(error("workflow.error.cancelled"));
        }
        *held = Some(guard);
        Ok(path.to_string_lossy().into_owned())
    }
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }
    pub fn release(&self) {
        self.cancel();
        if let Ok(mut guard) = self.guard.lock() {
            *guard = None;
        }
    }
}

fn source_values(db: &FolioDatabase) -> Result<Vec<serde_json::Value>> {
    db.external_sources()
        .map_err(error)?
        .into_iter()
        .map(|source| {
            let reason = db
                .sync_metadata(&format!("local_source:{}:reason", source.id))
                .map_err(error)?
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "unavailable".into());
            let mut value = serde_json::to_value(source).map_err(error)?;
            value["unavailableReason"] = serde_json::Value::String(reason);
            Ok(value)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extension_observers_preserve_live_batches_and_recover_only_abandoned_items() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp
            .path()
            .join("folio.sqlite")
            .to_string_lossy()
            .into_owned();
        let directory = temp.path().join("fonts").to_string_lossy().into_owned();
        let owner = FolioFileService::open(path.clone(), directory.clone()).unwrap();
        let observer = FolioFileService::open(path, directory).unwrap();
        owner.begin_batch("one".into()).unwrap();
        owner.save_batch(serde_json::json!({"id":"one","cancelRequested":false,"items":[{"id":"first","name":"one.ttf","source":"local/one","action":"export","stage":"export","status":"running","fingerprint":null,"destination":null,"errorKey":null},{"id":"done","name":"done.ttf","source":"local/done","action":"export","stage":"export","status":"succeeded","fingerprint":null,"destination":null,"errorKey":null}]}).to_string()).unwrap();
        let live: serde_json::Value = serde_json::from_str(&observer.batches().unwrap()).unwrap();
        assert_eq!(live[0]["items"][0]["status"], "running");
        owner.end_batch("one".into());
        let recovered: serde_json::Value =
            serde_json::from_str(&observer.batches().unwrap()).unwrap();
        assert_eq!(recovered[0]["items"][0]["status"], "failed");
        assert_eq!(recovered[0]["items"][1]["status"], "succeeded");
    }
}
