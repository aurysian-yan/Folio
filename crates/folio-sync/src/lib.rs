//! Folio 字体与用户状态的共享 WebDAV 同步边界。

#![forbid(unsafe_code)]

#[cfg(test)]
mod tests;
mod webdav;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use folio_core::{
    normalize_search, parse_font_data, parse_font_file, Collection, CollectionColor,
    CollectionIcon, CollectionId, ContentFingerprint, FontIdentityId, SmartFolder, SmartFolderId,
};
use folio_storage::{
    FolioDatabase, RefreshMode, StoredSyncAsset, StoredSyncConflict, StoredSyncEvent,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use webdav::WebDavClient;

const FORMAT_VERSION: u32 = 1;
const PROFILE_KEY: &str = "profile";
const DISCONNECTED_PROFILE_KEY: &str = "disconnected_profile";
const BASELINE_KEY: &str = "user_baseline";

#[derive(Debug, Error)]
pub enum SyncError {
    #[error("WebDAV 地址需要使用有效的 HTTPS URL")]
    InvalidServerUrl,
    #[error("远端目录无效")]
    InvalidRemoteDirectory,
    #[error("WebDAV 认证失败，请检查账号和密码")]
    Authentication,
    #[error("没有访问 WebDAV 目录的权限")]
    PermissionDenied,
    #[error("WebDAV 可用空间不足")]
    RemoteStorageFull,
    #[error("WebDAV 请求失败，状态码 {0}")]
    HttpStatus(u16),
    #[error("WebDAV 返回了无法识别的目录数据")]
    InvalidDavResponse,
    #[error("远端同步数据版本不受支持")]
    UnsupportedFormat,
    #[error("下载的字体校验失败")]
    InvalidFont,
    #[error("同步已取消")]
    Cancelled,
    #[error("尚未配置 WebDAV 连接")]
    NotConfigured,
    #[error("网络请求失败：{0}")]
    Http(#[from] reqwest::Error),
    #[error("本地存储失败：{0}")]
    Storage(#[from] folio_storage::StorageError),
    #[error("本地文件操作失败：{0}")]
    Io(#[from] std::io::Error),
    #[error("同步数据无效：{0}")]
    Json(#[from] serde_json::Error),
    #[error("字体解析失败：{0}")]
    Font(#[from] folio_core::FontError),
    #[error("同步数据中的标识无效")]
    InvalidId,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncProfile {
    pub server_url: String,
    pub remote_directory: String,
    pub username: String,
    pub automatic: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SyncProgress {
    pub uploaded_files: u64,
    pub downloaded_files: u64,
    pub uploaded_bytes: u64,
    pub downloaded_bytes: u64,
    pub received_changes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CloudFont {
    pub fingerprint: String,
    pub display_name: String,
    pub filename: String,
    pub file_size: u64,
    pub cloud_only: bool,
    pub deleted: bool,
    pub local_path: Option<String>,
    pub identity_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncConflict {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub detail: String,
    pub local_fingerprint: Option<String>,
    pub remote_fingerprint: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConflictResolution {
    KeepBoth,
    UseLocal,
    UseRemote,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct RemoteFace {
    identity_id: String,
    revision_id: String,
    display_name: String,
    style_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct RemoteAsset {
    fingerprint: String,
    filename: String,
    extension: String,
    file_size: u64,
    faces: Vec<RemoteFace>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct WireCollection {
    id: String,
    name: String,
    icon: String,
    color: String,
    created_at_ns: i64,
    updated_at_ns: i64,
}

impl From<Collection> for WireCollection {
    fn from(value: Collection) -> Self {
        Self {
            id: value.id.to_string(),
            name: value.name,
            icon: value.icon.key().to_owned(),
            color: value.color.key().to_owned(),
            created_at_ns: value.created_at_ns,
            updated_at_ns: value.updated_at_ns,
        }
    }
}

impl WireCollection {
    fn decode(&self) -> Result<Collection, SyncError> {
        Ok(Collection {
            id: CollectionId::from_bytes(parse_id(&self.id)?),
            name: self.name.clone(),
            icon: CollectionIcon::from_key(&self.icon).ok_or(SyncError::InvalidId)?,
            color: CollectionColor::from_key(&self.color).ok_or(SyncError::InvalidId)?,
            created_at_ns: self.created_at_ns,
            updated_at_ns: self.updated_at_ns,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct WireSmartFolder {
    id: String,
    name: String,
    #[serde(default = "default_smart_folder_icon")]
    icon: String,
    #[serde(default = "default_smart_folder_color")]
    color: String,
    query_json: String,
    created_at_ns: i64,
    updated_at_ns: i64,
}

impl From<SmartFolder> for WireSmartFolder {
    fn from(value: SmartFolder) -> Self {
        Self {
            id: value.id.to_string(),
            name: value.name,
            icon: value.icon.key().to_owned(),
            color: value.color.key().to_owned(),
            query_json: value.query_json,
            created_at_ns: value.created_at_ns,
            updated_at_ns: value.updated_at_ns,
        }
    }
}

impl WireSmartFolder {
    fn decode(&self) -> Result<SmartFolder, SyncError> {
        let query: folio_query::SavedFontQuery = serde_json::from_str(&self.query_json)?;
        query
            .into_query(0, None)
            .map_err(|_| SyncError::InvalidId)?;
        Ok(SmartFolder {
            id: SmartFolderId::from_bytes(parse_id(&self.id)?),
            name: self.name.clone(),
            icon: CollectionIcon::from_key(&self.icon).ok_or(SyncError::InvalidId)?,
            color: CollectionColor::from_key(&self.color).ok_or(SyncError::InvalidId)?,
            query_json: self.query_json.clone(),
            created_at_ns: self.created_at_ns,
            updated_at_ns: self.updated_at_ns,
        })
    }
}

fn default_smart_folder_icon() -> String {
    CollectionIcon::Folder.key().to_owned()
}

fn default_smart_folder_color() -> String {
    CollectionColor::Gray.key().to_owned()
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
enum Change {
    FontAdded(RemoteAsset),
    FontDeleted {
        fingerprint: String,
        observed_adds: Vec<String>,
    },
    FavoriteAdded {
        identity_id: String,
    },
    FavoriteRemoved {
        identity_id: String,
        observed_adds: Vec<String>,
    },
    MemberAdded {
        collection_id: String,
        identity_id: String,
    },
    MemberRemoved {
        collection_id: String,
        identity_id: String,
        observed_adds: Vec<String>,
    },
    CollectionSet {
        collection: WireCollection,
        parents: Vec<String>,
    },
    CollectionDeleted {
        collection_id: String,
        parents: Vec<String>,
    },
    SmartFolderSet {
        smart_folder: WireSmartFolder,
        parents: Vec<String>,
    },
    SmartFolderDeleted {
        smart_folder_id: String,
        parents: Vec<String>,
    },
    RecentViewed {
        identity_id: String,
        timestamp_ns: i64,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct RemoteEvent {
    format_version: u32,
    id: String,
    device_id: String,
    sequence: i64,
    change: Change,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
struct UserSnapshot {
    favorites: BTreeSet<String>,
    collections: BTreeMap<String, WireCollection>,
    members: BTreeSet<(String, String)>,
    recent: BTreeMap<String, i64>,
    #[serde(default)]
    smart_folders: BTreeMap<String, WireSmartFolder>,
}

pub fn load_profile(database_path: impl AsRef<Path>) -> Result<Option<SyncProfile>, SyncError> {
    let db = FolioDatabase::open(database_path)?;
    db.sync_metadata(PROFILE_KEY)?
        .map(|value| serde_json::from_str(&value).map_err(SyncError::from))
        .transpose()
}

pub fn save_profile(
    database_path: impl AsRef<Path>,
    profile: &SyncProfile,
) -> Result<(), SyncError> {
    let _ = WebDavClient::new(profile, "")?;
    let mut db = FolioDatabase::open(database_path)?;
    if let Some(previous) = db
        .sync_metadata(PROFILE_KEY)?
        .or(db.sync_metadata(DISCONNECTED_PROFILE_KEY)?)
    {
        if previous != serde_json::to_string(profile)? {
            let old: SyncProfile = serde_json::from_str(&previous)?;
            if old.server_url != profile.server_url
                || old.remote_directory != profile.remote_directory
                || old.username != profile.username
            {
                db.reset_sync_remote_state()?;
            }
        }
    }
    db.set_sync_metadata(PROFILE_KEY, &serde_json::to_string(profile)?)?;
    db.remove_sync_metadata(DISCONNECTED_PROFILE_KEY)?;
    Ok(())
}

pub fn disconnect(database_path: impl AsRef<Path>) -> Result<(), SyncError> {
    let db = FolioDatabase::open(database_path)?;
    if let Some(profile) = db.sync_metadata(PROFILE_KEY)? {
        db.set_sync_metadata(DISCONNECTED_PROFILE_KEY, &profile)?;
    }
    db.remove_sync_metadata(PROFILE_KEY)?;
    Ok(())
}

pub async fn test_connection(profile: &SyncProfile, password: &str) -> Result<(), SyncError> {
    WebDavClient::new(profile, password)?
        .test_connection()
        .await
}

pub fn list_cloud_fonts(database_path: impl AsRef<Path>) -> Result<Vec<CloudFont>, SyncError> {
    let db = FolioDatabase::open(database_path)?;
    let published = decoded_events(&db)?
        .into_iter()
        .filter(|(event, _)| event.published)
        .filter_map(|(_, change)| match change {
            Change::FontAdded(asset) => Some(asset.fingerprint),
            _ => None,
        })
        .collect::<BTreeSet<_>>();
    db.list_sync_assets()?
        .into_iter()
        .filter(|asset| published.contains(&asset.fingerprint))
        .map(|asset| {
            let remote: RemoteAsset = serde_json::from_str(&asset.remote_payload)?;
            Ok(CloudFont {
                fingerprint: asset.fingerprint,
                display_name: remote
                    .faces
                    .first()
                    .map_or(asset.filename.clone(), |face| face.display_name.clone()),
                filename: asset.filename,
                file_size: remote.file_size,
                cloud_only: asset.cloud_only
                    || asset
                        .local_path
                        .as_ref()
                        .is_none_or(|path| !Path::new(path).is_file()),
                deleted: asset.deleted,
                local_path: asset.local_path,
                identity_ids: remote
                    .faces
                    .iter()
                    .map(|face| face.identity_id.clone())
                    .collect(),
            })
        })
        .collect()
}

pub fn list_conflicts(database_path: impl AsRef<Path>) -> Result<Vec<SyncConflict>, SyncError> {
    let db = FolioDatabase::open(database_path)?;
    db.list_sync_conflicts()?
        .into_iter()
        .map(|conflict| serde_json::from_str(&conflict.payload).map_err(SyncError::from))
        .collect()
}

pub fn resolve_conflict(
    database_path: impl AsRef<Path>,
    id: &str,
    resolution: ConflictResolution,
) -> Result<(), SyncError> {
    let mut db = FolioDatabase::open(database_path)?;
    let conflict = list_conflicts(db.path())?
        .into_iter()
        .find(|conflict| conflict.id == id)
        .ok_or(SyncError::InvalidId)?;
    match conflict.kind.as_str() {
        "collection" => resolve_collection_conflict(&mut db, id, resolution)?,
        "collection_name" => resolve_collection_name_conflict(&mut db, id, resolution)?,
        "smart_folder" => resolve_smart_folder_conflict(&mut db, id, resolution)?,
        "smart_folder_name" => resolve_smart_folder_name_conflict(&mut db, id, resolution)?,
        "font_revision" => {
            let discarded = match resolution {
                ConflictResolution::UseLocal => conflict.remote_fingerprint,
                ConflictResolution::UseRemote => conflict.local_fingerprint,
                ConflictResolution::KeepBoth => None,
            };
            if let Some(fingerprint) = discarded {
                delete_everywhere(db.path(), &fingerprint)?;
            }
        }
        _ => return Err(SyncError::InvalidId),
    }
    db.resolve_sync_conflict(id)?;
    Ok(())
}

fn resolve_smart_folder_conflict(
    db: &mut FolioDatabase,
    conflict_id: &str,
    resolution: ConflictResolution,
) -> Result<(), SyncError> {
    let id = conflict_id
        .strip_prefix("smart_folder-")
        .ok_or(SyncError::InvalidId)?;
    let events = decoded_events(db)?;
    let heads = smart_folder_heads(&events, id);
    if heads.len() < 2 {
        return Err(SyncError::InvalidId);
    }
    let device = db.sync_device_id()?;
    let local_head = heads.keys().find(|head| head.starts_with(&device)).cloned();
    let remote_head = heads
        .keys()
        .find(|head| !head.starts_with(&device))
        .cloned();
    let selected = match resolution {
        ConflictResolution::UseLocal | ConflictResolution::KeepBoth => {
            local_head.or_else(|| heads.keys().next().cloned())
        }
        ConflictResolution::UseRemote => remote_head.or_else(|| heads.keys().next_back().cloned()),
    }
    .ok_or(SyncError::InvalidId)?;
    let chosen = heads.get(&selected).cloned().ok_or(SyncError::InvalidId)?;
    if resolution == ConflictResolution::KeepBoth {
        for (head, alternate) in &heads {
            if head == &selected {
                continue;
            }
            if let Some(alternate) = alternate {
                let alternate = alternate.decode()?;
                let duplicate = db.create_smart_folder_with_style(
                    &unique_smart_folder_name(db, &alternate.name, "另一版本")?,
                    &alternate.query_json,
                    alternate.icon,
                    alternate.color,
                )?;
                stage_change(
                    db,
                    &Change::SmartFolderSet {
                        smart_folder: duplicate.into(),
                        parents: Vec::new(),
                    },
                )?;
            }
        }
    }
    let parents = heads.into_keys().collect();
    match chosen {
        Some(smart_folder) => {
            db.upsert_remote_smart_folder(&smart_folder.decode()?)?;
            stage_change(
                db,
                &Change::SmartFolderSet {
                    smart_folder,
                    parents,
                },
            )?;
        }
        None => {
            let parsed = SmartFolderId::from_bytes(parse_id(id)?);
            if db
                .list_smart_folders()?
                .iter()
                .any(|value| value.id == parsed)
            {
                db.delete_smart_folder(parsed)?;
            }
            stage_change(
                db,
                &Change::SmartFolderDeleted {
                    smart_folder_id: id.to_owned(),
                    parents,
                },
            )?;
        }
    }
    db.set_sync_metadata(
        BASELINE_KEY,
        &serde_json::to_string(&capture_user_state(db)?)?,
    )?;
    Ok(())
}

fn resolve_smart_folder_name_conflict(
    db: &mut FolioDatabase,
    conflict_id: &str,
    resolution: ConflictResolution,
) -> Result<(), SyncError> {
    let id = conflict_id
        .strip_prefix("smart_folder_name-")
        .ok_or(SyncError::InvalidId)?;
    let heads = smart_folder_heads(&decoded_events(db)?, id);
    let (head, value) = heads.iter().next_back().ok_or(SyncError::InvalidId)?;
    let mut remote = value.clone().ok_or(SyncError::InvalidId)?;
    let existing = db
        .list_smart_folders()?
        .into_iter()
        .find(|folder| {
            folder.id.to_string() != id
                && normalize_search(&folder.name) == normalize_search(&remote.name)
        })
        .ok_or(SyncError::InvalidId)?;
    match resolution {
        ConflictResolution::KeepBoth => {
            remote.name = unique_smart_folder_name(db, &remote.name, "云端")?;
            db.upsert_remote_smart_folder(&remote.decode()?)?;
            stage_change(
                db,
                &Change::SmartFolderSet {
                    smart_folder: remote,
                    parents: vec![head.clone()],
                },
            )?;
        }
        ConflictResolution::UseLocal => {
            stage_change(
                db,
                &Change::SmartFolderDeleted {
                    smart_folder_id: id.to_owned(),
                    parents: heads.into_keys().collect(),
                },
            )?;
        }
        ConflictResolution::UseRemote => {
            let existing_id = existing.id.to_string();
            let parents = smart_folder_heads(&decoded_events(db)?, &existing_id)
                .into_keys()
                .collect();
            db.delete_smart_folder(existing.id)?;
            stage_change(
                db,
                &Change::SmartFolderDeleted {
                    smart_folder_id: existing_id,
                    parents,
                },
            )?;
            db.upsert_remote_smart_folder(&remote.decode()?)?;
        }
    }
    db.set_sync_metadata(
        BASELINE_KEY,
        &serde_json::to_string(&capture_user_state(db)?)?,
    )?;
    Ok(())
}

fn resolve_collection_conflict(
    db: &mut FolioDatabase,
    conflict_id: &str,
    resolution: ConflictResolution,
) -> Result<(), SyncError> {
    let id = conflict_id
        .strip_prefix("collection-")
        .ok_or(SyncError::InvalidId)?;
    let events = decoded_events(db)?;
    let heads = collection_heads(&events, id);
    if heads.len() < 2 {
        return Err(SyncError::InvalidId);
    }
    let device = db.sync_device_id()?;
    let local_head = heads.keys().find(|head| head.starts_with(&device)).cloned();
    let remote_head = heads
        .keys()
        .find(|head| !head.starts_with(&device))
        .cloned();
    let selected = match resolution {
        ConflictResolution::UseLocal | ConflictResolution::KeepBoth => {
            local_head.or_else(|| heads.keys().next().cloned())
        }
        ConflictResolution::UseRemote => remote_head.or_else(|| heads.keys().next_back().cloned()),
    }
    .ok_or(SyncError::InvalidId)?;
    let chosen = heads.get(&selected).cloned().ok_or(SyncError::InvalidId)?;
    if resolution == ConflictResolution::KeepBoth {
        for (head, alternate) in &heads {
            if head == &selected {
                continue;
            }
            if let Some(alternate) = alternate {
                let duplicate = db.create_collection_with_style(
                    &unique_collection_name(db, &alternate.name, "另一版本")?,
                    CollectionIcon::from_key(&alternate.icon).ok_or(SyncError::InvalidId)?,
                    CollectionColor::from_key(&alternate.color).ok_or(SyncError::InvalidId)?,
                )?;
                let original = CollectionId::from_bytes(parse_id(id)?);
                let members = db.list_collection_members(original)?;
                if !members.is_empty() {
                    db.add_collection_members(duplicate.id, &members)?;
                }
                let duplicate_id = duplicate.id.to_string();
                stage_change(
                    db,
                    &Change::CollectionSet {
                        collection: duplicate.into(),
                        parents: Vec::new(),
                    },
                )?;
                for member in members {
                    stage_change(
                        db,
                        &Change::MemberAdded {
                            collection_id: duplicate_id.clone(),
                            identity_id: member.to_string(),
                        },
                    )?;
                }
            }
        }
    }
    let parents = heads.into_keys().collect();
    match chosen {
        Some(collection) => {
            db.upsert_remote_collection(&collection.decode()?)?;
            stage_change(
                db,
                &Change::CollectionSet {
                    collection,
                    parents,
                },
            )?;
        }
        None => {
            let parsed = CollectionId::from_bytes(parse_id(id)?);
            if db
                .list_collections()?
                .iter()
                .any(|value| value.id == parsed)
            {
                db.delete_collection(parsed)?;
            }
            stage_change(
                db,
                &Change::CollectionDeleted {
                    collection_id: id.to_owned(),
                    parents,
                },
            )?;
        }
    }
    db.set_sync_metadata(
        BASELINE_KEY,
        &serde_json::to_string(&capture_user_state(db)?)?,
    )?;
    Ok(())
}

fn resolve_collection_name_conflict(
    db: &mut FolioDatabase,
    conflict_id: &str,
    resolution: ConflictResolution,
) -> Result<(), SyncError> {
    let id = conflict_id
        .strip_prefix("collection-name-")
        .ok_or(SyncError::InvalidId)?;
    let heads = collection_heads(&decoded_events(db)?, id);
    let (head, value) = heads.iter().next_back().ok_or(SyncError::InvalidId)?;
    let mut remote = value.clone().ok_or(SyncError::InvalidId)?;
    let existing = db
        .list_collections()?
        .into_iter()
        .find(|collection| {
            collection.id.to_string() != id
                && collection.name.to_lowercase() == remote.name.to_lowercase()
        })
        .ok_or(SyncError::InvalidId)?;
    match resolution {
        ConflictResolution::KeepBoth => {
            remote.name = unique_collection_name(db, &remote.name, "云端")?;
            db.upsert_remote_collection(&remote.decode()?)?;
            stage_change(
                db,
                &Change::CollectionSet {
                    collection: remote,
                    parents: vec![head.clone()],
                },
            )?;
        }
        ConflictResolution::UseLocal => {
            stage_change(
                db,
                &Change::CollectionDeleted {
                    collection_id: id.to_owned(),
                    parents: heads.into_keys().collect(),
                },
            )?;
        }
        ConflictResolution::UseRemote => {
            let existing_id = existing.id.to_string();
            let parents = collection_heads(&decoded_events(db)?, &existing_id)
                .into_keys()
                .collect();
            db.delete_collection(existing.id)?;
            stage_change(
                db,
                &Change::CollectionDeleted {
                    collection_id: existing_id,
                    parents,
                },
            )?;
            db.upsert_remote_collection(&remote.decode()?)?;
        }
    }
    db.set_sync_metadata(
        BASELINE_KEY,
        &serde_json::to_string(&capture_user_state(db)?)?,
    )?;
    Ok(())
}

fn unique_collection_name(
    db: &FolioDatabase,
    name: &str,
    label: &str,
) -> Result<String, SyncError> {
    let used = db
        .list_collections()?
        .into_iter()
        .map(|collection| collection.name.to_lowercase())
        .collect::<BTreeSet<_>>();
    for index in 1..1000 {
        let candidate = if index == 1 {
            format!("{name}（{label}）")
        } else {
            format!("{name}（{label} {index}）")
        };
        if !used.contains(&candidate.to_lowercase()) {
            return Ok(candidate);
        }
    }
    Err(SyncError::InvalidId)
}

fn unique_smart_folder_name(
    db: &FolioDatabase,
    name: &str,
    label: &str,
) -> Result<String, SyncError> {
    let used = db
        .list_smart_folders()?
        .into_iter()
        .map(|folder| normalize_search(&folder.name))
        .collect::<BTreeSet<_>>();
    for index in 1..1000 {
        let candidate = if index == 1 {
            format!("{name}（{label}）")
        } else {
            format!("{name}（{label} {index}）")
        };
        if !used.contains(&normalize_search(&candidate)) {
            return Ok(candidate);
        }
    }
    Err(SyncError::InvalidId)
}

pub fn set_cloud_only(database_path: impl AsRef<Path>, fingerprint: &str) -> Result<(), SyncError> {
    let db = FolioDatabase::open(database_path)?;
    let mut asset = db
        .list_sync_assets()?
        .into_iter()
        .find(|asset| asset.fingerprint == fingerprint)
        .ok_or(SyncError::InvalidId)?;
    if let Some(path) = &asset.local_path {
        if Path::new(path).is_file() {
            std::fs::remove_file(path)?;
        }
    }
    asset.local_path = None;
    asset.cloud_only = true;
    db.upsert_sync_asset(&asset)?;
    Ok(())
}

pub fn mark_cloud_only_for_path(
    database_path: impl AsRef<Path>,
    path: impl AsRef<Path>,
) -> Result<bool, SyncError> {
    let db = FolioDatabase::open(database_path)?;
    let wanted = path.as_ref();
    let Some(mut asset) = db.list_sync_assets()?.into_iter().find(|asset| {
        asset
            .local_path
            .as_ref()
            .is_some_and(|stored| Path::new(stored) == wanted)
            && !asset.deleted
    }) else {
        return Ok(false);
    };
    asset.local_path = None;
    asset.cloud_only = true;
    db.upsert_sync_asset(&asset)?;
    Ok(true)
}

pub fn request_restore(
    database_path: impl AsRef<Path>,
    fingerprint: &str,
) -> Result<(), SyncError> {
    let db = FolioDatabase::open(database_path)?;
    let mut asset = db
        .list_sync_assets()?
        .into_iter()
        .find(|asset| asset.fingerprint == fingerprint)
        .ok_or(SyncError::InvalidId)?;
    asset.cloud_only = false;
    db.upsert_sync_asset(&asset)?;
    Ok(())
}

pub fn restore_deleted_font(
    database_path: impl AsRef<Path>,
    fingerprint: &str,
) -> Result<(), SyncError> {
    let mut db = FolioDatabase::open(database_path)?;
    let mut asset = db
        .list_sync_assets()?
        .into_iter()
        .find(|asset| asset.fingerprint == fingerprint && asset.deleted)
        .ok_or(SyncError::InvalidId)?;
    let remote: RemoteAsset = serde_json::from_str(&asset.remote_payload)?;
    stage_change(&mut db, &Change::FontAdded(remote))?;
    asset.deleted = false;
    asset.cloud_only = false;
    db.upsert_sync_asset(&asset)?;
    Ok(())
}

pub fn delete_everywhere(
    database_path: impl AsRef<Path>,
    fingerprint: &str,
) -> Result<(), SyncError> {
    let mut db = FolioDatabase::open(database_path)?;
    let events = decoded_events(&db)?;
    let observed_adds = asset_add_tags(&events, fingerprint);
    if observed_adds.is_empty() {
        return Err(SyncError::InvalidId);
    }
    stage_change(
        &mut db,
        &Change::FontDeleted {
            fingerprint: fingerprint.to_owned(),
            observed_adds,
        },
    )?;
    if let Some(mut asset) = db
        .list_sync_assets()?
        .into_iter()
        .find(|asset| asset.fingerprint == fingerprint)
    {
        asset.deleted = true;
        db.upsert_sync_asset(&asset)?;
    }
    Ok(())
}

fn parse_id(value: &str) -> Result<[u8; 16], SyncError> {
    let bytes = value.as_bytes();
    if bytes.len() != 32 {
        return Err(SyncError::InvalidId);
    }
    let mut out = [0_u8; 16];
    for index in 0..16 {
        let part = std::str::from_utf8(&bytes[index * 2..index * 2 + 2])
            .map_err(|_| SyncError::InvalidId)?;
        out[index] = u8::from_str_radix(part, 16).map_err(|_| SyncError::InvalidId)?;
    }
    Ok(out)
}

fn stage_change(db: &mut FolioDatabase, change: &Change) -> Result<(), SyncError> {
    db.append_sync_event(&serde_json::to_string(change)?)?;
    Ok(())
}

fn decoded_events(db: &FolioDatabase) -> Result<Vec<(StoredSyncEvent, Change)>, SyncError> {
    db.list_sync_events()?
        .into_iter()
        .map(|event| {
            let change = serde_json::from_str(&event.payload)?;
            Ok((event, change))
        })
        .collect()
}

fn asset_add_tags(events: &[(StoredSyncEvent, Change)], fingerprint: &str) -> Vec<String> {
    active_add_tags(
        events,
        |change| matches!(change, Change::FontAdded(asset) if asset.fingerprint == fingerprint),
        |change| match change {
            Change::FontDeleted {
                fingerprint: deleted,
                observed_adds,
            } if deleted == fingerprint => Some(observed_adds),
            _ => None,
        },
    )
}

pub async fn synchronize(
    database_path: impl AsRef<Path>,
    managed_directory: impl AsRef<Path>,
    password: &str,
    cancelled: Arc<AtomicBool>,
    report: Arc<dyn Fn(SyncProgress) + Send + Sync>,
) -> Result<SyncProgress, SyncError> {
    let mut db = FolioDatabase::open(database_path)?;
    let profile: SyncProfile = db
        .sync_metadata(PROFILE_KEY)?
        .ok_or(SyncError::NotConfigured)
        .and_then(|value| serde_json::from_str(&value).map_err(SyncError::from))?;
    let remote = WebDavClient::new(&profile, password)?;
    synchronize_with_client(
        &mut db,
        managed_directory.as_ref(),
        &profile,
        &remote,
        &cancelled,
        &report,
    )
    .await
}

async fn synchronize_with_client(
    db: &mut FolioDatabase,
    managed_directory: &Path,
    profile: &SyncProfile,
    remote: &WebDavClient,
    cancelled: &AtomicBool,
    report: &Arc<dyn Fn(SyncProgress) + Send + Sync>,
) -> Result<SyncProgress, SyncError> {
    std::fs::create_dir_all(managed_directory)?;
    let mut progress = SyncProgress::default();

    run_or_cancel(remote.test_connection(), &cancelled).await?;
    run_or_cancel(remote.ensure_root(&profile.remote_directory), &cancelled).await?;
    run_or_cancel(remote.ensure_directory(&[]), cancelled).await?;
    run_or_cancel(remote.ensure_directory(&["Folio"]), cancelled).await?;
    let versions = run_or_cancel(remote.list(&["Folio"]), cancelled).await?;
    if versions
        .iter()
        .any(|name| name.starts_with('v') && name != "v1")
    {
        return Err(SyncError::UnsupportedFormat);
    }
    for path in [
        &["Folio", "v1"][..],
        &["Folio", "v1", "objects"][..],
        &["Folio", "v1", "events"][..],
    ] {
        run_or_cancel(remote.ensure_directory(path), &cancelled).await?;
    }
    let device_id = db.sync_device_id()?;
    run_or_cancel(
        remote.ensure_directory(&["Folio", "v1", "events", &device_id]),
        &cancelled,
    )
    .await?;

    stage_user_changes(db)?;
    stage_managed_fonts(db, managed_directory)?;
    publish_local_events(db, remote, cancelled, report, &mut progress).await?;
    receive_remote_events(db, remote, cancelled, report, &mut progress).await?;
    apply_remote_events(
        db,
        managed_directory,
        remote,
        cancelled,
        report,
        &mut progress,
    )
    .await?;
    db.set_sync_metadata(
        BASELINE_KEY,
        &serde_json::to_string(&event_user_baseline(db)?)?,
    )?;
    if let Ok(elapsed) = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        db.set_sync_metadata("last_successful_sync_ms", &elapsed.as_millis().to_string())?;
    }
    (report)(progress);
    Ok(progress)
}

async fn run_or_cancel<T>(
    future: impl std::future::Future<Output = Result<T, SyncError>>,
    cancelled: &AtomicBool,
) -> Result<T, SyncError> {
    tokio::select! {
        result = future => result,
        _ = async {
            loop {
                if cancelled.load(Ordering::Relaxed) { break; }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        } => Err(SyncError::Cancelled),
    }
}

fn capture_user_state(db: &FolioDatabase) -> Result<UserSnapshot, SyncError> {
    let favorites = db
        .list_favorites()?
        .into_iter()
        .map(|id| id.to_string())
        .collect();
    let mut collections = BTreeMap::new();
    let mut members = BTreeSet::new();
    for collection in db.list_collections()? {
        let id = collection.id.to_string();
        for member in db.list_collection_members(collection.id)? {
            members.insert((id.clone(), member.to_string()));
        }
        collections.insert(id, collection.into());
    }
    let recent = db
        .list_recent(usize::MAX)?
        .into_iter()
        .map(|item| (item.identity_id.to_string(), item.last_accessed_at_ns))
        .collect();
    let smart_folders = db
        .list_smart_folders()?
        .into_iter()
        .map(|folder| (folder.id.to_string(), folder.into()))
        .collect();
    Ok(UserSnapshot {
        favorites,
        collections,
        members,
        recent,
        smart_folders,
    })
}

fn event_user_baseline(db: &FolioDatabase) -> Result<UserSnapshot, SyncError> {
    let events = decoded_events(db)?;
    let current = capture_user_state(db)?;
    let mut favorite_ids = BTreeSet::new();
    let mut collection_ids = BTreeSet::new();
    let mut member_ids = BTreeSet::new();
    let mut smart_folder_ids = BTreeSet::new();
    let mut recent = BTreeMap::<String, i64>::new();
    for (_, change) in &events {
        match change {
            Change::FavoriteAdded { identity_id } | Change::FavoriteRemoved { identity_id, .. } => {
                favorite_ids.insert(identity_id.clone());
            }
            Change::CollectionSet { collection, .. } => {
                collection_ids.insert(collection.id.clone());
            }
            Change::CollectionDeleted { collection_id, .. } => {
                collection_ids.insert(collection_id.clone());
            }
            Change::SmartFolderSet { smart_folder, .. } => {
                smart_folder_ids.insert(smart_folder.id.clone());
            }
            Change::SmartFolderDeleted {
                smart_folder_id, ..
            } => {
                smart_folder_ids.insert(smart_folder_id.clone());
            }
            Change::MemberAdded {
                collection_id,
                identity_id,
            }
            | Change::MemberRemoved {
                collection_id,
                identity_id,
                ..
            } => {
                member_ids.insert((collection_id.clone(), identity_id.clone()));
            }
            Change::RecentViewed {
                identity_id,
                timestamp_ns,
            } => {
                let entry = recent.entry(identity_id.clone()).or_default();
                *entry = (*entry).max(*timestamp_ns);
            }
            _ => {}
        }
    }
    let favorites = favorite_ids
        .into_iter()
        .filter(|id| !favorite_add_tags(&events, id).is_empty())
        .collect();
    let mut collections = BTreeMap::new();
    for id in collection_ids {
        let heads = collection_heads(&events, &id);
        if heads.len() == 1 {
            if let Some(Some(collection)) = heads.into_values().next() {
                if current.collections.contains_key(&id) {
                    collections.insert(id, collection);
                }
            }
        } else if let Some(collection) = current.collections.get(&id) {
            collections.insert(id, collection.clone());
        }
    }
    let members = member_ids
        .into_iter()
        .filter(|(collection, identity)| {
            collections.contains_key(collection)
                && !member_add_tags(&events, collection, identity).is_empty()
        })
        .collect();
    let mut smart_folders = BTreeMap::new();
    for id in smart_folder_ids {
        let heads = smart_folder_heads(&events, &id);
        if heads.len() == 1 {
            if let Some(Some(folder)) = heads.into_values().next() {
                if current.smart_folders.contains_key(&id) {
                    smart_folders.insert(id, folder);
                }
            }
        } else if let Some(folder) = current.smart_folders.get(&id) {
            smart_folders.insert(id, folder.clone());
        }
    }
    Ok(UserSnapshot {
        favorites,
        collections,
        members,
        recent,
        smart_folders,
    })
}

fn stage_user_changes(db: &mut FolioDatabase) -> Result<(), SyncError> {
    let previous: UserSnapshot = db
        .sync_metadata(BASELINE_KEY)?
        .map(|value| serde_json::from_str(&value))
        .transpose()?
        .unwrap_or_default();
    let current = capture_user_state(db)?;
    let known = decoded_events(db)?;

    for identity_id in current.favorites.difference(&previous.favorites) {
        stage_change(
            db,
            &Change::FavoriteAdded {
                identity_id: identity_id.clone(),
            },
        )?;
    }
    for identity_id in previous.favorites.difference(&current.favorites) {
        stage_change(
            db,
            &Change::FavoriteRemoved {
                identity_id: identity_id.clone(),
                observed_adds: favorite_add_tags(&known, identity_id),
            },
        )?;
    }
    for (id, collection) in &current.collections {
        if previous.collections.get(id).is_none_or(|before| {
            before.name != collection.name
                || before.icon != collection.icon
                || before.color != collection.color
        }) {
            stage_change(
                db,
                &Change::CollectionSet {
                    collection: collection.clone(),
                    parents: collection_heads(&known, id).into_keys().collect(),
                },
            )?;
        }
    }
    for id in previous.collections.keys() {
        if !current.collections.contains_key(id) {
            stage_change(
                db,
                &Change::CollectionDeleted {
                    collection_id: id.clone(),
                    parents: collection_heads(&known, id).into_keys().collect(),
                },
            )?;
        }
    }
    for (id, smart_folder) in &current.smart_folders {
        if previous.smart_folders.get(id).is_none_or(|before| {
            before.name != smart_folder.name
                || before.query_json != smart_folder.query_json
                || before.icon != smart_folder.icon
                || before.color != smart_folder.color
        }) {
            stage_change(
                db,
                &Change::SmartFolderSet {
                    smart_folder: smart_folder.clone(),
                    parents: smart_folder_heads(&known, id).into_keys().collect(),
                },
            )?;
        }
    }
    for id in previous.smart_folders.keys() {
        if !current.smart_folders.contains_key(id) {
            stage_change(
                db,
                &Change::SmartFolderDeleted {
                    smart_folder_id: id.clone(),
                    parents: smart_folder_heads(&known, id).into_keys().collect(),
                },
            )?;
        }
    }
    for (collection_id, identity_id) in current.members.difference(&previous.members) {
        stage_change(
            db,
            &Change::MemberAdded {
                collection_id: collection_id.clone(),
                identity_id: identity_id.clone(),
            },
        )?;
    }
    for (collection_id, identity_id) in previous.members.difference(&current.members) {
        stage_change(
            db,
            &Change::MemberRemoved {
                collection_id: collection_id.clone(),
                identity_id: identity_id.clone(),
                observed_adds: member_add_tags(&known, collection_id, identity_id),
            },
        )?;
    }
    for (identity_id, timestamp_ns) in &current.recent {
        if previous
            .recent
            .get(identity_id)
            .is_none_or(|old| old < timestamp_ns)
        {
            stage_change(
                db,
                &Change::RecentViewed {
                    identity_id: identity_id.clone(),
                    timestamp_ns: *timestamp_ns,
                },
            )?;
        }
    }
    db.set_sync_metadata(BASELINE_KEY, &serde_json::to_string(&current)?)?;
    Ok(())
}

fn stage_managed_fonts(db: &mut FolioDatabase, directory: &Path) -> Result<(), SyncError> {
    let known = decoded_events(db)?;
    let mut staged = BTreeSet::new();
    let assets = db
        .list_sync_assets()?
        .into_iter()
        .map(|asset| (asset.fingerprint.clone(), asset))
        .collect::<BTreeMap<_, _>>();
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !matches!(extension.as_str(), "ttf" | "otf" | "ttc" | "otc") {
            continue;
        }
        let parsed = parse_font_file(&path)?;
        if parsed.faces.is_empty() {
            continue;
        }
        let fingerprint = parsed.fingerprint.to_hex();
        if assets
            .get(&fingerprint)
            .is_some_and(|asset| asset.deleted || asset.cloud_only)
        {
            continue;
        }
        let filename = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("font")
            .to_owned();
        let remote_asset = RemoteAsset {
            fingerprint: fingerprint.clone(),
            filename: filename.clone(),
            extension: extension.clone(),
            file_size: std::fs::metadata(&path)?.len(),
            faces: parsed
                .faces
                .into_iter()
                .map(|face| RemoteFace {
                    identity_id: face.identity.id.to_string(),
                    revision_id: face.revision.id.to_string(),
                    display_name: face
                        .metadata
                        .family_name
                        .or(face.identity.canonical_name)
                        .unwrap_or_else(|| "未命名字体".to_owned()),
                    style_name: face.metadata.subfamily_name.unwrap_or_default(),
                })
                .collect(),
        };
        if asset_add_tags(&known, &fingerprint).is_empty() && staged.insert(fingerprint.clone()) {
            stage_change(db, &Change::FontAdded(remote_asset.clone()))?;
        }
        db.upsert_sync_asset(&StoredSyncAsset {
            fingerprint,
            filename,
            extension,
            local_path: Some(path.to_string_lossy().into_owned()),
            remote_payload: serde_json::to_string(&remote_asset)?,
            cloud_only: false,
            deleted: false,
        })?;
    }
    Ok(())
}

async fn publish_local_events(
    db: &FolioDatabase,
    remote: &WebDavClient,
    cancelled: &AtomicBool,
    report: &Arc<dyn Fn(SyncProgress) + Send + Sync>,
    progress: &mut SyncProgress,
) -> Result<(), SyncError> {
    let assets = db
        .list_sync_assets()?
        .into_iter()
        .map(|asset| (asset.fingerprint.clone(), asset))
        .collect::<BTreeMap<_, _>>();
    for event in db
        .list_sync_events()?
        .into_iter()
        .filter(|event| !event.published)
    {
        if cancelled.load(Ordering::Relaxed) {
            return Err(SyncError::Cancelled);
        }
        let change: Change = serde_json::from_str(&event.payload)?;
        if let Change::FontAdded(asset) = &change {
            let object_path = ["Folio", "v1", "objects", asset.fingerprint.as_str()];
            if !run_or_cancel(remote.exists(&object_path), cancelled).await? {
                let path = assets
                    .get(&asset.fingerprint)
                    .and_then(|record| record.local_path.as_ref())
                    .ok_or(SyncError::InvalidFont)?;
                let bytes = std::fs::read(path)?;
                if ContentFingerprint::from_bytes(&bytes).to_hex() != asset.fingerprint {
                    return Err(SyncError::InvalidFont);
                }
                let length = bytes.len() as u64;
                run_or_cancel(remote.put(&object_path, bytes), cancelled).await?;
                progress.uploaded_files += 1;
                progress.uploaded_bytes += length;
                (report)(*progress);
            }
        }
        let wire = RemoteEvent {
            format_version: FORMAT_VERSION,
            id: event.id.clone(),
            device_id: event.device_id.clone(),
            sequence: event.sequence,
            change,
        };
        let filename = format!("{}.json", event.id);
        run_or_cancel(
            remote.put(
                &["Folio", "v1", "events", &event.device_id, &filename],
                serde_json::to_vec(&wire)?,
            ),
            cancelled,
        )
        .await?;
        db.mark_sync_event_published(&event.id)?;
    }
    Ok(())
}

async fn receive_remote_events(
    db: &FolioDatabase,
    remote: &WebDavClient,
    cancelled: &AtomicBool,
    report: &Arc<dyn Fn(SyncProgress) + Send + Sync>,
    progress: &mut SyncProgress,
) -> Result<(), SyncError> {
    let mut known = db
        .list_sync_events()?
        .into_iter()
        .map(|event| event.id)
        .collect::<BTreeSet<_>>();
    let devices = run_or_cancel(remote.list(&["Folio", "v1", "events"]), cancelled).await?;
    for device in devices {
        if device.len() != 32 || !device.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(SyncError::InvalidDavResponse);
        }
        let cursor = db.sync_remote_cursor(&device)?;
        let names =
            run_or_cancel(remote.list(&["Folio", "v1", "events", &device]), cancelled).await?;
        for name in names {
            if cancelled.load(Ordering::Relaxed) {
                return Err(SyncError::Cancelled);
            }
            let Some(id) = name.strip_suffix(".json") else {
                return Err(SyncError::InvalidDavResponse);
            };
            let sequence = id
                .strip_prefix(&format!("{device}-"))
                .and_then(|value| value.parse::<i64>().ok())
                .filter(|value| *value > 0)
                .ok_or(SyncError::InvalidDavResponse)?;
            if sequence <= cursor {
                continue;
            }
            if known.contains(id) {
                continue;
            }
            let bytes = run_or_cancel(
                remote.get(&["Folio", "v1", "events", &device, &name]),
                cancelled,
            )
            .await?;
            let wire: RemoteEvent = serde_json::from_slice(&bytes)?;
            if wire.format_version != FORMAT_VERSION {
                return Err(SyncError::UnsupportedFormat);
            }
            if wire.id != id || wire.device_id != device || wire.sequence != sequence {
                return Err(SyncError::InvalidDavResponse);
            }
            let inserted = db.insert_remote_sync_event(&StoredSyncEvent {
                id: wire.id.clone(),
                device_id: wire.device_id,
                sequence: wire.sequence,
                payload: serde_json::to_string(&wire.change)?,
                published: true,
            })?;
            known.insert(wire.id);
            if inserted {
                progress.received_changes += 1;
                (report)(*progress);
            }
        }
    }
    Ok(())
}

fn active_add_tags(
    events: &[(StoredSyncEvent, Change)],
    is_add: impl Fn(&Change) -> bool,
    remove_tags: impl Fn(&Change) -> Option<&[String]>,
) -> Vec<String> {
    let adds = events
        .iter()
        .filter(|(_, change)| is_add(change))
        .map(|(event, _)| event.id.clone())
        .collect::<BTreeSet<_>>();
    let removed = events
        .iter()
        .filter_map(|(_, change)| remove_tags(change))
        .flat_map(|tags| tags.iter().cloned())
        .collect::<BTreeSet<_>>();
    adds.difference(&removed).cloned().collect()
}

fn favorite_add_tags(events: &[(StoredSyncEvent, Change)], identity: &str) -> Vec<String> {
    active_add_tags(
        events,
        |change| matches!(change, Change::FavoriteAdded { identity_id } if identity_id == identity),
        |change| match change {
            Change::FavoriteRemoved {
                identity_id,
                observed_adds,
            } if identity_id == identity => Some(observed_adds),
            _ => None,
        },
    )
}

fn member_add_tags(
    events: &[(StoredSyncEvent, Change)],
    collection: &str,
    identity: &str,
) -> Vec<String> {
    active_add_tags(
        events,
        |change| matches!(change, Change::MemberAdded { collection_id, identity_id } if collection_id == collection && identity_id == identity),
        |change| match change {
            Change::MemberRemoved {
                collection_id,
                identity_id,
                observed_adds,
            } if collection_id == collection && identity_id == identity => Some(observed_adds),
            _ => None,
        },
    )
}

fn smart_folder_heads(
    events: &[(StoredSyncEvent, Change)],
    smart_folder: &str,
) -> BTreeMap<String, Option<WireSmartFolder>> {
    let mut values = BTreeMap::new();
    let mut superseded = BTreeSet::new();
    for (event, change) in events {
        match change {
            Change::SmartFolderSet {
                smart_folder: record,
                parents,
            } if record.id == smart_folder => {
                values.insert(event.id.clone(), Some(record.clone()));
                superseded.extend(parents.iter().cloned());
            }
            Change::SmartFolderDeleted {
                smart_folder_id,
                parents,
            } if smart_folder_id == smart_folder => {
                values.insert(event.id.clone(), None);
                superseded.extend(parents.iter().cloned());
            }
            _ => {}
        }
    }
    values.retain(|id, _| !superseded.contains(id));
    values
}

fn collection_heads(
    events: &[(StoredSyncEvent, Change)],
    collection: &str,
) -> BTreeMap<String, Option<WireCollection>> {
    let mut values = BTreeMap::new();
    let mut superseded = BTreeSet::new();
    for (event, change) in events {
        match change {
            Change::CollectionSet {
                collection: record,
                parents,
            } if record.id == collection => {
                values.insert(event.id.clone(), Some(record.clone()));
                superseded.extend(parents.iter().cloned());
            }
            Change::CollectionDeleted {
                collection_id,
                parents,
            } if collection_id == collection => {
                values.insert(event.id.clone(), None);
                superseded.extend(parents.iter().cloned());
            }
            _ => {}
        }
    }
    values.retain(|id, _| !superseded.contains(id));
    values
}

async fn apply_remote_events(
    db: &mut FolioDatabase,
    directory: &Path,
    remote: &WebDavClient,
    cancelled: &AtomicBool,
    report: &Arc<dyn Fn(SyncProgress) + Send + Sync>,
    progress: &mut SyncProgress,
) -> Result<(), SyncError> {
    let events = decoded_events(db)?;
    let mut collection_ids = BTreeSet::new();
    let mut smart_folder_ids = BTreeSet::new();
    let mut favorite_ids = BTreeSet::new();
    let mut member_ids = BTreeSet::new();
    let mut recent = BTreeMap::<String, i64>::new();
    let mut font_assets = BTreeMap::<String, RemoteAsset>::new();

    for (_, change) in &events {
        match change {
            Change::CollectionSet { collection, .. } => {
                collection_ids.insert(collection.id.clone());
            }
            Change::CollectionDeleted { collection_id, .. } => {
                collection_ids.insert(collection_id.clone());
            }
            Change::SmartFolderSet { smart_folder, .. } => {
                smart_folder_ids.insert(smart_folder.id.clone());
            }
            Change::SmartFolderDeleted {
                smart_folder_id, ..
            } => {
                smart_folder_ids.insert(smart_folder_id.clone());
            }
            Change::FavoriteAdded { identity_id } | Change::FavoriteRemoved { identity_id, .. } => {
                favorite_ids.insert(identity_id.clone());
            }
            Change::MemberAdded {
                collection_id,
                identity_id,
            }
            | Change::MemberRemoved {
                collection_id,
                identity_id,
                ..
            } => {
                member_ids.insert((collection_id.clone(), identity_id.clone()));
            }
            Change::RecentViewed {
                identity_id,
                timestamp_ns,
            } => {
                let entry = recent.entry(identity_id.clone()).or_default();
                *entry = (*entry).max(*timestamp_ns);
            }
            Change::FontAdded(asset) => {
                font_assets
                    .entry(asset.fingerprint.clone())
                    .or_insert_with(|| asset.clone());
            }
            Change::FontDeleted { .. } => {}
        }
    }

    for id in collection_ids {
        let heads = collection_heads(&events, &id);
        if heads.len() > 1 {
            record_conflict(
                db,
                SyncConflict {
                    id: format!("collection-{id}"),
                    kind: "collection".to_owned(),
                    title: "收藏夹内容冲突".to_owned(),
                    detail: "多台设备同时修改了这个收藏夹，请选择要保留的内容。".to_owned(),
                    local_fingerprint: None,
                    remote_fingerprint: None,
                },
            )?;
            continue;
        }
        match heads.into_values().next() {
            Some(Some(collection)) => {
                let collection = collection.decode()?;
                match db.upsert_remote_collection(&collection) {
                    Ok(()) => {}
                    Err(folio_storage::StorageError::CollectionNameConflict) => {
                        record_conflict(
                            db,
                            SyncConflict {
                                id: format!("collection-name-{}", collection.id),
                                kind: "collection_name".to_owned(),
                                title: "收藏夹名称重复".to_owned(),
                                detail: format!(
                                    "“{}”已被另一个收藏夹使用，请先调整名称。",
                                    collection.name
                                ),
                                local_fingerprint: None,
                                remote_fingerprint: None,
                            },
                        )?;
                    }
                    Err(error) => return Err(error.into()),
                }
            }
            Some(None) => {
                let parsed = CollectionId::from_bytes(parse_id(&id)?);
                if db.list_collections()?.iter().any(|item| item.id == parsed) {
                    db.delete_collection(parsed)?;
                }
            }
            None => {}
        }
    }

    for id in smart_folder_ids {
        let heads = smart_folder_heads(&events, &id);
        if heads.len() > 1 {
            record_conflict(
                db,
                SyncConflict {
                    id: format!("smart_folder-{id}"),
                    kind: "smart_folder".to_owned(),
                    title: "智慧收藏夹内容冲突".to_owned(),
                    detail: "多台设备同时修改了这个智慧收藏夹，请选择要保留的规则。".to_owned(),
                    local_fingerprint: None,
                    remote_fingerprint: None,
                },
            )?;
            continue;
        }
        match heads.into_values().next() {
            Some(Some(folder)) => {
                let folder = folder.decode()?;
                match db.upsert_remote_smart_folder(&folder) {
                    Ok(()) => {}
                    Err(folio_storage::StorageError::SmartFolderNameConflict) => {
                        record_conflict(
                            db,
                            SyncConflict {
                                id: format!("smart_folder_name-{}", folder.id),
                                kind: "smart_folder_name".to_owned(),
                                title: "智慧收藏夹名称重复".to_owned(),
                                detail: format!(
                                    "“{}”已被另一个智慧收藏夹使用，请先调整名称。",
                                    folder.name
                                ),
                                local_fingerprint: None,
                                remote_fingerprint: None,
                            },
                        )?;
                    }
                    Err(error) => return Err(error.into()),
                }
            }
            Some(None) => {
                let parsed = SmartFolderId::from_bytes(parse_id(&id)?);
                if db
                    .list_smart_folders()?
                    .iter()
                    .any(|item| item.id == parsed)
                {
                    db.delete_smart_folder(parsed)?;
                }
            }
            None => {}
        }
    }

    let current = capture_user_state(db)?;
    for id in favorite_ids {
        let effective = !favorite_add_tags(&events, &id).is_empty();
        let present = current.favorites.contains(&id);
        if effective != present {
            db.set_favorite(FontIdentityId::from_bytes(parse_id(&id)?), effective)?;
        }
    }
    let known_collections = db
        .list_collections()?
        .into_iter()
        .map(|item| item.id.to_string())
        .collect::<BTreeSet<_>>();
    let current = capture_user_state(db)?;
    for (collection_id, identity_id) in member_ids {
        if !known_collections.contains(&collection_id) {
            continue;
        }
        let effective = !member_add_tags(&events, &collection_id, &identity_id).is_empty();
        let present = current
            .members
            .contains(&(collection_id.clone(), identity_id.clone()));
        if effective != present {
            let collection = CollectionId::from_bytes(parse_id(&collection_id)?);
            let identity = FontIdentityId::from_bytes(parse_id(&identity_id)?);
            if effective {
                db.add_collection_members(collection, &[identity])?;
            } else {
                db.remove_collection_members(collection, &[identity])?;
            }
        }
    }
    for (identity, timestamp) in recent {
        db.set_recent_at(FontIdentityId::from_bytes(parse_id(&identity)?), timestamp)?;
    }

    let mut existing_assets = db
        .list_sync_assets()?
        .into_iter()
        .map(|asset| (asset.fingerprint.clone(), asset))
        .collect::<BTreeMap<_, _>>();
    let mut catalog_changed = false;
    for (fingerprint, remote_asset) in &font_assets {
        if cancelled.load(Ordering::Relaxed) {
            return Err(SyncError::Cancelled);
        }
        let active = !asset_add_tags(&events, fingerprint).is_empty();
        let record = existing_assets.remove(fingerprint);
        if !active {
            if let Some(mut asset) = record {
                if !asset.deleted {
                    move_to_recovery(directory, &asset)?;
                    catalog_changed = true;
                }
                asset.local_path = None;
                asset.deleted = true;
                db.upsert_sync_asset(&asset)?;
            }
            continue;
        }
        let mut asset = record.unwrap_or_else(|| StoredSyncAsset {
            fingerprint: fingerprint.clone(),
            filename: remote_asset.filename.clone(),
            extension: remote_asset.extension.clone(),
            local_path: None,
            remote_payload: String::new(),
            cloud_only: false,
            deleted: false,
        });
        asset.remote_payload = serde_json::to_string(remote_asset)?;
        asset.deleted = false;
        if !asset.cloud_only
            && asset
                .local_path
                .as_ref()
                .is_none_or(|path| !Path::new(path).is_file())
        {
            let path = download_asset(remote, directory, remote_asset, cancelled).await?;
            asset.local_path = Some(path.to_string_lossy().into_owned());
            progress.downloaded_files += 1;
            progress.downloaded_bytes += remote_asset.file_size;
            (report)(*progress);
            catalog_changed = true;
        }
        db.upsert_sync_asset(&asset)?;
    }

    if catalog_changed {
        db.add_root(directory, true)?;
        db.refresh(RefreshMode::Incremental)?;
    }
    detect_font_conflicts(db, &font_assets, &events)?;
    Ok(())
}

fn record_conflict(db: &FolioDatabase, conflict: SyncConflict) -> Result<(), SyncError> {
    db.insert_sync_conflict(&StoredSyncConflict {
        id: conflict.id.clone(),
        kind: conflict.kind.clone(),
        payload: serde_json::to_string(&conflict)?,
    })?;
    Ok(())
}

async fn download_asset(
    remote: &WebDavClient,
    directory: &Path,
    asset: &RemoteAsset,
    cancelled: &AtomicBool,
) -> Result<PathBuf, SyncError> {
    if !matches!(asset.extension.as_str(), "ttf" | "otf" | "ttc" | "otc")
        || asset.fingerprint.len() != 64
        || !asset
            .fingerprint
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(SyncError::InvalidFont);
    }
    let bytes = run_or_cancel(
        remote.get(&["Folio", "v1", "objects", &asset.fingerprint]),
        cancelled,
    )
    .await?;
    if bytes.len() as u64 != asset.file_size
        || ContentFingerprint::from_bytes(&bytes).to_hex() != asset.fingerprint
    {
        return Err(SyncError::InvalidFont);
    }
    let destination = directory.join(format!("{}.{}", asset.fingerprint, asset.extension));
    let parsed = parse_font_data(&destination, &bytes, bytes.len() as u64, None)?;
    let mut actual = parsed
        .faces
        .iter()
        .map(|face| (face.identity.id.to_string(), face.revision.id.to_string()))
        .collect::<Vec<_>>();
    let mut expected = asset
        .faces
        .iter()
        .map(|face| (face.identity_id.clone(), face.revision_id.clone()))
        .collect::<Vec<_>>();
    actual.sort();
    expected.sort();
    if actual != expected {
        return Err(SyncError::InvalidFont);
    }
    let temporary = directory.join(format!(
        ".{}.{}.part",
        asset.fingerprint,
        std::process::id()
    ));
    std::fs::write(&temporary, bytes)?;
    if !destination.exists() {
        std::fs::rename(&temporary, &destination)?;
    } else {
        std::fs::remove_file(&temporary)?;
    }
    Ok(destination)
}

fn move_to_recovery(directory: &Path, asset: &StoredSyncAsset) -> Result<(), SyncError> {
    let Some(path) = &asset.local_path else {
        return Ok(());
    };
    let path = Path::new(path);
    if !path.is_file() {
        return Ok(());
    }
    let recovery = directory.parent().unwrap_or(directory).join("SyncRecovery");
    std::fs::create_dir_all(&recovery)?;
    let target = recovery.join(format!("{}.{}", asset.fingerprint, asset.extension));
    if target.exists() {
        std::fs::remove_file(path)?;
    } else {
        std::fs::rename(path, target)?;
    }
    Ok(())
}

fn detect_font_conflicts(
    db: &FolioDatabase,
    assets: &BTreeMap<String, RemoteAsset>,
    events: &[(StoredSyncEvent, Change)],
) -> Result<(), SyncError> {
    let mut by_identity = BTreeMap::<String, Vec<(&str, &RemoteFace)>>::new();
    for (fingerprint, asset) in assets {
        if asset_add_tags(events, fingerprint).is_empty() {
            continue;
        }
        for face in &asset.faces {
            by_identity
                .entry(face.identity_id.clone())
                .or_default()
                .push((fingerprint, face));
        }
    }
    let local = db
        .list_sync_assets()?
        .into_iter()
        .map(|asset| (asset.fingerprint.clone(), asset))
        .collect::<BTreeMap<_, _>>();
    for (identity, faces) in by_identity {
        for first in 0..faces.len() {
            for second in first + 1..faces.len() {
                let (a_hash, a_face) = faces[first];
                let (b_hash, b_face) = faces[second];
                if a_face.revision_id == b_face.revision_id {
                    continue;
                }
                let (local_hash, remote_hash) = if local
                    .get(a_hash)
                    .is_some_and(|asset| asset.local_path.is_some())
                {
                    (a_hash, b_hash)
                } else {
                    (b_hash, a_hash)
                };
                record_conflict(
                    db,
                    SyncConflict {
                        id: format!("revision-{identity}-{a_hash}-{b_hash}"),
                        kind: "font_revision".to_owned(),
                        title: format!("{}有多个版本", a_face.display_name),
                        detail: "两个版本均已保留，请选择要继续使用的版本。".to_owned(),
                        local_fingerprint: Some(local_hash.to_owned()),
                        remote_fingerprint: Some(remote_hash.to_owned()),
                    },
                )?;
            }
        }
    }
    Ok(())
}
