//! 安装窗口的最小命令边界和平台文件入口。

use crate::{operations, AppState};
use std::{
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
fn allowed(window: &WebviewWindow) -> Result<(), String> {
    if matches!(window.label(), "main" | "installation") {
        Ok(())
    } else {
        Err("workflow.error.permission".into())
    }
}
fn pending() -> &'static Mutex<Vec<PathBuf>> {
    static VALUE: OnceLock<Mutex<Vec<PathBuf>>> = OnceLock::new();
    VALUE.get_or_init(|| Mutex::new(Vec::new()))
}
pub fn show(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("installation") {
        let _ = window.unminimize();
        window
            .show()
            .map_err(|_| "workflow.error.operationFailed")?;
        return window
            .set_focus()
            .map_err(|_| "workflow.error.operationFailed".into());
    }
    WebviewWindowBuilder::new(
        app,
        "installation",
        WebviewUrl::App("index.html?window=installation".into()),
    )
    .title("Folio")
    .inner_size(900.0, 640.0)
    .min_inner_size(640.0, 480.0)
    .build()
    .map_err(|_| "workflow.error.operationFailed")?;
    Ok(())
}
pub fn receive(app: &tauri::AppHandle, args: Vec<String>, cwd: &Path) {
    let paths = operations::input_paths(args, cwd);
    if paths.is_empty() {
        return;
    }
    if let Ok(mut values) = pending().lock() {
        values.extend(paths);
    }
    flush(app);
}
pub fn flush(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let paths = if let Ok(mut values) = pending().lock() {
        std::mem::take(&mut *values)
    } else {
        return;
    };
    if paths.is_empty() {
        return;
    }
    let service = state.operations.clone();
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if service.analyze(paths).is_ok() {
            let _ = show(&app);
            let _ = app.emit("workflow-changed", ());
        }
    });
}
#[tauri::command]
pub fn open_font_workflow(window: WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    allowed(&window)?;
    show(&app)
}
#[tauri::command]
pub async fn analyze_font_inputs(
    window: WebviewWindow,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<(), String> {
    allowed(&window)?;
    let service = state.operations.clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.analyze(paths.into_iter().map(PathBuf::from).collect())
    })
    .await
    .map_err(|_| "workflow.error.operationFailed")??;
    show(&app)?;
    let _ = app.emit("workflow-changed", ());
    Ok(())
}
#[tauri::command]
pub fn workflow_snapshot(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<operations::WorkflowSnapshot, String> {
    allowed(&window)?;
    state.operations.snapshot()
}
#[tauri::command]
pub async fn execute_font_batch(
    window: WebviewWindow,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    id: String,
    action: String,
    destination: Option<String>,
    retry: bool,
) -> Result<String, String> {
    allowed(&window)?;
    let service = state.operations.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = service.submit(&id, &action, destination, retry, || {
            let _ = app.emit("workflow-changed", ());
        });
        let _ = app.emit("workflow-changed", ());
        let _ = app.emit("library-changed", ());
        result
    })
    .await
    .map_err(|_| "workflow.error.operationFailed")?
}
#[tauri::command]
pub fn cancel_font_batch(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    allowed(&window)?;
    state.operations.cancel(&id)
}
#[tauri::command]
pub async fn resolve_export_conflict(
    window: WebviewWindow,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    id: String,
    item_id: String,
    name: Option<String>,
) -> Result<(), String> {
    allowed(&window)?;
    let service = state.operations.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = service.continue_export(&id, &item_id, name, || {
            let _ = app.emit("workflow-changed", ());
        });
        let _ = app.emit("workflow-changed", ());
        let _ = app.emit("library-changed", ());
        result
    })
    .await
    .map_err(|_| "workflow.error.operationFailed")?
}
#[tauri::command]
pub fn hide_font_workflow(window: WebviewWindow) -> Result<(), String> {
    if window.label() != "installation" {
        return Err("workflow.error.permission".into());
    }
    window
        .hide()
        .map_err(|_| "workflow.error.operationFailed".into())
}

#[tauri::command]
pub async fn font_workflow_from_library(
    window: WebviewWindow,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    request: crate::library::PageRequest,
    face_ids: Option<Vec<String>>,
) -> Result<(), String> {
    crate::require_main_window(&window)?;
    let targets = crate::with_library(&state, move |library| {
        let mut request = request;
        request.offset = 0;
        request.limit = 240;
        let mut paths = std::collections::BTreeSet::new();
        let mut remote = std::collections::BTreeSet::new();
        loop {
            let page = library.query(request.clone())?;
            for family in &page.families {
                for face in &family.faces {
                    if !family.matched_face_ids.contains(&face.id)
                        || face_ids.as_ref().is_some_and(|ids| !ids.contains(&face.id))
                    {
                        continue;
                    }
                    if let Some(source) = face
                        .sources
                        .iter()
                        .find(|source| Path::new(&source.path).is_file())
                    {
                        paths.insert(source.path.clone());
                    } else if let Some(location) = &face.location {
                        for file in &location.files {
                            if file.cloud_available {
                                remote.insert(file.fingerprint.clone());
                            }
                        }
                    }
                }
            }
            request.offset += page.families.len();
            if page.families.is_empty() || request.offset >= page.total_matches {
                break;
            }
        }
        Ok((paths, remote))
    })
    .await?;
    let database = state.database_path.clone();
    let managed = state.managed_directory.clone();
    let service = state.operations.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (mut paths, remote) = targets;
        for fingerprint in remote {
            let password =
                crate::load_credential().map_err(|_| "workflow.error.permission".to_owned())?;
            let path = tauri::async_runtime::block_on(folio_sync::materialize_document(
                &database,
                &managed,
                &fingerprint,
                &password,
                &std::sync::atomic::AtomicBool::new(false),
            ))
            .map_err(|_| "workflow.error.sourceUnavailable".to_owned())?;
            paths.insert(path.to_string_lossy().into_owned());
        }
        service
            .analyze(paths.into_iter().map(PathBuf::from).collect())
            .map(|_| ())
    })
    .await
    .map_err(|_| "workflow.error.operationFailed")??;
    show(&app)?;
    let _ = app.emit("workflow-changed", ());
    Ok(())
}
#[tauri::command]
pub fn font_health_issues(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    crate::require_main_window(&window)?;
    let db = folio_storage::FolioDatabase::open(&state.database_path)
        .map_err(|_| "workflow.error.operationFailed")?;
    Ok(
        serde_json::json!({"scanned":db.sync_metadata("local_scan_completed").map_err(|_|"workflow.error.operationFailed")?.is_some(),"issues":db.cached_file_issues().map_err(|_|"workflow.error.operationFailed")?}),
    )
}
