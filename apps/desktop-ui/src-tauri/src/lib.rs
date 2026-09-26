mod library;

use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use library::{
    CollectionMembershipMutation, CollectionMutation, LibraryService, PageRequest,
    SmartFolderMutation,
};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

struct AppState {
    library: Mutex<LibraryService>,
    database_path: PathBuf,
    managed_directory: PathBuf,
    sync_status: Arc<Mutex<SyncStatusDto>>,
    sync_cancel: Arc<AtomicBool>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncStatusDto {
    configured: bool,
    running: bool,
    phase: String,
    stage: String,
    percent: u8,
    stage_completed: u64,
    stage_total: u64,
    uploaded_files: u64,
    downloaded_files: u64,
    published_events: u64,
    items: Vec<SyncItemDto>,
    error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncItemDto {
    fingerprint: String,
    action: String,
    status: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncConflictRequest {
    id: String,
    resolution: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncProfileDto {
    server_url: String,
    remote_directory: String,
    username: String,
    automatic: bool,
}

impl From<SyncProfileDto> for folio_sync::SyncProfile {
    fn from(value: SyncProfileDto) -> Self {
        Self {
            server_url: value.server_url,
            remote_directory: value.remote_directory,
            username: value.username,
            automatic: value.automatic,
        }
    }
}

impl From<folio_sync::SyncProfile> for SyncProfileDto {
    fn from(value: folio_sync::SyncProfile) -> Self {
        Self {
            server_url: value.server_url,
            remote_directory: value.remote_directory,
            username: value.username,
            automatic: value.automatic,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncConflictDto {
    id: String,
    kind: String,
    title: String,
    detail: String,
    local_fingerprint: Option<String>,
    remote_fingerprint: Option<String>,
}

#[tauri::command]
fn query_library(
    window: WebviewWindow,
    state: State<'_, AppState>,
    request: PageRequest,
) -> Result<library::LibraryPageDto, String> {
    require_main_window(&window)?;
    state
        .library
        .lock()
        .map_err(|_| "字体库暂时不可用".to_owned())?
        .query(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn refresh_library(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<library::LibrarySnapshotDto, String> {
    require_main_window(&window)?;
    state
        .library
        .lock()
        .map_err(|_| "字体库暂时不可用".to_owned())?
        .refresh()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn add_library_root(
    window: WebviewWindow,
    state: State<'_, AppState>,
    path: String,
) -> Result<library::LibrarySnapshotDto, String> {
    require_main_window(&window)?;
    state
        .library
        .lock()
        .map_err(|_| "字体库暂时不可用".to_owned())?
        .add_root(PathBuf::from(path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn render_previews(
    window: WebviewWindow,
    state: State<'_, AppState>,
    face_ids: Vec<String>,
    sample: String,
    size: u32,
) -> Result<Vec<library::FontPreviewDto>, String> {
    require_main_window(&window)?;
    state
        .library
        .lock()
        .map_err(|_| "字体库暂时不可用".to_owned())?
        .render_previews(&face_ids, &sample, size)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_family_favorite(
    window: WebviewWindow,
    state: State<'_, AppState>,
    identity_ids: Vec<String>,
    favorite: bool,
) -> Result<(), String> {
    require_main_window(&window)?;
    state
        .library
        .lock()
        .map_err(|_| "字体库暂时不可用".to_owned())?
        .set_favorites(&identity_ids, favorite)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn record_recent(
    window: WebviewWindow,
    state: State<'_, AppState>,
    identity_id: String,
) -> Result<(), String> {
    require_main_window(&window)?;
    state
        .library
        .lock()
        .map_err(|_| "字体库暂时不可用".to_owned())?
        .record_recent(&identity_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_collections(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Vec<library::CollectionDto>, String> {
    require_main_window(&window)?;
    state
        .library
        .lock()
        .map_err(|_| "字体库暂时不可用".to_owned())?
        .list_collections()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_collection(
    window: WebviewWindow,
    state: State<'_, AppState>,
    request: CollectionMutation,
) -> Result<library::CollectionDto, String> {
    require_main_window(&window)?;
    state
        .library
        .lock()
        .map_err(|_| "字体库暂时不可用".to_owned())?
        .save_collection(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_collection(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    require_main_window(&window)?;
    state
        .library
        .lock()
        .map_err(|_| "字体库暂时不可用".to_owned())?
        .delete_collection(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_collection_members(
    window: WebviewWindow,
    state: State<'_, AppState>,
    request: CollectionMembershipMutation,
) -> Result<(), String> {
    require_main_window(&window)?;
    state
        .library
        .lock()
        .map_err(|_| "字体库暂时不可用".to_owned())?
        .set_collection_members(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_smart_folders(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Vec<library::SmartFolderDto>, String> {
    require_main_window(&window)?;
    state
        .library
        .lock()
        .map_err(|_| "字体库暂时不可用".to_owned())?
        .list_smart_folders()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_smart_folder(
    window: WebviewWindow,
    state: State<'_, AppState>,
    request: SmartFolderMutation,
) -> Result<library::SmartFolderDto, String> {
    require_main_window(&window)?;
    state
        .library
        .lock()
        .map_err(|_| "字体库暂时不可用".to_owned())?
        .save_smart_folder(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_smart_folder(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    require_main_window(&window)?;
    state
        .library
        .lock()
        .map_err(|_| "字体库暂时不可用".to_owned())?
        .delete_smart_folder(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn convert_collection_to_smart_folder(
    window: WebviewWindow,
    state: State<'_, AppState>,
    request: SmartFolderMutation,
) -> Result<library::SmartFolderDto, String> {
    require_main_window(&window)?;
    state
        .library
        .lock()
        .map_err(|_| "字体库暂时不可用".to_owned())?
        .convert_collection_to_smart_folder(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn convert_smart_folder_to_collection(
    window: WebviewWindow,
    state: State<'_, AppState>,
    request: CollectionMutation,
) -> Result<library::CollectionDto, String> {
    require_main_window(&window)?;
    state
        .library
        .lock()
        .map_err(|_| "字体库暂时不可用".to_owned())?
        .convert_smart_folder_to_collection(request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_sync_profile(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Option<SyncProfileDto>, String> {
    require_sync_window(&window)?;
    folio_sync::load_profile(&state.database_path)
        .map(|profile| profile.map(Into::into))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_sync_status(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<SyncStatusDto, String> {
    require_sync_window(&window)?;
    let mut status = state
        .sync_status
        .lock()
        .map_err(|_| "同步状态暂时不可用".to_owned())?
        .clone();
    status.configured = folio_sync::load_profile(&state.database_path)
        .map_err(|error| error.to_string())?
        .is_some();
    Ok(status)
}

#[tauri::command]
async fn test_sync_connection(
    window: WebviewWindow,
    profile: SyncProfileDto,
    password: String,
) -> Result<(), String> {
    require_settings_window(&window)?;
    let password = if password.is_empty() {
        load_credential().map_err(|error| error.to_string())?
    } else {
        password
    };
    folio_sync::test_connection(&profile.into(), &password)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_sync_connection(
    window: WebviewWindow,
    state: State<'_, AppState>,
    profile: SyncProfileDto,
    password: String,
) -> Result<(), String> {
    require_settings_window(&window)?;
    let password = if password.trim().is_empty() {
        let previous = folio_sync::load_profile(&state.database_path)
            .map_err(|error| error.to_string())?;
        if !previous.is_some_and(|saved| {
            saved.server_url == profile.server_url
                && saved.remote_directory == profile.remote_directory
                && saved.username == profile.username
        }) {
            return Err("请输入 WebDAV 密码".to_owned());
        }
        load_credential().map_err(|_| "请输入 WebDAV 密码".to_owned())?
    } else {
        password
    };
    save_credential(&password).map_err(|error| error.to_string())?;
    folio_sync::save_profile(&state.database_path, &profile.into())
        .map_err(|error| error.to_string())?;
    let mut status = state
        .sync_status
        .lock()
        .map_err(|_| "同步状态暂时不可用".to_owned())?;
    status.configured = true;
    status.error = None;
    status.phase = "连接已保存".to_owned();
    Ok(())
}

#[tauri::command]
fn disconnect_sync(window: WebviewWindow, state: State<'_, AppState>) -> Result<(), String> {
    require_settings_window(&window)?;
    folio_sync::disconnect(&state.database_path).map_err(|error| error.to_string())?;
    delete_credential().map_err(|error| error.to_string())?;
    let mut status = state
        .sync_status
        .lock()
        .map_err(|_| "同步状态暂时不可用".to_owned())?;
    *status = SyncStatusDto::default();
    status.phase = "已断开连接".to_owned();
    Ok(())
}

#[tauri::command]
fn sync_now(
    window: WebviewWindow,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    require_sync_window(&window)?;
    let _profile = folio_sync::load_profile(&state.database_path)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "请先保存 WebDAV 连接".to_owned())?;
    let password = load_credential().map_err(|error| error.to_string())?;
    {
        let mut status = state
            .sync_status
            .lock()
            .map_err(|_| "同步状态暂时不可用".to_owned())?;
        if status.running {
            return Ok(());
        }
        status.configured = true;
        status.running = true;
        status.phase = "正在连接云端…".to_owned();
        status.stage = "连接云端".to_owned();
        status.percent = 0;
        status.stage_completed = 0;
        status.stage_total = 0;
        status.uploaded_files = 0;
        status.downloaded_files = 0;
        status.published_events = 0;
        status.items.clear();
        status.error = None;
    }
    state.sync_cancel.store(false, Ordering::Relaxed);
    let database_path = state.database_path.clone();
    let managed_directory = state.managed_directory.clone();
    let sync_status = Arc::clone(&state.sync_status);
    let sync_cancel = Arc::clone(&state.sync_cancel);
    let spawn_result = std::thread::Builder::new()
        .name("folio-webdav-sync".to_owned())
        .spawn(move || {
            tauri::async_runtime::block_on(async move {
                let progress_status = Arc::clone(&sync_status);
                let report = Arc::new(move |progress: folio_sync::SyncProgress| {
                    if let Ok(mut status) = progress_status.lock() {
                        status.phase = progress.phase.label().to_owned();
                        status.stage = progress.phase.label().to_owned();
                        status.percent = progress.percent;
                        status.stage_completed = progress.phase_completed;
                        status.stage_total = progress.phase_total;
                        status.uploaded_files = progress.uploaded_files;
                        status.downloaded_files = progress.downloaded_files;
                        status.published_events = progress.published_events;
                        status.items = progress
                            .items
                            .iter()
                            .map(|item| SyncItemDto {
                                fingerprint: item.fingerprint.clone(),
                                action: item.action.code().to_owned(),
                                status: item.status.code().to_owned(),
                            })
                            .collect();
                    }
                });
                let result = folio_sync::synchronize(
                    &database_path,
                    &managed_directory,
                    &password,
                    Arc::clone(&sync_cancel),
                    report,
                )
                .await;
                if let Ok(mut status) = sync_status.lock() {
                    status.running = false;
                    match result {
                        Ok(progress) => {
                            status.phase = format!(
                                "同步完成：上传 {} 个，下载 {} 个",
                                progress.uploaded_files, progress.downloaded_files
                            );
                            status.stage = "已同步".to_owned();
                            status.percent = 100;
                            status.stage_completed = progress.phase_completed;
                            status.stage_total = progress.phase_total;
                            status.uploaded_files = progress.uploaded_files;
                            status.downloaded_files = progress.downloaded_files;
                            status.published_events = progress.published_events;
                            status.items.clear();
                            status.error = None;
                            if let Some(app_state) = app.try_state::<AppState>() {
                                if let Ok(mut library) = app_state.library.lock() {
                                    let _ = library.refresh();
                                }
                            }
                            let _ = app.emit("library-updated", ());
                        }
                        Err(error) => {
                            status.phase = "同步未完成".to_owned();
                            status.stage = "同步未完成".to_owned();
                            status.error = Some(error.to_string());
                        }
                    }
                }
            })
        });
    if let Err(error) = spawn_result {
        if let Ok(mut status) = state.sync_status.lock() {
            status.running = false;
            status.error = Some(error.to_string());
        }
        return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
fn cancel_sync(window: WebviewWindow, state: State<'_, AppState>) -> Result<(), String> {
    require_settings_window(&window)?;
    state.sync_cancel.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
fn list_cloud_fonts(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Vec<CloudFontDto>, String> {
    require_sync_window(&window)?;
    folio_sync::list_cloud_fonts(&state.database_path)
        .map(|fonts| {
            fonts
                .into_iter()
                .map(|font| CloudFontDto {
                    fingerprint: font.fingerprint,
                    display_name: font.display_name,
                    filename: font.filename,
                    file_size: font.file_size,
                    cloud_only: font.cloud_only,
                    deleted: font.deleted,
                    local_path: font.local_path,
                })
                .collect()
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn restore_cloud_font(
    window: WebviewWindow,
    state: State<'_, AppState>,
    fingerprint: String,
) -> Result<(), String> {
    require_sync_window(&window)?;
    folio_sync::request_restore(&state.database_path, &fingerprint)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn restore_deleted_cloud_font(
    window: WebviewWindow,
    state: State<'_, AppState>,
    fingerprint: String,
) -> Result<(), String> {
    require_sync_window(&window)?;
    folio_sync::restore_deleted_font(&state.database_path, &fingerprint)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_sync_conflicts(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Vec<SyncConflictDto>, String> {
    require_settings_window(&window)?;
    folio_sync::list_conflicts(&state.database_path)
        .map(|items| {
            items
                .into_iter()
                .map(|item| SyncConflictDto {
                    id: item.id,
                    kind: item.kind,
                    title: item.title,
                    detail: item.detail,
                    local_fingerprint: item.local_fingerprint,
                    remote_fingerprint: item.remote_fingerprint,
                })
                .collect()
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn resolve_sync_conflict(
    window: WebviewWindow,
    state: State<'_, AppState>,
    request: SyncConflictRequest,
) -> Result<(), String> {
    require_settings_window(&window)?;
    let resolution = match request.resolution.as_str() {
        "keepBoth" => folio_sync::ConflictResolution::KeepBoth,
        "useLocal" => folio_sync::ConflictResolution::UseLocal,
        "useRemote" => folio_sync::ConflictResolution::UseRemote,
        _ => return Err("冲突处理方式无效".to_owned()),
    };
    folio_sync::resolve_conflict(&state.database_path, &request.id, resolution)
        .map_err(|error| error.to_string())
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudFontDto {
    fingerprint: String,
    display_name: String,
    filename: String,
    file_size: u64,
    cloud_only: bool,
    deleted: bool,
    local_path: Option<String>,
}

fn credential_entry() -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new("com.aurysian.folio.webdav", "primary")
}

fn save_credential(password: &str) -> Result<(), keyring::Error> {
    credential_entry()?.set_password(password)
}

fn load_credential() -> Result<String, keyring::Error> {
    credential_entry()?.get_password()
}

fn delete_credential() -> Result<(), keyring::Error> {
    credential_entry()?.delete_credential()
}

fn require_settings_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "settings" {
        Ok(())
    } else {
        Err("此操作仅允许从设置窗口执行".to_owned())
    }
}

fn require_sync_window(window: &WebviewWindow) -> Result<(), String> {
    if matches!(window.label(), "main" | "settings") {
        Ok(())
    } else {
        Err("此操作仅允许从 Folio 窗口执行".to_owned())
    }
}

// 必须为 async：创建窗口需回主线程执行，同步命令在主线程内会自锁。
#[tauri::command]
async fn open_settings(window: WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    require_main_window(&window)?;
    if let Some(window) = app.get_webview_window("settings") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        &app,
        "settings",
        WebviewUrl::App("index.html?window=settings".into()),
    )
    .title("Folio 设置")
    .inner_size(720.0, 600.0)
    .min_inner_size(620.0, 500.0)
    .decorations(false)
    .transparent(true)
    .visible(false)
    .build()
    .map_err(|error| error.to_string())?;

    apply_window_material(&window);
    window.show().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn require_main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("此操作仅允许从字体库窗口执行".to_owned())
    }
}

#[cfg(target_os = "windows")]
fn apply_window_material(window: &tauri::WebviewWindow) {
    if window_vibrancy::apply_mica(window, None).is_err() {
        let _ = window_vibrancy::apply_acrylic(window, None);
    }
}

#[cfg(not(target_os = "windows"))]
fn apply_window_material(_window: &tauri::WebviewWindow) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _, _| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }))
            .plugin(
                tauri_plugin_window_state::Builder::new()
                    .with_state_flags(
                        tauri_plugin_window_state::StateFlags::SIZE
                            | tauri_plugin_window_state::StateFlags::POSITION
                            | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                    )
                    .build(),
            );
    }

    let app_state = builder
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let database_path = data_dir.join("folio.sqlite");
            let managed_directory = data_dir.join("ManagedFonts");
            let mut library = LibraryService::open(database_path.clone())?;
            library.add_default_roots()?;
            app.manage(AppState {
                library: Mutex::new(library),
                database_path,
                managed_directory,
                sync_status: Arc::new(Mutex::new(SyncStatusDto::default())),
                sync_cancel: Arc::new(AtomicBool::new(false)),
            });

            if let Some(window) = app.get_webview_window("main") {
                apply_window_material(&window);
                window.show()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            query_library,
            refresh_library,
            add_library_root,
            render_previews,
            set_family_favorite,
            record_recent,
            list_collections,
            save_collection,
            delete_collection,
            set_collection_members,
            list_smart_folders,
            save_smart_folder,
            delete_smart_folder,
            convert_collection_to_smart_folder,
            convert_smart_folder_to_collection,
            get_sync_profile,
            get_sync_status,
            test_sync_connection,
            save_sync_connection,
            disconnect_sync,
            sync_now,
            cancel_sync,
            list_cloud_fonts,
            restore_cloud_font,
            restore_deleted_cloud_font,
            list_sync_conflicts,
            resolve_sync_conflict,
            open_settings,
            quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("启动 Folio 桌面应用失败");

    app_state.run(|_, _| {});
}
