//! Folio 的 Swift 友好粗粒度桥接层。

#![forbid(unsafe_code)]

use std::collections::BTreeSet;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use folio_core::{
    Catalog, CollectionColor, CollectionIcon, CollectionId, FontCategory, FontFace, FontFaceId,
    FontFamilyId, FontIdentityId, LicenseKind,
};
use folio_query::{
    FacetFilter, FacetValue, FontQuery, FontQueryIndex, FoundryKey, QueryScope, QuerySort,
};
use folio_storage::{AddRootOutcome, FolioDatabase, RefreshIssueKind, RefreshMode};
use folio_sync::{ConflictResolution, SyncProfile, SyncProgress};

uniffi::setup_scaffolding!();

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum FolioFfiError {
    #[error("{message}")]
    Operation { message: String },
}

impl FolioFfiError {
    fn operation(error: impl std::fmt::Display) -> Self {
        Self::Operation {
            message: error.to_string(),
        }
    }
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct FamilyIdDto {
    pub value: String,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct FaceIdDto {
    pub value: String,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct IdentityIdDto {
    pub value: String,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct CollectionIdDto {
    pub value: String,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct RootIdDto {
    pub value: String,
}

#[derive(Clone, Copy, Debug, Default, uniffi::Enum)]
pub enum QueryScopeDto {
    #[default]
    All,
    Favorites,
    Recent,
    Collection,
}

#[derive(Clone, Copy, Debug, uniffi::Enum)]
pub enum FacetKindDto {
    Category,
    Script,
    Foundry,
    License,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct FacetSelectionDto {
    pub kind: FacetKindDto,
    pub value: String,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct LibraryQueryDto {
    pub text: Option<String>,
    pub scope: QueryScopeDto,
    pub collection_id: Option<CollectionIdDto>,
    pub facets: Vec<FacetSelectionDto>,
    pub allowed_face_ids: Option<Vec<FaceIdDto>>,
    pub allowed_source_paths: Option<Vec<String>>,
    pub offset: u64,
    pub limit: u64,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct VariableAxisDto {
    pub tag: String,
    pub name: String,
    pub min_value: f64,
    pub default_value: f64,
    pub max_value: f64,
    pub hidden: bool,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct FaceSummaryDto {
    pub id: FaceIdDto,
    pub identity_id: IdentityIdDto,
    pub revision_id: String,
    pub style_name: String,
    pub postscript_name: Option<String>,
    pub full_name: Option<String>,
    pub format: String,
    pub is_variable: bool,
    pub weight: Option<f64>,
    pub width: Option<f64>,
    pub source_path: Option<String>,
    pub sources: Vec<FontSourceDto>,
    pub face_index: u32,
    pub file_size: u64,
    pub version: Option<String>,
    pub manufacturer: Option<String>,
    pub designer: Option<String>,
    pub copyright: Option<String>,
    pub category: String,
    pub license: String,
    pub scripts: Vec<String>,
    pub axes: Vec<VariableAxisDto>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct FontSourceDto {
    pub path: String,
    pub face_index: u32,
    pub root_ids: Vec<RootIdDto>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct LibraryFaceSourcesDto {
    pub family_id: FamilyIdDto,
    pub face_id: FaceIdDto,
    pub paths: Vec<String>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct FamilyCardDto {
    pub id: FamilyIdDto,
    pub display_name: String,
    pub faces: Vec<FaceSummaryDto>,
    pub identity_ids: Vec<IdentityIdDto>,
    pub matched_face_ids: Vec<FaceIdDto>,
    pub is_favorite: bool,
    pub is_variable: bool,
    pub manufacturer: Option<String>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct FacetCountDto {
    pub kind: FacetKindDto,
    pub value: String,
    pub label: String,
    pub family_count: u64,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct LibraryPageDto {
    pub total_matches: u64,
    pub families: Vec<FamilyCardDto>,
    pub facets: Vec<FacetCountDto>,
    pub unresolved_scope_items: u64,
    pub cloud_only_fonts: Vec<CloudFontDto>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct FamilyDetailsDto {
    pub id: FamilyIdDto,
    pub display_name: String,
    pub faces: Vec<FaceSummaryDto>,
    pub identity_ids: Vec<IdentityIdDto>,
    pub is_favorite: bool,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct CollectionDto {
    pub id: CollectionIdDto,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub member_count: u64,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct RootDto {
    pub id: RootIdDto,
    pub display_path: String,
    pub recursive: bool,
    pub kind: String,
    pub path_is_lossless: bool,
}

#[derive(Clone, Debug, Default, uniffi::Record)]
pub struct HealthSummaryDto {
    pub damaged_files: u64,
    pub duplicate_sources: u64,
    pub multiple_revisions: u64,
    pub metadata_conflicts: u64,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct LibrarySnapshotDto {
    pub family_count: u64,
    pub face_count: u64,
    pub variable_family_count: u64,
    pub recent_count: u64,
    pub collections: Vec<CollectionDto>,
    pub roots: Vec<RootDto>,
    pub health: HealthSummaryDto,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct RefreshOutcomeDto {
    pub snapshot: LibrarySnapshotDto,
    pub candidate_files: u64,
    pub files_reparsed: u64,
    pub files_added: u64,
    pub files_changed: u64,
    pub files_removed: u64,
    pub issue_count: u64,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct SyncProfileDto {
    pub server_url: String,
    pub remote_directory: String,
    pub username: String,
    pub automatic: bool,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct SyncStatusDto {
    pub phase: String,
    pub is_running: bool,
    pub uploaded_files: u64,
    pub downloaded_files: u64,
    pub uploaded_bytes: u64,
    pub downloaded_bytes: u64,
    pub received_changes: u64,
    pub completion_generation: u64,
    pub last_synced_at_ms: Option<u64>,
    pub error_message: Option<String>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct CloudFontDto {
    pub fingerprint: String,
    pub display_name: String,
    pub filename: String,
    pub file_size: u64,
    pub cloud_only: bool,
    pub deleted: bool,
    pub local_path: Option<String>,
    pub identity_ids: Vec<String>,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct SyncConflictDto {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub detail: String,
    pub local_fingerprint: Option<String>,
    pub remote_fingerprint: Option<String>,
}

#[derive(Clone, Copy, Debug, uniffi::Enum)]
pub enum SyncResolutionDto {
    KeepBoth,
    UseLocal,
    UseRemote,
}

struct SyncRunState {
    phase: String,
    running: bool,
    progress: SyncProgress,
    completion_generation: u64,
    last_synced_at_ms: Option<u64>,
    error_message: Option<String>,
}

#[derive(uniffi::Object)]
pub struct FolioSync {
    database_path: String,
    managed_directory: String,
    state: Arc<Mutex<SyncRunState>>,
    cancelled: Arc<AtomicBool>,
}

#[uniffi::export]
impl FolioSync {
    #[uniffi::constructor]
    pub fn open(
        database_path: String,
        managed_directory: String,
    ) -> Result<Arc<Self>, FolioFfiError> {
        let db = FolioDatabase::open(&database_path).map_err(FolioFfiError::operation)?;
        let connected = folio_sync::load_profile(&database_path)
            .map_err(FolioFfiError::operation)?
            .is_some();
        let last_synced_at_ms = db
            .sync_metadata("last_successful_sync_ms")
            .map_err(FolioFfiError::operation)?
            .and_then(|value| value.parse().ok());
        Ok(Arc::new(Self {
            database_path,
            managed_directory,
            state: Arc::new(Mutex::new(SyncRunState {
                phase: if connected { "待同步" } else { "未连接" }.to_owned(),
                running: false,
                progress: SyncProgress::default(),
                completion_generation: 0,
                last_synced_at_ms,
                error_message: None,
            })),
            cancelled: Arc::new(AtomicBool::new(false)),
        }))
    }

    pub fn profile(&self) -> Result<Option<SyncProfileDto>, FolioFfiError> {
        folio_sync::load_profile(&self.database_path)
            .map(|profile| {
                profile.map(|value| SyncProfileDto {
                    server_url: value.server_url,
                    remote_directory: value.remote_directory,
                    username: value.username,
                    automatic: value.automatic,
                })
            })
            .map_err(FolioFfiError::operation)
    }

    pub fn save_profile(&self, profile: SyncProfileDto) -> Result<(), FolioFfiError> {
        self.require_idle()?;
        folio_sync::save_profile(
            &self.database_path,
            &SyncProfile {
                server_url: profile.server_url,
                remote_directory: profile.remote_directory,
                username: profile.username,
                automatic: profile.automatic,
            },
        )
        .map_err(FolioFfiError::operation)?;
        self.state.lock().map_err(FolioFfiError::operation)?.phase = "待同步".to_owned();
        Ok(())
    }

    pub fn disconnect(&self) -> Result<(), FolioFfiError> {
        self.require_idle()?;
        folio_sync::disconnect(&self.database_path).map_err(FolioFfiError::operation)?;
        self.state.lock().map_err(FolioFfiError::operation)?.phase = "未连接".to_owned();
        Ok(())
    }

    pub fn test_connection(
        &self,
        profile: SyncProfileDto,
        password: String,
    ) -> Result<(), FolioFfiError> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(FolioFfiError::operation)?;
        runtime
            .block_on(folio_sync::test_connection(
                &SyncProfile {
                    server_url: profile.server_url,
                    remote_directory: profile.remote_directory,
                    username: profile.username,
                    automatic: profile.automatic,
                },
                &password,
            ))
            .map_err(FolioFfiError::operation)
    }

    pub fn start_sync(&self, password: String) -> Result<bool, FolioFfiError> {
        let mut state = self.state.lock().map_err(FolioFfiError::operation)?;
        if state.running {
            return Ok(false);
        }
        if folio_sync::load_profile(&self.database_path)
            .map_err(FolioFfiError::operation)?
            .is_none()
        {
            return Err(FolioFfiError::operation("请先连接 WebDAV"));
        }
        state.phase = "同步中".to_owned();
        state.running = true;
        state.progress = SyncProgress::default();
        state.error_message = None;
        self.cancelled.store(false, Ordering::Relaxed);
        let database_path = self.database_path.clone();
        let managed_directory = self.managed_directory.clone();
        let shared_state = self.state.clone();
        let cancelled = self.cancelled.clone();
        std::thread::spawn(move || {
            let status_for_progress = shared_state.clone();
            let callback: Arc<dyn Fn(SyncProgress) + Send + Sync> = Arc::new(move |progress| {
                if let Ok(mut state) = status_for_progress.lock() {
                    state.progress = progress;
                }
            });
            let result = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|error| error.to_string())
                .and_then(|runtime| {
                    runtime
                        .block_on(folio_sync::synchronize(
                            &database_path,
                            &managed_directory,
                            &password,
                            cancelled,
                            callback,
                        ))
                        .map_err(|error| error.to_string())
                });
            if let Ok(mut state) = shared_state.lock() {
                state.running = false;
                state.completion_generation += 1;
                match result {
                    Ok(progress) => {
                        state.progress = progress;
                        state.phase = "已同步".to_owned();
                        state.last_synced_at_ms = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .ok()
                            .map(|time| time.as_millis() as u64);
                    }
                    Err(error) => {
                        state.phase = if error == "同步已取消" {
                            "已取消"
                        } else {
                            "同步失败"
                        }
                        .to_owned();
                        state.error_message = Some(error);
                    }
                }
            }
        });
        Ok(true)
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }

    pub fn status(&self) -> Result<SyncStatusDto, FolioFfiError> {
        let state = self.state.lock().map_err(FolioFfiError::operation)?;
        Ok(SyncStatusDto {
            phase: state.phase.clone(),
            is_running: state.running,
            uploaded_files: state.progress.uploaded_files,
            downloaded_files: state.progress.downloaded_files,
            uploaded_bytes: state.progress.uploaded_bytes,
            downloaded_bytes: state.progress.downloaded_bytes,
            received_changes: state.progress.received_changes,
            completion_generation: state.completion_generation,
            last_synced_at_ms: state.last_synced_at_ms,
            error_message: state.error_message.clone(),
        })
    }

    pub fn cloud_fonts(&self) -> Result<Vec<CloudFontDto>, FolioFfiError> {
        folio_sync::list_cloud_fonts(&self.database_path)
            .map(|items| {
                items
                    .into_iter()
                    .map(|item| CloudFontDto {
                        fingerprint: item.fingerprint,
                        display_name: item.display_name,
                        filename: item.filename,
                        file_size: item.file_size,
                        cloud_only: item.cloud_only,
                        deleted: item.deleted,
                        local_path: item.local_path,
                        identity_ids: item.identity_ids,
                    })
                    .collect()
            })
            .map_err(FolioFfiError::operation)
    }

    pub fn conflicts(&self) -> Result<Vec<SyncConflictDto>, FolioFfiError> {
        folio_sync::list_conflicts(&self.database_path)
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
            .map_err(FolioFfiError::operation)
    }

    pub fn resolve_conflict(
        &self,
        id: String,
        resolution: SyncResolutionDto,
    ) -> Result<(), FolioFfiError> {
        self.require_idle()?;
        let value = match resolution {
            SyncResolutionDto::KeepBoth => ConflictResolution::KeepBoth,
            SyncResolutionDto::UseLocal => ConflictResolution::UseLocal,
            SyncResolutionDto::UseRemote => ConflictResolution::UseRemote,
        };
        folio_sync::resolve_conflict(&self.database_path, &id, value)
            .map_err(FolioFfiError::operation)
    }

    pub fn set_cloud_only(&self, fingerprint: String) -> Result<(), FolioFfiError> {
        self.require_idle()?;
        folio_sync::set_cloud_only(&self.database_path, &fingerprint)
            .map_err(FolioFfiError::operation)
    }

    pub fn mark_cloud_only_for_path(&self, path: String) -> Result<bool, FolioFfiError> {
        self.require_idle()?;
        folio_sync::mark_cloud_only_for_path(&self.database_path, path)
            .map_err(FolioFfiError::operation)
    }

    pub fn restore_cloud_font(&self, fingerprint: String) -> Result<(), FolioFfiError> {
        self.require_idle()?;
        folio_sync::request_restore(&self.database_path, &fingerprint)
            .map_err(FolioFfiError::operation)
    }

    pub fn restore_deleted_font(&self, fingerprint: String) -> Result<(), FolioFfiError> {
        self.require_idle()?;
        folio_sync::restore_deleted_font(&self.database_path, &fingerprint)
            .map_err(FolioFfiError::operation)
    }

    pub fn delete_everywhere(&self, fingerprint: String) -> Result<(), FolioFfiError> {
        self.require_idle()?;
        folio_sync::delete_everywhere(&self.database_path, &fingerprint)
            .map_err(FolioFfiError::operation)
    }
}

impl FolioSync {
    fn require_idle(&self) -> Result<(), FolioFfiError> {
        if self.state.lock().map_err(FolioFfiError::operation)?.running {
            Err(FolioFfiError::operation("请先取消当前同步"))
        } else {
            Ok(())
        }
    }
}

struct EngineState {
    database: FolioDatabase,
    catalog: Catalog,
    index: FontQueryIndex,
    damaged_files: u64,
}

#[derive(uniffi::Object)]
pub struct FolioEngine {
    state: Mutex<EngineState>,
}

#[uniffi::export]
impl FolioEngine {
    #[uniffi::constructor]
    pub fn open(database_path: String) -> Result<Arc<Self>, FolioFfiError> {
        let mut database = FolioDatabase::open(&database_path).map_err(FolioFfiError::operation)?;
        let catalog = database
            .load_cached_catalog()
            .map_err(FolioFfiError::operation)?;
        let state = database
            .library_state_snapshot()
            .map_err(FolioFfiError::operation)?;
        let index = FontQueryIndex::build(&catalog, &state).map_err(FolioFfiError::operation)?;
        Ok(Arc::new(Self {
            state: Mutex::new(EngineState {
                database,
                catalog,
                index,
                damaged_files: 0,
            }),
        }))
    }

    pub fn load_cached_library(&self) -> Result<LibrarySnapshotDto, FolioFfiError> {
        let mut state = self.lock()?;
        state.catalog = state
            .database
            .load_cached_catalog()
            .map_err(FolioFfiError::operation)?;
        rebuild_index(&mut state)?;
        snapshot(&mut state)
    }

    pub fn refresh_library(&self) -> Result<RefreshOutcomeDto, FolioFfiError> {
        let mut state = self.lock()?;
        let result = state
            .database
            .refresh(RefreshMode::Incremental)
            .map_err(FolioFfiError::operation)?;
        state.damaged_files = result
            .issues
            .iter()
            .filter(|issue| issue.kind == RefreshIssueKind::MalformedFont)
            .count() as u64;
        state.catalog = result.catalog;
        let stats = result.stats;
        let issue_count = result.issues.len() as u64;
        rebuild_index(&mut state)?;
        Ok(RefreshOutcomeDto {
            snapshot: snapshot(&mut state)?,
            candidate_files: stats.candidate_files,
            files_reparsed: stats.files_reparsed,
            files_added: stats.files_added,
            files_changed: stats.files_changed,
            files_removed: stats.files_removed,
            issue_count,
        })
    }

    pub fn add_library_root(&self, path: String) -> Result<RootDto, FolioFfiError> {
        let state = self.lock()?;
        let outcome = state
            .database
            .add_root(Path::new(&path), true)
            .map_err(FolioFfiError::operation)?;
        let root = match outcome {
            AddRootOutcome::Created(root) | AddRootOutcome::Existing(root) => root,
        };
        Ok(root_dto(&root))
    }

    pub fn add_font_file(&self, path: String) -> Result<RootDto, FolioFfiError> {
        let state = self.lock()?;
        let outcome = state
            .database
            .add_file_root(Path::new(&path))
            .map_err(FolioFfiError::operation)?;
        let root = match outcome {
            AddRootOutcome::Created(root) | AddRootOutcome::Existing(root) => root,
        };
        Ok(root_dto(&root))
    }

    pub fn validate_font_file(&self, path: String) -> Result<(), FolioFfiError> {
        let parsed =
            folio_core::parse_font_file(Path::new(&path)).map_err(FolioFfiError::operation)?;
        if parsed.faces.is_empty() {
            return Err(FolioFfiError::Operation {
                message: "字体文件没有可用的字款".to_owned(),
            });
        }
        Ok(())
    }

    pub fn remove_library_root(&self, id: RootIdDto) -> Result<(), FolioFfiError> {
        let state = self.lock()?;
        let id = folio_storage::LibraryRootId::from_bytes(parse_id(&id.value)?);
        state
            .database
            .remove_root(id)
            .map_err(FolioFfiError::operation)?;
        Ok(())
    }

    pub fn query_library(&self, query: LibraryQueryDto) -> Result<LibraryPageDto, FolioFfiError> {
        let state = self.lock()?;
        let cloud_text = query.text.clone().unwrap_or_default();
        let cloud_scope = query.scope;
        let cloud_collection = query.collection_id.clone();
        let include_cloud = query.allowed_face_ids.is_none()
            && query.allowed_source_paths.is_none()
            && query.facets.is_empty();
        let allowed_face_ids = query
            .allowed_face_ids
            .as_ref()
            .map(|ids| {
                ids.iter()
                    .map(|id| parse_id(&id.value).map(FontFaceId::from_bytes))
                    .collect::<Result<BTreeSet<_>, _>>()
            })
            .transpose()?;
        let allowed_source_paths = query
            .allowed_source_paths
            .as_ref()
            .map(|paths| paths.iter().cloned().collect::<BTreeSet<_>>());
        let query = query_from_dto(query)?;
        let result = state
            .index
            .query_with_faces(&query, allowed_face_ids.as_ref())
            .map_err(FolioFfiError::operation)?;
        let favorites = state
            .database
            .list_favorites()
            .map_err(FolioFfiError::operation)?
            .into_iter()
            .collect::<BTreeSet<_>>();
        let families = result
            .families
            .iter()
            .filter_map(|matched| {
                state.catalog.find_family(matched.family_id).map(|family| {
                    family_card(
                        family,
                        &matched.matched_face_ids,
                        &favorites,
                        &state.database,
                        allowed_source_paths.as_ref(),
                    )
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let scoped_ids = match cloud_scope {
            QueryScopeDto::All => None,
            QueryScopeDto::Favorites => Some(
                favorites
                    .iter()
                    .map(ToString::to_string)
                    .collect::<BTreeSet<_>>(),
            ),
            QueryScopeDto::Recent => Some(
                state
                    .database
                    .list_recent(usize::MAX)
                    .map_err(FolioFfiError::operation)?
                    .into_iter()
                    .map(|item| item.identity_id.to_string())
                    .collect(),
            ),
            QueryScopeDto::Collection => {
                let id = cloud_collection.ok_or_else(|| FolioFfiError::operation("收藏夹无效"))?;
                let collection = CollectionId::from_bytes(parse_id(&id.value)?);
                Some(
                    state
                        .database
                        .list_collection_members(collection)
                        .map_err(FolioFfiError::operation)?
                        .into_iter()
                        .map(|item| item.to_string())
                        .collect(),
                )
            }
        };
        let cloud_only_fonts = if include_cloud {
            folio_sync::list_cloud_fonts(state.database.path())
                .map_err(FolioFfiError::operation)?
                .into_iter()
                .filter(|font| font.cloud_only && !font.deleted)
                .filter(|font| {
                    cloud_text.is_empty()
                        || font
                            .display_name
                            .to_lowercase()
                            .contains(&cloud_text.to_lowercase())
                        || font
                            .filename
                            .to_lowercase()
                            .contains(&cloud_text.to_lowercase())
                })
                .filter(|font| {
                    scoped_ids
                        .as_ref()
                        .is_none_or(|ids| font.identity_ids.iter().any(|id| ids.contains(id)))
                })
                .map(|item| CloudFontDto {
                    fingerprint: item.fingerprint,
                    display_name: item.display_name,
                    filename: item.filename,
                    file_size: item.file_size,
                    cloud_only: item.cloud_only,
                    local_path: item.local_path,
                    deleted: item.deleted,
                    identity_ids: item.identity_ids,
                })
                .collect()
        } else {
            Vec::new()
        };
        Ok(LibraryPageDto {
            total_matches: result.total_matches as u64,
            families,
            facets: result
                .facet_summary
                .into_iter()
                .filter_map(facet_count)
                .collect(),
            unresolved_scope_items: result.unresolved_scope_items.len() as u64,
            cloud_only_fonts,
        })
    }

    pub fn library_face_sources(&self) -> Result<Vec<LibraryFaceSourcesDto>, FolioFfiError> {
        let state = self.lock()?;
        Ok(state
            .catalog
            .families
            .iter()
            .flat_map(|family| {
                family.faces.iter().map(|face| LibraryFaceSourcesDto {
                    family_id: family_dto(family.id),
                    face_id: face_dto(face.id),
                    paths: face
                        .sources
                        .iter()
                        .map(|source| source.path().to_string_lossy().into_owned())
                        .collect(),
                })
            })
            .collect())
    }

    pub fn family_details(
        &self,
        family_id: FamilyIdDto,
    ) -> Result<FamilyDetailsDto, FolioFfiError> {
        let state = self.lock()?;
        let id = FontFamilyId::from_bytes(parse_id(&family_id.value)?);
        let family = state
            .catalog
            .find_family(id)
            .ok_or_else(|| FolioFfiError::Operation {
                message: format!("unknown family: {}", family_id.value),
            })?;
        let favorites = state
            .database
            .list_favorites()
            .map_err(FolioFfiError::operation)?
            .into_iter()
            .collect::<BTreeSet<_>>();
        let identities = family_identities(family);
        Ok(FamilyDetailsDto {
            id: family_id,
            display_name: family
                .display_name
                .clone()
                .unwrap_or_else(|| "未命名字体".to_owned()),
            faces: family
                .faces
                .iter()
                .map(|face| face_summary(face, &state.database, None))
                .collect::<Result<Vec<_>, _>>()?,
            is_favorite: !identities.is_empty()
                && identities.iter().all(|id| favorites.contains(id)),
            identity_ids: identities.into_iter().map(identity_dto).collect(),
        })
    }

    pub fn set_favorite(
        &self,
        identity_ids: Vec<IdentityIdDto>,
        favorite: bool,
    ) -> Result<(), FolioFfiError> {
        let mut state = self.lock()?;
        let ids = parse_identity_ids(&identity_ids)?;
        state
            .database
            .bulk_set_favorite(&ids, favorite)
            .map_err(FolioFfiError::operation)?;
        update_index_state(&mut state)
    }

    pub fn record_recent(&self, identity_id: IdentityIdDto) -> Result<(), FolioFfiError> {
        let mut state = self.lock()?;
        let id = FontIdentityId::from_bytes(parse_id(&identity_id.value)?);
        state
            .database
            .record_recent(id)
            .map_err(FolioFfiError::operation)?;
        update_index_state(&mut state)
    }

    pub fn create_collection(&self, name: String) -> Result<CollectionDto, FolioFfiError> {
        self.create_collection_with_icon(
            name,
            CollectionIcon::Folder.key().to_owned(),
            CollectionColor::Gray.key().to_owned(),
        )
    }

    pub fn create_collection_with_icon(
        &self,
        name: String,
        icon: String,
        color: String,
    ) -> Result<CollectionDto, FolioFfiError> {
        let icon = CollectionIcon::from_key(&icon)
            .ok_or_else(|| FolioFfiError::operation("invalid collection icon"))?;
        let color = CollectionColor::from_key(&color)
            .ok_or_else(|| FolioFfiError::operation("invalid collection color"))?;
        let state = self.lock()?;
        let collection = state
            .database
            .create_collection_with_style(&name, icon, color)
            .map_err(FolioFfiError::operation)?;
        Ok(CollectionDto {
            id: collection_dto(collection.id),
            name: collection.name,
            icon: collection.icon.key().to_owned(),
            color: collection.color.key().to_owned(),
            member_count: 0,
        })
    }

    pub fn update_collection(
        &self,
        id: CollectionIdDto,
        name: String,
        icon: String,
        color: String,
    ) -> Result<(), FolioFfiError> {
        let icon = CollectionIcon::from_key(&icon)
            .ok_or_else(|| FolioFfiError::operation("invalid collection icon"))?;
        let color = CollectionColor::from_key(&color)
            .ok_or_else(|| FolioFfiError::operation("invalid collection color"))?;
        let state = self.lock()?;
        state
            .database
            .update_collection(
                CollectionId::from_bytes(parse_id(&id.value)?),
                &name,
                icon,
                color,
            )
            .map_err(FolioFfiError::operation)
    }

    pub fn rename_collection(
        &self,
        id: CollectionIdDto,
        name: String,
    ) -> Result<(), FolioFfiError> {
        let state = self.lock()?;
        state
            .database
            .rename_collection(CollectionId::from_bytes(parse_id(&id.value)?), &name)
            .map_err(FolioFfiError::operation)
    }

    pub fn delete_collection(&self, id: CollectionIdDto) -> Result<(), FolioFfiError> {
        let state = self.lock()?;
        state
            .database
            .delete_collection(CollectionId::from_bytes(parse_id(&id.value)?))
            .map_err(FolioFfiError::operation)
    }

    pub fn set_collection_members(
        &self,
        collection_id: CollectionIdDto,
        identity_ids: Vec<IdentityIdDto>,
        member: bool,
    ) -> Result<(), FolioFfiError> {
        let mut state = self.lock()?;
        let collection_id = CollectionId::from_bytes(parse_id(&collection_id.value)?);
        let identities = parse_identity_ids(&identity_ids)?;
        if member {
            state
                .database
                .add_collection_members(collection_id, &identities)
                .map_err(FolioFfiError::operation)?;
        } else {
            state
                .database
                .remove_collection_members(collection_id, &identities)
                .map_err(FolioFfiError::operation)?;
        }
        update_index_state(&mut state)
    }
}

impl FolioEngine {
    fn lock(&self) -> Result<MutexGuard<'_, EngineState>, FolioFfiError> {
        self.state.lock().map_err(|_| FolioFfiError::Operation {
            message: "Folio 数据引擎状态不可用".to_owned(),
        })
    }
}

fn rebuild_index(state: &mut EngineState) -> Result<(), FolioFfiError> {
    let snapshot = state
        .database
        .library_state_snapshot()
        .map_err(FolioFfiError::operation)?;
    state.index =
        FontQueryIndex::build(&state.catalog, &snapshot).map_err(FolioFfiError::operation)?;
    Ok(())
}

fn update_index_state(state: &mut EngineState) -> Result<(), FolioFfiError> {
    let snapshot = state
        .database
        .library_state_snapshot()
        .map_err(FolioFfiError::operation)?;
    state.index.update_state(&snapshot);
    Ok(())
}

fn snapshot(state: &mut EngineState) -> Result<LibrarySnapshotDto, FolioFfiError> {
    let durable = state
        .database
        .library_state_snapshot()
        .map_err(FolioFfiError::operation)?;
    let collections = state
        .database
        .list_collections()
        .map_err(FolioFfiError::operation)?
        .into_iter()
        .map(|collection| {
            let member_count = durable
                .collections
                .iter()
                .find(|members| members.collection_id == collection.id)
                .map_or(0, |members| members.identities.len() as u64);
            CollectionDto {
                id: collection_dto(collection.id),
                name: collection.name,
                icon: collection.icon.key().to_owned(),
                color: collection.color.key().to_owned(),
                member_count,
            }
        })
        .collect();
    let roots = state
        .database
        .list_roots()
        .map_err(FolioFfiError::operation)?
        .iter()
        .map(root_dto)
        .collect();
    let health = state.index.health();
    Ok(LibrarySnapshotDto {
        family_count: state.catalog.family_count() as u64,
        face_count: state.catalog.face_count() as u64,
        variable_family_count: state
            .catalog
            .families
            .iter()
            .filter(|family| family.faces.iter().any(|face| face.metadata.is_variable))
            .count() as u64,
        recent_count: durable.recent.len() as u64,
        collections,
        roots,
        health: HealthSummaryDto {
            damaged_files: state.damaged_files,
            duplicate_sources: health
                .identities
                .iter()
                .filter(|identity| !identity.duplicate_source_faces.is_empty())
                .count() as u64,
            multiple_revisions: health
                .identities
                .iter()
                .filter(|identity| identity.revision_ids.len() > 1)
                .count() as u64,
            metadata_conflicts: health
                .identities
                .iter()
                .filter(|identity| !identity.conflicts.is_empty())
                .count() as u64,
        },
    })
}

fn query_from_dto(dto: LibraryQueryDto) -> Result<FontQuery, FolioFfiError> {
    let scope = match dto.scope {
        QueryScopeDto::All => QueryScope::All,
        QueryScopeDto::Favorites => QueryScope::Favorites,
        QueryScopeDto::Recent => QueryScope::Recent,
        QueryScopeDto::Collection => QueryScope::Collection(CollectionId::from_bytes(parse_id(
            &dto.collection_id
                .ok_or_else(|| FolioFfiError::Operation {
                    message: "集合查询缺少集合标识".to_owned(),
                })?
                .value,
        )?)),
    };
    let mut facets = FacetFilter::default();
    for selection in dto.facets {
        match selection.kind {
            FacetKindDto::Category => facets.categories.push(parse_category(&selection.value)?),
            FacetKindDto::Script => facets.scripts.push(selection.value),
            FacetKindDto::Foundry => facets.foundries.push(FoundryKey::new(&selection.value)),
            FacetKindDto::License => facets.licenses.push(parse_license(&selection.value)?),
        }
    }
    Ok(FontQuery {
        text: dto.text.filter(|value| !value.trim().is_empty()),
        scope,
        facets,
        sort: QuerySort::Auto,
        offset: usize::try_from(dto.offset).unwrap_or(usize::MAX),
        limit: Some(usize::try_from(dto.limit.max(1)).unwrap_or(usize::MAX)),
    })
}

fn family_card(
    family: &folio_core::FontFamily,
    matched_faces: &[FontFaceId],
    favorites: &BTreeSet<FontIdentityId>,
    database: &FolioDatabase,
    source_paths: Option<&BTreeSet<String>>,
) -> Result<FamilyCardDto, FolioFfiError> {
    let identities = family_identities(family);
    let shown_faces: Vec<_> = family
        .faces
        .iter()
        .filter(|face| source_paths.is_none() || matched_faces.contains(&face.id))
        .collect();
    Ok(FamilyCardDto {
        id: family_dto(family.id),
        display_name: family
            .display_name
            .clone()
            .unwrap_or_else(|| "未命名字体".to_owned()),
        faces: shown_faces
            .iter()
            .map(|face| face_summary(face, database, source_paths))
            .collect::<Result<Vec<_>, _>>()?,
        identity_ids: identities.iter().copied().map(identity_dto).collect(),
        matched_face_ids: matched_faces.iter().copied().map(face_dto).collect(),
        is_favorite: !identities.is_empty() && identities.iter().all(|id| favorites.contains(id)),
        is_variable: shown_faces.iter().any(|face| face.metadata.is_variable),
        manufacturer: shown_faces
            .iter()
            .find_map(|face| face.metadata.enrichment.foundry.manufacturer.clone()),
    })
}

fn family_identities(family: &folio_core::FontFamily) -> Vec<FontIdentityId> {
    family
        .faces
        .iter()
        .map(|face| face.identity_id)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn face_summary(
    face: &FontFace,
    database: &FolioDatabase,
    source_paths: Option<&BTreeSet<String>>,
) -> Result<FaceSummaryDto, FolioFfiError> {
    let selected_sources: Vec<_> = face
        .sources
        .iter()
        .filter(|source| {
            source_paths
                .is_none_or(|paths| paths.contains(source.path().to_string_lossy().as_ref()))
        })
        .collect();
    let source = selected_sources.first().copied();
    let version = face
        .metadata
        .font_version
        .version_string
        .clone()
        .or_else(|| {
            face.metadata
                .font_version
                .head_revision
                .map(|value| format!("{value:.3}"))
        });
    let sources = selected_sources
        .iter()
        .map(|source| {
            let root_ids = database
                .source_root_ids(source.path())
                .map_err(FolioFfiError::operation)?;
            Ok(FontSourceDto {
                path: source.path().to_string_lossy().into_owned(),
                face_index: source.face_index(),
                root_ids: root_ids
                    .into_iter()
                    .map(|id| RootIdDto {
                        value: id.to_string(),
                    })
                    .collect(),
            })
        })
        .collect::<Result<Vec<_>, FolioFfiError>>()?;
    Ok(FaceSummaryDto {
        id: face_dto(face.id),
        identity_id: identity_dto(face.identity_id),
        revision_id: face.revision_id.to_string(),
        style_name: face.display_subfamily(),
        postscript_name: face.metadata.postscript_name.clone(),
        full_name: face.metadata.full_name.clone(),
        format: face.format.label().to_owned(),
        is_variable: face.metadata.is_variable,
        weight: face.metadata.weight.map(|weight| weight.value() as f64),
        width: face.metadata.width.map(|width| width.ratio() as f64),
        source_path: source.map(|source| source.path().to_string_lossy().into_owned()),
        sources,
        face_index: source.map_or(0, |source| source.face_index()),
        file_size: source
            .map(|source| std::fs::metadata(source.path()).map_or(0, |metadata| metadata.len()))
            .unwrap_or(0),
        version,
        manufacturer: face.metadata.enrichment.foundry.manufacturer.clone(),
        designer: face.metadata.enrichment.foundry.designer.clone(),
        copyright: face.metadata.enrichment.copyright.clone(),
        category: category_key(face.metadata.enrichment.category).to_owned(),
        license: license_key(face.metadata.enrichment.license.detected_kind).to_owned(),
        scripts: face
            .metadata
            .enrichment
            .scripts
            .iter()
            .map(|coverage| coverage.script.clone())
            .collect(),
        axes: face
            .metadata
            .variable_axes
            .iter()
            .map(|axis| VariableAxisDto {
                tag: axis.tag.clone(),
                name: axis.name.clone().unwrap_or_else(|| axis.tag.clone()),
                min_value: axis.min_value as f64,
                default_value: axis.default_value as f64,
                max_value: axis.max_value as f64,
                hidden: axis.hidden,
            })
            .collect(),
    })
}

fn facet_count(count: folio_query::FacetCount) -> Option<FacetCountDto> {
    let (kind, value, fallback_label) = match count.value {
        FacetValue::Category(category) => (
            FacetKindDto::Category,
            category_key(category).to_owned(),
            category_label(category).to_owned(),
        ),
        FacetValue::Script(script) => {
            let label = if script == "Han" {
                "汉字".to_owned()
            } else {
                script.clone()
            };
            (FacetKindDto::Script, script, label)
        }
        FacetValue::License(license) => (
            FacetKindDto::License,
            license_key(license).to_owned(),
            license_label(license).to_owned(),
        ),
        FacetValue::Foundry(foundry) => (
            FacetKindDto::Foundry,
            foundry.0.clone(),
            count.display_label.unwrap_or(foundry.0),
        ),
        _ => return None,
    };
    Some(FacetCountDto {
        kind,
        value,
        label: fallback_label,
        family_count: count.family_count as u64,
    })
}

fn parse_category(value: &str) -> Result<FontCategory, FolioFfiError> {
    match value {
        "sans_serif" => Ok(FontCategory::SansSerif),
        "serif" => Ok(FontCategory::Serif),
        "monospace" => Ok(FontCategory::Monospace),
        "script" => Ok(FontCategory::Script),
        "decorative" => Ok(FontCategory::Decorative),
        "symbol" => Ok(FontCategory::Symbol),
        "unknown" => Ok(FontCategory::Unknown),
        _ => Err(FolioFfiError::Operation {
            message: format!("unknown category facet: {value}"),
        }),
    }
}

fn parse_license(value: &str) -> Result<LicenseKind, FolioFfiError> {
    match value {
        "ofl" => Ok(LicenseKind::SilOpenFontLicense),
        "apache_2" => Ok(LicenseKind::Apache2),
        "mit" => Ok(LicenseKind::Mit),
        "custom" => Ok(LicenseKind::Custom),
        "unknown" => Ok(LicenseKind::Unknown),
        _ => Err(FolioFfiError::Operation {
            message: format!("unknown license facet: {value}"),
        }),
    }
}

fn category_key(value: FontCategory) -> &'static str {
    match value {
        FontCategory::SansSerif => "sans_serif",
        FontCategory::Serif => "serif",
        FontCategory::Monospace => "monospace",
        FontCategory::Script => "script",
        FontCategory::Decorative => "decorative",
        FontCategory::Symbol => "symbol",
        FontCategory::Unknown => "unknown",
    }
}

fn category_label(value: FontCategory) -> &'static str {
    match value {
        FontCategory::SansSerif => "无衬线",
        FontCategory::Serif => "衬线",
        FontCategory::Monospace => "等宽",
        FontCategory::Script => "手写",
        FontCategory::Decorative => "装饰",
        FontCategory::Symbol => "符号",
        FontCategory::Unknown => "未分类",
    }
}

fn license_key(value: LicenseKind) -> &'static str {
    match value {
        LicenseKind::SilOpenFontLicense => "ofl",
        LicenseKind::Apache2 => "apache_2",
        LicenseKind::Mit => "mit",
        LicenseKind::Custom => "custom",
        LicenseKind::Unknown => "unknown",
    }
}

fn license_label(value: LicenseKind) -> &'static str {
    match value {
        LicenseKind::SilOpenFontLicense => "OFL",
        LicenseKind::Apache2 => "Apache 2.0",
        LicenseKind::Mit => "MIT",
        LicenseKind::Custom => "自定义",
        LicenseKind::Unknown => "未知",
    }
}

fn parse_identity_ids(values: &[IdentityIdDto]) -> Result<Vec<FontIdentityId>, FolioFfiError> {
    values
        .iter()
        .map(|value| parse_id(&value.value).map(FontIdentityId::from_bytes))
        .collect()
}

fn parse_id(value: &str) -> Result<[u8; 16], FolioFfiError> {
    if value.len() != 32 {
        return Err(FolioFfiError::Operation {
            message: format!("invalid identifier length: {value}"),
        });
    }
    let mut bytes = [0; 16];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        let pair = std::str::from_utf8(pair).map_err(FolioFfiError::operation)?;
        bytes[index] = u8::from_str_radix(pair, 16).map_err(FolioFfiError::operation)?;
    }
    Ok(bytes)
}

fn family_dto(id: FontFamilyId) -> FamilyIdDto {
    FamilyIdDto {
        value: id.to_string(),
    }
}

fn face_dto(id: FontFaceId) -> FaceIdDto {
    FaceIdDto {
        value: id.to_string(),
    }
}

fn identity_dto(id: FontIdentityId) -> IdentityIdDto {
    IdentityIdDto {
        value: id.to_string(),
    }
}

fn collection_dto(id: CollectionId) -> CollectionIdDto {
    CollectionIdDto {
        value: id.to_string(),
    }
}

fn root_dto(root: &folio_storage::LibraryRoot) -> RootDto {
    RootDto {
        id: RootIdDto {
            value: root.id.to_string(),
        },
        display_path: root.display_path.clone(),
        recursive: root.recursive,
        kind: root.kind.as_str().to_owned(),
        path_is_lossless: root.path_is_lossless,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_identifier_round_trip() {
        let bytes = [0xabu8; 16];
        let dto = identity_dto(FontIdentityId::from_bytes(bytes));
        assert_eq!(parse_id(&dto.value).unwrap(), bytes);
    }

    #[test]
    fn empty_database_opens_and_queries() {
        let directory = tempfile::tempdir().unwrap();
        let engine = FolioEngine::open(
            directory
                .path()
                .join("folio.sqlite")
                .to_string_lossy()
                .into_owned(),
        )
        .unwrap();
        let snapshot = engine.load_cached_library().unwrap();
        assert_eq!(snapshot.family_count, 0);
        let page = engine
            .query_library(LibraryQueryDto {
                text: None,
                scope: QueryScopeDto::All,
                collection_id: None,
                facets: Vec::new(),
                allowed_face_ids: None,
                allowed_source_paths: None,
                offset: 0,
                limit: 120,
            })
            .unwrap();
        assert_eq!(page.total_matches, 0);
    }

    #[test]
    fn cloud_only_font_is_visible_in_shared_query() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("folio.sqlite");
        let engine = FolioEngine::open(path.to_string_lossy().into_owned()).unwrap();
        let identity = FontIdentityId::from_bytes([1; 16]);
        let fingerprint = "ab".repeat(32);
        let mut db = FolioDatabase::open(&path).unwrap();
        let remote_payload = serde_json::json!({
            "fingerprint": fingerprint,
            "filename": "font.otf",
            "extension": "otf",
            "file_size": 4,
            "faces": [{
                "identity_id": identity.to_string(),
                "revision_id": "22".repeat(16),
                "display_name": "云端字体",
                "style_name": "Regular"
            }]
        });
        db.upsert_sync_asset(&folio_storage::StoredSyncAsset {
            fingerprint: fingerprint.clone(),
            filename: "font.otf".to_owned(),
            extension: "otf".to_owned(),
            local_path: None,
            remote_payload: remote_payload.to_string(),
            cloud_only: true,
            deleted: false,
        })
        .unwrap();
        let event = db
            .append_sync_event(
                &serde_json::json!({"type": "font_added", "data": remote_payload}).to_string(),
            )
            .unwrap();
        db.mark_sync_event_published(&event.id).unwrap();
        db.set_favorite(identity, true).unwrap();
        let query = |scope| LibraryQueryDto {
            text: Some("云端".to_owned()),
            scope,
            collection_id: None,
            facets: vec![],
            allowed_face_ids: None,
            allowed_source_paths: None,
            offset: 0,
            limit: 120,
        };
        let all = engine.query_library(query(QueryScopeDto::All)).unwrap();
        assert_eq!(all.cloud_only_fonts.len(), 1);
        assert!(all.cloud_only_fonts[0].cloud_only);
        let favorite = engine
            .query_library(query(QueryScopeDto::Favorites))
            .unwrap();
        assert_eq!(favorite.cloud_only_fonts.len(), 1);
    }

    #[test]
    fn selected_file_source_exposes_only_its_file_and_root() {
        let directory = tempfile::tempdir().unwrap();
        let fonts = directory.path().join("fonts");
        std::fs::create_dir(&fonts).unwrap();
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/fonts");
        let selected = fonts.join("selected.ttf");
        std::fs::copy(fixtures.join("Lato-Regular.ttf"), &selected).unwrap();
        std::fs::copy(fixtures.join("Lato-Bold.ttf"), fonts.join("unselected.ttf")).unwrap();
        let engine = FolioEngine::open(
            directory
                .path()
                .join("folio.sqlite")
                .to_string_lossy()
                .into_owned(),
        )
        .unwrap();
        engine
            .validate_font_file(selected.to_string_lossy().into_owned())
            .unwrap();
        let root = engine
            .add_font_file(selected.to_string_lossy().into_owned())
            .unwrap();
        assert_eq!(root.kind, "file");
        assert_eq!(engine.refresh_library().unwrap().files_added, 1);
        let page = engine
            .query_library(LibraryQueryDto {
                text: None,
                scope: QueryScopeDto::All,
                collection_id: None,
                facets: Vec::new(),
                allowed_face_ids: None,
                allowed_source_paths: None,
                offset: 0,
                limit: 120,
            })
            .unwrap();
        assert_eq!(page.total_matches, 1);
        let source = &page.families[0].faces[0].sources[0];
        assert!(source.path.ends_with("selected.ttf"));
        assert_eq!(source.root_ids[0].value, root.id.value);
        let directory_root = engine
            .add_library_root(fonts.to_string_lossy().into_owned())
            .unwrap();
        engine.refresh_library().unwrap();
        let page = engine
            .query_library(LibraryQueryDto {
                text: None,
                scope: QueryScopeDto::All,
                collection_id: None,
                facets: Vec::new(),
                allowed_face_ids: None,
                allowed_source_paths: None,
                offset: 0,
                limit: 120,
            })
            .unwrap();
        let source = page.families[0]
            .faces
            .iter()
            .flat_map(|face| &face.sources)
            .find(|source| source.path.ends_with("selected.ttf"))
            .unwrap();
        assert_eq!(source.root_ids.len(), 2);
        assert!(source.root_ids.iter().any(|id| id.value == root.id.value));
        assert!(source
            .root_ids
            .iter()
            .any(|id| id.value == directory_root.id.value));
        engine.remove_library_root(root.id).unwrap();
        engine.remove_library_root(directory_root.id).unwrap();
        assert_eq!(engine.refresh_library().unwrap().snapshot.family_count, 0);
    }

    #[test]
    fn library_workflow_persists_scopes_and_collections() {
        let directory = tempfile::tempdir().unwrap();
        let fonts = directory.path().join("fonts");
        std::fs::create_dir(&fonts).unwrap();
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/fonts");
        for name in [
            "Lato-Regular.ttf",
            "Lato-Bold.ttf",
            "SourceSerif4-Regular.otf",
        ] {
            std::fs::copy(fixtures.join(name), fonts.join(name)).unwrap();
        }

        let engine = FolioEngine::open(
            directory
                .path()
                .join("folio.sqlite")
                .to_string_lossy()
                .into_owned(),
        )
        .unwrap();
        let root = engine
            .add_library_root(fonts.to_string_lossy().into_owned())
            .unwrap();
        assert!(!root.id.value.is_empty());

        let refresh = engine.refresh_library().unwrap();
        assert_eq!(refresh.files_added, 3);
        assert_eq!(refresh.snapshot.family_count, 2);

        let first_page = engine
            .query_library(LibraryQueryDto {
                text: None,
                scope: QueryScopeDto::All,
                collection_id: None,
                facets: Vec::new(),
                allowed_face_ids: None,
                allowed_source_paths: None,
                offset: 0,
                limit: 1,
            })
            .unwrap();
        assert_eq!(first_page.total_matches, 2);
        assert_eq!(first_page.families.len(), 1);
        let family = first_page.families.first().unwrap();
        let details = engine.family_details(family.id.clone()).unwrap();
        assert_eq!(details.id.value, family.id.value);
        assert!(!details.faces.is_empty());

        engine
            .set_favorite(family.identity_ids.clone(), true)
            .unwrap();
        let favorites = engine
            .query_library(LibraryQueryDto {
                text: None,
                scope: QueryScopeDto::Favorites,
                collection_id: None,
                facets: Vec::new(),
                allowed_face_ids: None,
                allowed_source_paths: None,
                offset: 0,
                limit: 120,
            })
            .unwrap();
        assert_eq!(favorites.total_matches, 1);

        engine
            .record_recent(family.faces[0].identity_id.clone())
            .unwrap();
        assert_eq!(engine.load_cached_library().unwrap().recent_count, 1);

        let collection = engine.create_collection("审稿".to_owned()).unwrap();
        engine
            .set_collection_members(collection.id.clone(), family.identity_ids.clone(), true)
            .unwrap();
        let collection_page = engine
            .query_library(LibraryQueryDto {
                text: None,
                scope: QueryScopeDto::Collection,
                collection_id: Some(collection.id.clone()),
                facets: Vec::new(),
                allowed_face_ids: None,
                allowed_source_paths: None,
                offset: 0,
                limit: 120,
            })
            .unwrap();
        assert_eq!(collection_page.total_matches, 1);
        engine
            .rename_collection(collection.id.clone(), "已审稿".to_owned())
            .unwrap();
        assert_eq!(
            engine.load_cached_library().unwrap().collections[0].name,
            "已审稿"
        );
        engine.delete_collection(collection.id).unwrap();
        assert!(engine.load_cached_library().unwrap().collections.is_empty());
    }

    #[test]
    fn invalid_identifier_is_mapped_to_a_typed_error() {
        let directory = tempfile::tempdir().unwrap();
        let engine = FolioEngine::open(
            directory
                .path()
                .join("folio.sqlite")
                .to_string_lossy()
                .into_owned(),
        )
        .unwrap();
        let error = engine
            .family_details(FamilyIdDto {
                value: "not-an-id".to_owned(),
            })
            .unwrap_err();
        assert!(matches!(error, FolioFfiError::Operation { .. }));
        assert!(error.to_string().contains("invalid identifier length"));
    }
}
