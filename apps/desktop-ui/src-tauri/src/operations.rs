//! 独立安装窗口的持久批次和文件操作。

use folio_core::{parse_font_file, ContentFingerprint};
use folio_storage::{
    new_operation_id, FolioDatabase, OperationBatch, OperationItem, OperationStatus, ResourceGuard,
};
use serde::Serialize;
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

#[cfg(windows)]
#[path = "windows_fonts.rs"]
mod windows_fonts;

type Result<T> = std::result::Result<T, String>;
fn err(value: impl std::fmt::Display) -> String {
    value.to_string()
}

pub struct WorkflowService {
    database: PathBuf,
    managed: PathBuf,
    running: AtomicBool,
    dispatch: std::sync::Mutex<()>,
    shutting_down: AtomicBool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSnapshot {
    pub batches: Vec<OperationBatch>,
    pub running: bool,
    pub font_operations: Vec<folio_storage::PlatformFontOperation>,
}
impl WorkflowService {
    pub fn new(database: PathBuf, managed: PathBuf) -> Self {
        Self {
            database,
            managed,
            running: AtomicBool::new(false),
            dispatch: std::sync::Mutex::new(()),
            shutting_down: AtomicBool::new(false),
        }
    }
    fn db(&self) -> Result<FolioDatabase> {
        FolioDatabase::open(&self.database).map_err(err)
    }
    pub fn snapshot(&self) -> Result<WorkflowSnapshot> {
        let db = self.db()?;
        Ok(WorkflowSnapshot {
            batches: db.operation_batches().map_err(err)?,
            running: self.running.load(Ordering::Acquire),
            font_operations: db.platform_font_operations().map_err(err)?,
        })
    }
    pub fn analyze(&self, paths: Vec<PathBuf>) -> Result<OperationBatch> {
        let db = self.db()?;
        let catalog = db.load_cached_catalog().map_err(err)?;
        let mut batch = OperationBatch {
            id: new_operation_id().map_err(err)?,
            items: Vec::new(),
            cancel_requested: false,
        };
        let mut seen = std::collections::BTreeSet::new();
        for path in paths.into_iter().take(10_000) {
            let mut item = OperationItem {
                id: new_operation_id().map_err(err)?,
                name: path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                source: path.to_string_lossy().into_owned(),
                action: "collect".into(),
                stage: "analyze".into(),
                status: OperationStatus::Pending,
                fingerprint: None,
                destination: None,
                error_key: None,
                analysis: None,
            };
            match parse_font_file(&path) {
                Ok(parsed) => {
                    if !seen.insert(parsed.fingerprint.to_hex()) {
                        continue;
                    }
                    item.fingerprint = Some(parsed.fingerprint.to_hex());
                    item.analysis = Some(
                        serde_json::json!({"format":parsed.format.label(),"faces":parsed.faces.iter().map(|face|serde_json::json!({"family":face.metadata.family_name,"style":face.metadata.subfamily_name,"faceIndex":face.face_index,"duplicate":catalog.faces().any(|value|value.revision_id==face.revision.id),"conflict":catalog.faces().any(|value|value.identity_id==face.identity.id && value.revision_id!=face.revision.id)})).collect::<Vec<_>>(),"problemCount":parsed.problems.len()}),
                    );
                }
                Err(cause) => {
                    item.status = OperationStatus::Failed;
                    item.error_key = Some(
                        if matches!(cause, folio_core::FontError::UnsupportedFormat { .. }) {
                            "import.issueKinds.known_unsupported_format"
                        } else {
                            "workflow.error.invalidFont"
                        }
                        .into(),
                    );
                }
            }
            batch.items.push(item);
        }
        if batch.items.is_empty() {
            return Err("workflow.error.invalidRequest".into());
        }
        db.save_operation_batch(&batch).map_err(err)?;
        Ok(batch)
    }
    pub fn prepare(
        &self,
        id: &str,
        action: &str,
        destination: Option<String>,
        retry: bool,
    ) -> Result<String> {
        if !matches!(
            action,
            "reference"
                | "collect"
                | "activate"
                | "install"
                | "collectActivate"
                | "export"
                | "deactivate"
                | "uninstall"
        ) {
            return Err("workflow.error.invalidRequest".into());
        }
        if self.running.load(Ordering::Acquire) {
            return Err("workflow.error.busy".into());
        }
        let db = self.db()?;
        let mut batch = db
            .operation_batch(id)
            .map_err(err)?
            .ok_or("workflow.error.invalidRequest")?;
        if !retry && batch.items.iter().any(|item| item.stage != "analyze") {
            batch = self.analyze(
                batch
                    .items
                    .iter()
                    .map(|item| PathBuf::from(&item.source))
                    .collect(),
            )?;
        }
        batch.cancel_requested = false;
        for item in &mut batch.items {
            if item.fingerprint.is_none()
                || matches!(
                    item.status,
                    OperationStatus::Succeeded | OperationStatus::Skipped
                )
            {
                continue;
            }
            if retry && item.status != OperationStatus::Failed {
                continue;
            }
            if !retry {
                item.stage = action.into();
                item.action = action.into();
                item.destination = destination.clone();
            }
            item.status = OperationStatus::Pending;
            item.error_key = None;
        }
        db.save_operation_batch(&batch).map_err(err)?;
        Ok(batch.id)
    }
    pub fn submit(
        &self,
        id: &str,
        action: &str,
        destination: Option<String>,
        retry: bool,
        changed: impl FnMut(),
    ) -> Result<String> {
        let _dispatch = self
            .dispatch
            .try_lock()
            .map_err(|_| "workflow.error.busy")?;
        if self.shutting_down.load(Ordering::Acquire) {
            return Err("workflow.error.cancelled".into());
        }
        let _process = ResourceGuard::acquire(&self.database, "workflow", true).map_err(err)?;
        let target = self.prepare(id, action, destination, retry)?;
        self.execute(&target, changed)?;
        Ok(target)
    }
    pub fn continue_export(
        &self,
        id: &str,
        item_id: &str,
        name: Option<String>,
        changed: impl FnMut(),
    ) -> Result<()> {
        let _dispatch = self
            .dispatch
            .try_lock()
            .map_err(|_| "workflow.error.busy")?;
        let _process = ResourceGuard::acquire(&self.database, "workflow", true).map_err(err)?;
        self.resolve(id, item_id, name)?;
        self.execute(id, changed)
    }
    pub fn cancel(&self, id: &str) -> Result<()> {
        let db = self.db()?;
        let mut batch = db
            .operation_batch(id)
            .map_err(err)?
            .ok_or("workflow.error.invalidRequest")?;
        batch.cancel_requested = true;
        for item in &mut batch.items {
            if matches!(
                item.status,
                OperationStatus::Pending | OperationStatus::AwaitingDecision
            ) {
                item.status = OperationStatus::Cancelled;
            }
        }
        db.save_operation_batch(&batch).map_err(err)
    }
    pub fn resolve(&self, id: &str, item_id: &str, name: Option<String>) -> Result<()> {
        if self.running.load(Ordering::Acquire) {
            return Err("workflow.error.busy".into());
        }
        let db = self.db()?;
        let mut batch = db
            .operation_batch(id)
            .map_err(err)?
            .ok_or("workflow.error.invalidRequest")?;
        let item = batch
            .items
            .iter_mut()
            .find(|item| item.id == item_id && item.status == OperationStatus::AwaitingDecision)
            .ok_or("workflow.error.invalidRequest")?;
        if let Some(name) = name {
            if !valid_filename(&name) {
                return Err("workflow.error.invalidName".into());
            }
            let parent = Path::new(
                item.destination
                    .as_deref()
                    .ok_or("workflow.error.invalidRequest")?,
            )
            .parent()
            .ok_or("workflow.error.invalidRequest")?;
            item.destination = Some(parent.join(name).to_string_lossy().into_owned());
            item.status = OperationStatus::Pending;
            item.error_key = None;
        } else {
            item.status = OperationStatus::Skipped;
            item.error_key = None;
        }
        db.save_operation_batch(&batch).map_err(err)
    }
    pub fn execute(&self, id: &str, mut changed: impl FnMut()) -> Result<()> {
        if self.running.swap(true, Ordering::AcqRel) {
            return Err("workflow.error.busy".into());
        }
        struct Reset<'a>(&'a AtomicBool);
        impl Drop for Reset<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::Release);
            }
        }
        let _reset = Reset(&self.running);
        let db = self.db()?;
        let batch = db
            .operation_batch(id)
            .map_err(err)?
            .ok_or("workflow.error.invalidRequest")?;
        for original in batch.items {
            let current = db
                .operation_batch(id)
                .map_err(err)?
                .ok_or("workflow.error.invalidRequest")?;
            if current.cancel_requested {
                break;
            }
            let Some(mut item) = current.items.into_iter().find(|item| {
                item.id == original.id
                    && item.status == OperationStatus::Pending
                    && item.stage != "analyze"
            }) else {
                continue;
            };
            item.status = OperationStatus::Running;
            self.update(id, &item)?;
            changed();
            let result = self.perform(id, &mut item);
            match result {
                Ok(()) => item.status = OperationStatus::Succeeded,
                Err(key) if key == "workflow.error.nameConflict" => {
                    item.status = OperationStatus::AwaitingDecision;
                    item.error_key = Some(if key.starts_with("workflow.error.") {
                        key
                    } else {
                        "workflow.error.operationFailed".into()
                    });
                }
                Err(key) => {
                    item.status = OperationStatus::Failed;
                    item.error_key = Some(if key.starts_with("workflow.error.") {
                        key
                    } else {
                        "workflow.error.operationFailed".into()
                    });
                }
            }
            self.update(id, &item)?;
            changed();
            if item.status == OperationStatus::AwaitingDecision {
                break;
            }
        }
        Ok(())
    }
    fn update(&self, id: &str, item: &OperationItem) -> Result<()> {
        let db = self.db()?;
        let mut batch = db
            .operation_batch(id)
            .map_err(err)?
            .ok_or("workflow.error.invalidRequest")?;
        if let Some(value) = batch.items.iter_mut().find(|value| value.id == item.id) {
            *value = item.clone();
        }
        db.save_operation_batch(&batch).map_err(err)
    }
    fn perform(&self, batch_id: &str, item: &mut OperationItem) -> Result<()> {
        if item.stage == "deactivate" || item.stage == "uninstall" {
            return self.font_action(Path::new(&item.source), item.stage == "uninstall", true);
        }
        let source = if item.stage == "activate" && item.action == "collectActivate" {
            PathBuf::from(
                item.destination
                    .as_deref()
                    .ok_or("workflow.error.sourceUnavailable")?,
            )
        } else {
            PathBuf::from(&item.source)
        };
        let parsed = parse_font_file(&source).map_err(|_| "workflow.error.sourceUnavailable")?;
        let fingerprint = parsed.fingerprint.to_hex();
        if item.fingerprint.as_deref() != Some(&fingerprint) {
            return Err("workflow.error.sourceChanged".into());
        }
        let _read = ResourceGuard::acquire(&self.database, &format!("file:{fingerprint}"), false)
            .map_err(err)?;
        match item.stage.as_str() {
            "reference" => {
                let mut db = self.db()?;
                db.add_file_root(&source).map_err(err)?;
                db.refresh(folio_storage::RefreshMode::Incremental)
                    .map_err(err)?;
            }
            "collect" | "collectActivate" => {
                let ext = match parsed.format {
                    folio_core::FontFormat::TrueType => "ttf",
                    folio_core::FontFormat::OpenType => "otf",
                    _ => source
                        .extension()
                        .and_then(|value| value.to_str())
                        .unwrap_or("ttc"),
                };
                let destination = self.managed.join(format!("{fingerprint}.{ext}"));
                copy_verified(&source, &destination, &fingerprint, true)?;
                item.destination = Some(destination.to_string_lossy().into_owned());
                let mut db = self.db()?;
                db.add_root(&self.managed, true).map_err(err)?;
                db.refresh(folio_storage::RefreshMode::Incremental)
                    .map_err(err)?;
                if item.action == "collectActivate" {
                    item.stage = "activate".into();
                    self.update(batch_id, item)?;
                    return self.font_action(&destination, false, false);
                }
            }
            "activate" => self.font_action(&source, false, false)?,
            "install" => self.font_action(&source, true, false)?,
            "export" => {
                let selected = PathBuf::from(
                    item.destination
                        .as_deref()
                        .ok_or("workflow.error.invalidRequest")?,
                );
                let destination = if selected.is_dir() {
                    selected.join(&item.name)
                } else {
                    selected
                };
                item.destination = Some(destination.to_string_lossy().into_owned());
                copy_verified(&source, &destination, &fingerprint, false)?;
            }
            _ => return Err("workflow.error.invalidRequest".into()),
        }
        Ok(())
    }
    fn font_action(&self, path: &Path, persistent: bool, remove: bool) -> Result<()> {
        #[cfg(windows)]
        {
            windows_fonts::perform(&self.database, path, persistent, remove)
        }
        #[cfg(not(windows))]
        {
            let _ = (path, persistent, remove);
            Err("workflow.error.platformUnsupported".into())
        }
    }
    pub fn recover(&self) -> Result<()> {
        let db = self.db()?;
        for mut batch in db.operation_batches().map_err(err)? {
            for item in &mut batch.items {
                if item.status == OperationStatus::Running {
                    item.status = OperationStatus::Failed;
                    item.error_key = Some("workflow.error.interrupted".into());
                }
            }
            db.save_operation_batch(&batch).map_err(err)?;
        }
        #[cfg(windows)]
        {
            let _ = windows_fonts::cleanup(&self.database);
            windows_fonts::reconcile(&self.database)?;
            let records = db.platform_font_operations().map_err(err)?;
            for mut batch in db.operation_batches().map_err(err)? {
                for item in &mut batch.items {
                    if item.status == OperationStatus::Succeeded
                        && item.stage == "install"
                        && !records.iter().any(|record| {
                            record.persistent
                                && record.registered
                                && item.fingerprint.as_deref() == Some(&record.fingerprint)
                        })
                    {
                        item.status = OperationStatus::Failed;
                        item.error_key = Some("workflow.error.interrupted".into());
                    }
                }
                db.save_operation_batch(&batch).map_err(err)?;
            }
        }
        Ok(())
    }
    pub fn shutdown(&self) {
        self.shutting_down.store(true, Ordering::Release);
        if let Ok(snapshot) = self.snapshot() {
            for batch in snapshot.batches {
                let _ = self.cancel(&batch.id);
            }
        }
        let Ok(_dispatch) = self.dispatch.lock() else {
            return;
        };
        #[cfg(windows)]
        {
            let _ = windows_fonts::cleanup(&self.database);
        }
    }
}

pub fn valid_filename(name: &str) -> bool {
    !name.trim().is_empty()
        && !matches!(name, "." | "..")
        && !name.ends_with(['.', ' '])
        && !name
            .chars()
            .any(|value| value.is_control() || "\\/:*?\"<>|".contains(value))
}

pub fn copy_verified(
    source: &Path,
    destination: &Path,
    fingerprint: &str,
    allow_identical: bool,
) -> Result<()> {
    if destination.exists() {
        if allow_identical
            && parse_font_file(destination)
                .is_ok_and(|value| value.fingerprint.to_hex() == fingerprint)
        {
            return Ok(());
        }
        return Err("workflow.error.nameConflict".into());
    }
    let bytes = std::fs::read(source).map_err(|_| "workflow.error.sourceUnavailable")?;
    if ContentFingerprint::from_bytes(&bytes).to_hex() != fingerprint {
        return Err("workflow.error.sourceChanged".into());
    }
    let parent = destination
        .parent()
        .ok_or("workflow.error.invalidRequest")?;
    std::fs::create_dir_all(parent).map_err(err)?;
    let temporary = parent.join(format!(".{}.part", new_operation_id().map_err(err)?));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(err)?;
        file.write_all(&bytes).map_err(err)?;
        file.sync_all().map_err(err)?;
        parse_font_file(&temporary).map_err(|_| "workflow.error.invalidFont")?;
        std::fs::hard_link(&temporary, destination).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "workflow.error.nameConflict".into()
            } else {
                err(error)
            }
        })?;
        Ok(())
    })();
    let _ = std::fs::remove_file(temporary);
    result
}

pub fn input_paths(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<PathBuf> {
    args.into_iter()
        .filter(|value| !value.starts_with('-'))
        .map(|value| {
            let path = PathBuf::from(value);
            if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            }
        })
        .filter(|path| {
            path.is_file()
                || path.extension().is_some_and(|value| {
                    matches!(
                        value.to_string_lossy().to_lowercase().as_str(),
                        "ttf" | "otf" | "ttc" | "otc"
                    )
                })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/fonts/Lato-Regular.ttf")
    }
    #[test]
    fn analysis_is_read_only_and_collect_then_export_preserves_bytes() {
        let temp = tempfile::tempdir().unwrap();
        let database = temp.path().join("folio.sqlite");
        let service = WorkflowService::new(database.clone(), temp.path().join("ManagedFonts"));
        let batch = service.analyze(vec![sample()]).unwrap();
        assert!(FolioDatabase::open(&database)
            .unwrap()
            .list_roots()
            .unwrap()
            .is_empty());
        service.prepare(&batch.id, "collect", None, false).unwrap();
        service.execute(&batch.id, || {}).unwrap();
        let saved = service.snapshot().unwrap();
        let collected = saved.batches[0].items[0].destination.as_ref().unwrap();
        assert_eq!(
            std::fs::read(collected).unwrap(),
            std::fs::read(sample()).unwrap()
        );
        assert!(sample().exists());
        let export = service.analyze(vec![sample()]).unwrap();
        let destination = temp.path().join("export");
        std::fs::create_dir(&destination).unwrap();
        service
            .prepare(
                &export.id,
                "export",
                Some(destination.to_string_lossy().into_owned()),
                false,
            )
            .unwrap();
        service.execute(&export.id, || {}).unwrap();
        assert_eq!(
            std::fs::read(destination.join("Lato-Regular.ttf")).unwrap(),
            std::fs::read(sample()).unwrap()
        );
    }
    #[test]
    fn export_conflict_requires_decision_and_retry_does_not_replay_successes() {
        let temp = tempfile::tempdir().unwrap();
        let database = temp.path().join("folio.sqlite");
        let service = WorkflowService::new(database.clone(), temp.path().join("fonts"));
        let export = temp.path().join("export");
        std::fs::create_dir(&export).unwrap();
        std::fs::write(export.join("Lato-Regular.ttf"), b"original").unwrap();
        let batch = service.analyze(vec![sample()]).unwrap();
        service
            .prepare(
                &batch.id,
                "export",
                Some(export.to_string_lossy().into_owned()),
                false,
            )
            .unwrap();
        service.execute(&batch.id, || {}).unwrap();
        let stored = service
            .db()
            .unwrap()
            .operation_batch(&batch.id)
            .unwrap()
            .unwrap();
        assert_eq!(stored.items[0].status, OperationStatus::AwaitingDecision);
        assert!(service
            .resolve(
                &batch.id,
                &stored.items[0].id,
                Some("../outside.ttf".into())
            )
            .is_err());
        service
            .resolve(&batch.id, &stored.items[0].id, Some("renamed.ttf".into()))
            .unwrap();
        service.execute(&batch.id, || {}).unwrap();
        assert_eq!(
            std::fs::read(export.join("Lato-Regular.ttf")).unwrap(),
            b"original"
        );
        assert!(export.join("renamed.ttf").exists());
        service.prepare(&batch.id, "export", None, true).unwrap();
        service.execute(&batch.id, || {}).unwrap();
        assert_eq!(
            service
                .db()
                .unwrap()
                .operation_batch(&batch.id)
                .unwrap()
                .unwrap()
                .items[0]
                .status,
            OperationStatus::Succeeded
        );
    }
    #[test]
    fn successive_actions_create_separate_history_and_input_paths_preserve_cwd() {
        let temp = tempfile::tempdir().unwrap();
        let service =
            WorkflowService::new(temp.path().join("folio.sqlite"), temp.path().join("fonts"));
        let batch = service.analyze(vec![sample()]).unwrap();
        let first = service
            .submit(&batch.id, "collect", None, false, || {})
            .unwrap();
        let destination = temp.path().join("导出 有空格");
        std::fs::create_dir(&destination).unwrap();
        let second = service
            .submit(
                &first,
                "export",
                Some(destination.to_string_lossy().into_owned()),
                false,
                || {},
            )
            .unwrap();
        assert_ne!(first, second);
        assert_eq!(service.snapshot().unwrap().batches.len(), 2);
        assert!(destination.join("Lato-Regular.ttf").exists());
        assert_eq!(
            input_paths(["不存在 字体.ttf".to_owned()], temp.path()),
            vec![temp.path().join("不存在 字体.ttf")]
        );
    }
    #[test]
    fn interrupted_batches_are_recoverable_and_pending_cancellation_is_persistent() {
        let temp = tempfile::tempdir().unwrap();
        let database = temp.path().join("folio.sqlite");
        let service = WorkflowService::new(database.clone(), temp.path().join("fonts"));
        let mut batch = service.analyze(vec![sample()]).unwrap();
        batch.items[0].status = OperationStatus::Running;
        batch.items[0].stage = "activate".into();
        batch.items[0].action = "collectActivate".into();
        service.db().unwrap().save_operation_batch(&batch).unwrap();
        service.recover().unwrap();
        assert_eq!(
            service.snapshot().unwrap().batches[0].items[0].stage,
            "activate"
        );
        assert_eq!(
            service.snapshot().unwrap().batches[0].items[0].status,
            OperationStatus::Failed
        );
        service.prepare(&batch.id, "collect", None, true).unwrap();
        service.cancel(&batch.id).unwrap();
        service.execute(&batch.id, || {}).unwrap();
        assert_eq!(
            service.snapshot().unwrap().batches[0].items[0].status,
            OperationStatus::Cancelled
        );
    }
}
