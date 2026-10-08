use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use folio_core::{
    Catalog, CollectionColor, CollectionIcon, CollectionId, FontCategory, FontFace, FontFaceId,
    FontFamilyId, FontIdentityId, FontWeight, FontWidth, LibraryRootKey, LicenseKind, SmartFolder,
    SmartFolderId,
};
use folio_query::{
    FacetFilter, FacetValue, FontFeature, FontQuery, FontQueryIndex, FontState, FoundryKey,
    QueryScope, QuerySort, SavedFontQuery,
};
use folio_storage::{FolioDatabase, LibraryStateSnapshot, RefreshMode};
use font_kit::{
    canvas::{Canvas, Format, RasterizationOptions},
    font::Font,
    hinting::HintingOptions,
};
use pathfinder_geometry::{
    transform2d::Transform2F,
    vector::{Vector2F, Vector2I},
};
use serde::{Deserialize, Serialize};
use skrifa::MetadataProvider;
use write_fonts::{read::FontRef, FontBuilder};

#[derive(Debug, thiserror::Error)]
pub enum LibraryError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Storage(#[from] folio_storage::StorageError),
    #[error(transparent)]
    Query(#[from] folio_query::QueryError),
    #[error("字体预览失败")]
    Preview,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRequest {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub offset: usize,
    #[serde(default = "default_page_size")]
    pub limit: usize,
    #[serde(default)]
    pub facets: QueryFacets,
    #[serde(default)]
    pub sort: String,
    #[serde(default)]
    pub collection_id: Option<String>,
    #[serde(default)]
    pub smart_folder_id: Option<String>,
    #[serde(default)]
    pub font_state: Option<String>,
    #[serde(default)]
    pub location_filter: String,
    #[serde(default)]
    pub file_fingerprint: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartFolderMutation {
    pub id: Option<String>,
    pub name: String,
    pub text: String,
    #[serde(default)]
    pub facets: QueryFacets,
    #[serde(default = "default_collection_icon")]
    pub icon: String,
    #[serde(default = "default_collection_color")]
    pub color: String,
}

fn default_collection_icon() -> String {
    "folder".to_owned()
}
fn default_collection_color() -> String {
    "gray".to_owned()
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionMutation {
    pub id: Option<String>,
    pub name: String,
    #[serde(default = "default_collection_icon")]
    pub icon: String,
    #[serde(default = "default_collection_color")]
    pub color: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionMembershipMutation {
    pub collection_id: String,
    pub identity_ids: Vec<String>,
    pub member: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryFacets {
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub scripts: Vec<String>,
    #[serde(default)]
    pub licenses: Vec<String>,
    #[serde(default)]
    pub foundries: Vec<String>,
    #[serde(default)]
    pub features: Vec<String>,
    #[serde(default)]
    pub states: Vec<String>,
    #[serde(default)]
    pub weights: Vec<String>,
    #[serde(default)]
    pub widths: Vec<String>,
    #[serde(default)]
    pub roots: Vec<String>,
    #[serde(default)]
    pub multiple_variants: Vec<String>,
}

fn default_page_size() -> usize {
    120
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDto {
    pub path: String,
    pub face_index: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceDto {
    pub id: String,
    pub identity_id: String,
    pub style_name: String,
    pub postscript_name: Option<String>,
    pub format: String,
    pub is_variable: bool,
    pub weight: Option<f32>,
    pub width: Option<f32>,
    pub variable_axes: Vec<VariableAxisDto>,
    pub named_instances: Vec<NamedInstanceDto>,
    pub sources: Vec<SourceDto>,
    pub location: Option<folio_query::FontLocation>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariableAxisDto {
    pub tag: String,
    pub min_value: f32,
    pub default_value: f32,
    pub max_value: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedInstanceDto {
    pub name: String,
    pub coordinates: BTreeMap<String, f32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FamilyDto {
    pub id: String,
    pub display_name: String,
    pub faces: Vec<FaceDto>,
    pub matched_face_ids: Vec<String>,
    pub is_favorite: bool,
    pub is_collection_member: bool,
    pub collection_ids: Vec<String>,
    pub is_variable: bool,
    pub location: folio_query::FontFamilyLocation,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPageDto {
    pub total_matches: usize,
    pub families: Vec<FamilyDto>,
    pub is_loading: bool,
    pub facets: Vec<FacetOptionDto>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FacetOptionDto {
    pub kind: String,
    pub value: String,
    pub label: String,
    pub family_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshotDto {
    pub family_count: usize,
    pub face_count: usize,
    pub variable_family_count: usize,
    pub recent_count: usize,
    pub sync_summary: Option<folio_sync::FontSyncSummary>,
    pub roots: Vec<String>,
    pub font_state_counts: HashMap<String, usize>,
    pub user_font_groups: Vec<UserFontGroupDto>,
    pub health: HealthDto,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserFontGroupDto {
    pub id: String,
    pub name: String,
    pub family_count: usize,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthDto {
    pub damaged_files: usize,
    pub duplicate_sources: usize,
    pub multiple_revisions: usize,
    pub metadata_conflicts: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontPreviewDto {
    pub face_id: String,
    pub data_url: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug)]
pub struct PreviewFont {
    pub bytes: Vec<u8>,
    pub coverage: Vec<[u32; 2]>,
    pub sample: String,
}

impl PreviewFont {
    pub fn into_packet(self) -> Result<Vec<u8>, LibraryError> {
        #[derive(Serialize)]
        struct Metadata<'a> {
            coverage: &'a [[u32; 2]],
            sample: &'a str,
        }
        let metadata = serde_json::to_vec(&Metadata {
            coverage: &self.coverage,
            sample: &self.sample,
        })
        .map_err(|_| LibraryError::Preview)?;
        let length = u32::try_from(metadata.len()).map_err(|_| LibraryError::Preview)?;
        let mut packet = Vec::with_capacity(4 + metadata.len() + self.bytes.len());
        packet.extend_from_slice(&length.to_le_bytes());
        packet.extend_from_slice(&metadata);
        packet.extend_from_slice(&self.bytes);
        Ok(packet)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionDto {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub member_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartFolderDto {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub query_json: String,
    pub query_text: Option<String>,
    pub facets: QueryFacets,
    pub match_count: usize,
}

pub struct LibraryService {
    database: FolioDatabase,
    catalog: Catalog,
    state: LibraryStateSnapshot,
    query_index: FontQueryIndex,
    locations: BTreeMap<FontFaceId, folio_query::FontLocation>,
    preview_sources: HashMap<String, Vec<SourceDto>>,
    managed_directory: PathBuf,
}

impl LibraryService {
    pub fn open(path: PathBuf) -> Result<Self, LibraryError> {
        let managed_directory = path
            .parent()
            .map(|parent| parent.join("ManagedFonts"))
            .unwrap_or_else(|| PathBuf::from("ManagedFonts"));
        let mut database = FolioDatabase::open(path)?;
        database.set_sync_metadata("managed_directory", &managed_directory.to_string_lossy())?;
        let local = database.load_cached_catalog()?;
        let unified = folio_sync::unified_library(&database, &local)
            .map_err(|error| LibraryError::Message(error.to_string()))?;
        let locations = unified.locations.clone();
        let catalog = unified.catalog;
        let state = database.library_state_snapshot()?;
        let mut query_index = FontQueryIndex::build(&catalog, &state)?;
        query_index.set_locations(locations.clone());
        let preview_sources = preview_source_index(&catalog);
        Ok(Self {
            database,
            catalog,
            state,
            query_index,
            locations,
            preview_sources,
            managed_directory,
        })
    }

    pub fn known_source(&self, path: &Path) -> bool {
        self.catalog
            .faces()
            .any(|face| face.sources.iter().any(|source| source.path() == path))
    }

    pub fn add_default_roots(&mut self) -> Result<(), LibraryError> {
        for path in default_font_roots() {
            if path.is_dir() {
                self.database.add_root(path, true)?;
            }
        }
        self.add_managed_root()
    }

    pub fn add_root(&mut self, path: PathBuf) -> Result<LibrarySnapshotDto, LibraryError> {
        if !path.is_dir() {
            return Err(LibraryError::Message(
                "所选路径不是可访问的文件夹".to_owned(),
            ));
        }
        self.database.add_root(path, true)?;
        self.refresh()
    }

    pub fn refresh(&mut self) -> Result<LibrarySnapshotDto, LibraryError> {
        self.add_managed_root()?;
        self.database.refresh(RefreshMode::Incremental)?;
        let local = self.database.load_cached_catalog()?;
        let unified = folio_sync::unified_library(&self.database, &local)
            .map_err(|error| LibraryError::Message(error.to_string()))?;
        self.locations = unified.locations;
        self.catalog = unified.catalog;
        self.preview_sources = preview_source_index(&self.catalog);
        self.state = self.database.library_state_snapshot()?;
        self.query_index = FontQueryIndex::build(&self.catalog, &self.state)?;
        self.query_index.set_locations(self.locations.clone());
        Ok(self.snapshot())
    }

    pub fn clear_catalog_cache(&mut self) -> Result<u64, LibraryError> {
        Ok(self.database.clear_catalog_cache_and_compact()?)
    }

    fn add_managed_root(&self) -> Result<(), LibraryError> {
        if self.managed_directory.is_dir() {
            self.database.add_root(&self.managed_directory, true)?;
        }
        Ok(())
    }

    pub fn query(&self, request: PageRequest) -> Result<LibraryPageDto, LibraryError> {
        let sort = query_sort(&request.sort);
        let limit = Some(request.limit.clamp(1, 240));
        let collection_id = if request.scope == "collection" {
            Some(parse_collection_id(
                request.collection_id.as_deref().unwrap_or_default(),
            )?)
        } else {
            None
        };
        let query = if request.scope == "smartFolder" {
            let folder_id =
                parse_smart_folder_id(request.smart_folder_id.as_deref().unwrap_or_default())?;
            let folder = self
                .database
                .list_smart_folders()?
                .into_iter()
                .find(|folder| folder.id == folder_id)
                .ok_or_else(|| LibraryError::Message("智慧收藏夹不存在".to_owned()))?;
            let saved: SavedFontQuery = serde_json::from_str(&folder.query_json)
                .map_err(|error| LibraryError::Message(format!("智慧收藏夹条件无效：{error}")))?;
            let mut query = saved.clone().into_query(request.offset, limit)?;
            query.text = (!request.text.trim().is_empty()).then_some(request.text);
            query.facets = query_facets(request.facets);
            query.sort = sort;
            query
        } else {
            FontQuery {
                text: (!request.text.trim().is_empty()).then_some(request.text),
                scope: match request.scope.as_str() {
                    "favorites" => QueryScope::Favorites,
                    "recent" => QueryScope::Recent,
                    _ => collection_id
                        .map(QueryScope::Collection)
                        .unwrap_or(QueryScope::All),
                },
                sort,
                facets: query_facets(request.facets),
                offset: request.offset,
                limit,
            }
        };
        let restricted_faces: Option<BTreeSet<_>> = match request.scope.as_str() {
            "fontState" => {
                Some(self.face_ids_for_state(request.font_state.as_deref().unwrap_or("")))
            }
            "fontHealth" => Some(self.face_ids_for_health()),
            _ => None,
        };
        let result = self.query_index.query_with_location(
            &query,
            restricted_faces.as_ref(),
            &request.location_filter,
            request.file_fingerprint.as_deref(),
        )?;
        let mut facet_query = query.clone();
        facet_query.facets = FacetFilter::default();
        let facet_summary = self
            .query_index
            .query_with_location(
                &facet_query,
                restricted_faces.as_ref(),
                &request.location_filter,
                request.file_fingerprint.as_deref(),
            )?
            .facet_summary;
        let favorite_ids: HashSet<FontIdentityId> = self.state.favorites.iter().copied().collect();
        let collection_members: HashSet<FontIdentityId> = collection_id
            .and_then(|id| {
                self.state
                    .collections
                    .iter()
                    .find(|item| item.collection_id == id)
            })
            .map(|item| item.identities.iter().copied().collect())
            .unwrap_or_default();
        let roots = FontSourceRoots::new(&self.managed_directory, &self.catalog);
        let families = result
            .families
            .into_iter()
            .filter_map(|matched| {
                let family = self.catalog.find_family(matched.family_id)?;
                let faces: Vec<FaceDto> = family
                    .faces
                    .iter()
                    .map(|face| {
                        let mut dto = face_dto(face);
                        dto.location = self.locations.get(&face.id).cloned().map(|mut location| {
                            for file in &mut location.files {
                                for source in &mut file.local_sources {
                                    source.kind =
                                        match classify_source(Path::new(&source.path), &roots) {
                                            FontStateKind::Available => "managed",
                                            FontStateKind::User => "installed",
                                            FontStateKind::System => "system",
                                            _ => "reference",
                                        }
                                        .to_owned();
                                }
                            }
                            location
                        });
                        dto
                    })
                    .collect();
                Some(FamilyDto {
                    location: folio_query::FontFamilyLocation::from_locations(
                        faces.iter().filter_map(|face| face.location.as_ref()),
                    ),
                    id: matched.family_id.to_string(),
                    display_name: matched
                        .display_name
                        .or_else(|| family.display_name.clone())
                        .unwrap_or_else(|| "未命名字体".to_owned()),
                    is_favorite: family
                        .faces
                        .iter()
                        .any(|face| favorite_ids.contains(&face.identity_id)),
                    is_collection_member: family
                        .faces
                        .iter()
                        .any(|face| collection_members.contains(&face.identity_id)),
                    collection_ids: self
                        .state
                        .collections
                        .iter()
                        .filter(|collection| {
                            family
                                .faces
                                .iter()
                                .any(|face| collection.identities.contains(&face.identity_id))
                        })
                        .map(|collection| collection.collection_id.to_string())
                        .collect(),
                    is_variable: family.faces.iter().any(|face| face.metadata.is_variable),
                    faces,
                    matched_face_ids: matched
                        .matched_face_ids
                        .iter()
                        .map(ToString::to_string)
                        .collect(),
                })
            })
            .collect();
        Ok(LibraryPageDto {
            total_matches: result.total_matches,
            families,
            is_loading: false,
            facets: facet_summary
                .into_iter()
                .map(|facet| {
                    let (kind, value, label) = facet_option(&facet.value, facet.display_label);
                    FacetOptionDto {
                        kind: kind.to_owned(),
                        value,
                        label,
                        family_count: facet.family_count,
                    }
                })
                .collect(),
        })
    }

    pub fn list_collections(&self) -> Result<Vec<CollectionDto>, LibraryError> {
        self.database
            .list_collections()?
            .into_iter()
            .map(|collection| {
                let member_count = self.database.list_collection_members(collection.id)?.len();
                Ok(CollectionDto {
                    id: collection.id.to_string(),
                    name: collection.name,
                    icon: collection.icon.key().to_owned(),
                    color: collection.color.key().to_owned(),
                    member_count,
                })
            })
            .collect()
    }

    pub fn list_smart_folders(&self) -> Result<Vec<SmartFolderDto>, LibraryError> {
        self.database
            .list_smart_folders()?
            .into_iter()
            .map(|folder| {
                let saved: SavedFontQuery =
                    serde_json::from_str(&folder.query_json).map_err(|error| {
                        LibraryError::Message(format!("智慧收藏夹条件无效：{error}"))
                    })?;
                let query = saved.clone().into_query(0, None)?;
                let match_count = self.query_index.query(&query)?.total_matches;
                Ok(smart_folder_dto(folder, match_count, saved))
            })
            .collect()
    }

    pub fn save_collection(
        &mut self,
        request: CollectionMutation,
    ) -> Result<CollectionDto, LibraryError> {
        let icon = CollectionIcon::from_key(&request.icon)
            .ok_or_else(|| LibraryError::Message("收藏夹图标无效".to_owned()))?;
        let color = CollectionColor::from_key(&request.color)
            .ok_or_else(|| LibraryError::Message("收藏夹颜色无效".to_owned()))?;
        let collection = match request.id {
            Some(value) => {
                let id = parse_collection_id(&value)?;
                self.database
                    .update_collection(id, &request.name, icon, color)?;
                self.database
                    .list_collections()?
                    .into_iter()
                    .find(|item| item.id == id)
                    .ok_or_else(|| LibraryError::Message("收藏夹不存在".to_owned()))?
            }
            None => self
                .database
                .create_collection_with_style(&request.name, icon, color)?,
        };
        self.refresh_query_state()?;
        let member_count = self.database.list_collection_members(collection.id)?.len();
        Ok(CollectionDto {
            id: collection.id.to_string(),
            name: collection.name,
            icon: collection.icon.key().to_owned(),
            color: collection.color.key().to_owned(),
            member_count,
        })
    }

    pub fn delete_collection(&mut self, id: &str) -> Result<(), LibraryError> {
        self.database.delete_collection(parse_collection_id(id)?)?;
        self.refresh_query_state()
    }

    pub fn set_collection_members(
        &mut self,
        request: CollectionMembershipMutation,
    ) -> Result<(), LibraryError> {
        let id = parse_collection_id(&request.collection_id)?;
        let identities = request
            .identity_ids
            .iter()
            .map(|value| parse_identity_id(value))
            .collect::<Result<Vec<_>, _>>()?;
        if request.member {
            self.database.add_collection_members(id, &identities)?;
        } else {
            self.database.remove_collection_members(id, &identities)?;
        }
        self.refresh_query_state()
    }

    pub fn save_smart_folder(
        &self,
        request: SmartFolderMutation,
    ) -> Result<SmartFolderDto, LibraryError> {
        let icon = CollectionIcon::from_key(&request.icon)
            .ok_or_else(|| LibraryError::Message("收藏夹图标无效".to_owned()))?;
        let color = CollectionColor::from_key(&request.color)
            .ok_or_else(|| LibraryError::Message("收藏夹颜色无效".to_owned()))?;
        let query = SavedFontQuery::from_filter(
            (!request.text.trim().is_empty()).then_some(request.text),
            query_facets(request.facets),
        )?;
        let query_json = serde_json::to_string(&query)
            .map_err(|error| LibraryError::Message(error.to_string()))?;
        let folder = match request.id {
            Some(value) => {
                let id = parse_smart_folder_id(&value)?;
                self.database.update_smart_folder_with_style(
                    id,
                    &request.name,
                    &query_json,
                    icon,
                    color,
                )?;
                self.database
                    .list_smart_folders()?
                    .into_iter()
                    .find(|item| item.id == id)
                    .ok_or_else(|| LibraryError::Message("智慧收藏夹不存在".to_owned()))?
            }
            None => self.database.create_smart_folder_with_style(
                &request.name,
                &query_json,
                icon,
                color,
            )?,
        };
        let saved: SavedFontQuery = serde_json::from_str(&folder.query_json)
            .map_err(|error| LibraryError::Message(error.to_string()))?;
        let match_count = self
            .query_index
            .query(&saved.clone().into_query(0, None)?)?
            .total_matches;
        Ok(smart_folder_dto(folder, match_count, saved))
    }

    pub fn delete_smart_folder(&self, id: &str) -> Result<(), LibraryError> {
        self.database
            .delete_smart_folder(parse_smart_folder_id(id)?)?;
        Ok(())
    }

    /// 将手动收藏夹转换为智慧收藏夹，保留原收藏夹标识。
    pub fn convert_collection_to_smart_folder(
        &mut self,
        request: SmartFolderMutation,
    ) -> Result<SmartFolderDto, LibraryError> {
        let id = request
            .id
            .as_deref()
            .ok_or_else(|| LibraryError::Message("收藏夹标识无效".to_owned()))?;
        let icon = CollectionIcon::from_key(&request.icon)
            .ok_or_else(|| LibraryError::Message("收藏夹图标无效".to_owned()))?;
        let color = CollectionColor::from_key(&request.color)
            .ok_or_else(|| LibraryError::Message("收藏夹颜色无效".to_owned()))?;
        let query = SavedFontQuery::from_filter(
            (!request.text.trim().is_empty()).then_some(request.text),
            query_facets(request.facets),
        )?;
        let query_json = serde_json::to_string(&query)
            .map_err(|error| LibraryError::Message(error.to_string()))?;
        let folder = self.database.convert_collection_to_smart_folder(
            parse_collection_id(id)?,
            &request.name,
            &query_json,
            icon,
            color,
        )?;
        self.refresh_query_state()?;
        let saved: SavedFontQuery = serde_json::from_str(&folder.query_json)
            .map_err(|error| LibraryError::Message(error.to_string()))?;
        let match_count = self
            .query_index
            .query(&saved.clone().into_query(0, None)?)?
            .total_matches;
        Ok(smart_folder_dto(folder, match_count, saved))
    }

    /// 将智慧收藏夹转换为手动收藏夹，把当前命中的字族写入成员。
    pub fn convert_smart_folder_to_collection(
        &mut self,
        request: CollectionMutation,
    ) -> Result<CollectionDto, LibraryError> {
        let id = request
            .id
            .as_deref()
            .ok_or_else(|| LibraryError::Message("智慧收藏夹标识无效".to_owned()))?;
        let icon = CollectionIcon::from_key(&request.icon)
            .ok_or_else(|| LibraryError::Message("收藏夹图标无效".to_owned()))?;
        let color = CollectionColor::from_key(&request.color)
            .ok_or_else(|| LibraryError::Message("收藏夹颜色无效".to_owned()))?;
        let folder_id = parse_smart_folder_id(id)?;
        let folder = self
            .database
            .list_smart_folders()?
            .into_iter()
            .find(|folder| folder.id == folder_id)
            .ok_or_else(|| LibraryError::Message("智慧收藏夹不存在".to_owned()))?;
        let saved: SavedFontQuery = serde_json::from_str(&folder.query_json)
            .map_err(|error| LibraryError::Message(format!("智慧收藏夹条件无效：{error}")))?;
        let identities = self
            .query_index
            .query(&saved.clone().into_query(0, None)?)?
            .families
            .into_iter()
            .flat_map(|family| family.matched_identity_ids)
            .collect::<HashSet<_>>();
        let member_count = identities.len();
        let identities = identities.into_iter().collect::<Vec<_>>();
        let collection = self.database.convert_smart_folder_to_collection(
            folder_id,
            &request.name,
            icon,
            color,
            &identities,
        )?;
        self.refresh_query_state()?;
        Ok(CollectionDto {
            id: collection.id.to_string(),
            name: collection.name,
            icon: collection.icon.key().to_owned(),
            color: collection.color.key().to_owned(),
            member_count,
        })
    }

    fn refresh_query_state(&mut self) -> Result<(), LibraryError> {
        self.state = self.database.library_state_snapshot()?;
        self.query_index.update_state(&self.state);
        Ok(())
    }

    // 锁内只复制来源描述，文件检查、读取与栅格化在锁外完成。
    pub fn preview_font_sources(&self, face_id: &str) -> Result<Vec<SourceDto>, LibraryError> {
        self.preview_sources
            .get(face_id)
            .cloned()
            .ok_or_else(|| LibraryError::Message("字体已不在当前目录中".to_owned()))
    }

    pub fn set_favorites(
        &mut self,
        identity_ids: &[String],
        favorite: bool,
    ) -> Result<(), LibraryError> {
        let identities = identity_ids
            .iter()
            .map(|value| parse_identity_id(value))
            .collect::<Result<Vec<_>, _>>()?;
        self.database.bulk_set_favorite(&identities, favorite)?;
        self.state = self.database.library_state_snapshot()?;
        self.query_index.update_state(&self.state);
        Ok(())
    }

    pub fn record_recent(&mut self, identity_id: &str) -> Result<usize, LibraryError> {
        self.database
            .record_recent(parse_identity_id(identity_id)?)?;
        // 访问记录只刷新最近列表，避免重新反序列化所有字体的缓存状态。
        self.state.recent = self.database.list_recent(usize::MAX)?;
        self.query_index.update_state(&self.state);
        Ok(self.state.recent.len())
    }

    fn snapshot(&self) -> LibrarySnapshotDto {
        let roots = self
            .database
            .list_roots()
            .unwrap_or_default()
            .into_iter()
            .map(|root| root.display_path)
            .collect();
        let (font_state_counts, user_font_groups) = self.font_state_counts();
        LibrarySnapshotDto {
            family_count: self
                .catalog
                .families
                .iter()
                .filter(|family| {
                    family.faces.iter().any(|face| {
                        self.locations
                            .get(&face.id)
                            .is_none_or(|location| location.metadata_complete)
                    })
                })
                .count(),
            face_count: self.catalog.face_count(),
            variable_family_count: self
                .catalog
                .families
                .iter()
                .filter(|family| family.faces.iter().any(|face| face.metadata.is_variable))
                .count(),
            recent_count: self.state.recent.len(),
            sync_summary: folio_sync::font_sync_summary(&self.database, &self.managed_directory)
                .ok(),
            roots,
            font_state_counts,
            user_font_groups,
            health: self.health_overview().0,
        }
    }

    /// 按字体来源目录统计每个状态下的字族数量。
    fn font_state_counts(&self) -> (HashMap<String, usize>, Vec<UserFontGroupDto>) {
        let roots = FontSourceRoots::new(&self.managed_directory, &self.catalog);
        let mut counts: HashMap<String, usize> = HashMap::new();
        for family in &self.catalog.families {
            let mut kinds = BTreeSet::new();
            let mut user_ids = BTreeSet::new();
            for face in &family.faces {
                kinds.extend(classify_face(face, &roots));
                for source in &face.sources {
                    if !source.path().exists() {
                        continue;
                    }
                    if let Some(group) = roots.user_group_for_path(source.path()) {
                        user_ids.insert(group.id.clone());
                    }
                }
            }
            let mut keys: Vec<String> = kinds.iter().map(|kind| kind.key().to_owned()).collect();
            keys.extend(user_ids);
            if kinds.contains(&FontStateKind::User) || kinds.contains(&FontStateKind::System) {
                keys.push(FontStateKind::Active.key().to_owned());
            }
            keys.sort_unstable();
            keys.dedup();
            for key in keys {
                *counts.entry(key).or_default() += 1;
            }
        }
        for kind in FontStateKind::ALL {
            counts.entry(kind.key().to_owned()).or_default();
        }
        let users = roots
            .user
            .iter()
            .map(|group| UserFontGroupDto {
                id: group.id.clone(),
                name: group.name.clone(),
                family_count: counts.get(&group.id).copied().unwrap_or(0),
            })
            .collect();
        (counts, users)
    }

    /// 健康概览与问题字款集合；数量口径与 macOS 版本一致。
    fn health_overview(&self) -> (HealthDto, BTreeSet<FontFaceId>) {
        let mut family_by_face: HashMap<FontFaceId, FontFamilyId> = HashMap::new();
        for family in &self.catalog.families {
            for face in &family.faces {
                family_by_face.insert(face.id, family.id);
            }
        }
        let mut health = HealthDto::default();
        let mut face_ids = BTreeSet::new();
        let mut revisions = BTreeSet::new();
        let mut conflicts = BTreeSet::new();
        let mut duplicates = BTreeSet::new();
        for identity in &self.query_index.health().identities {
            if !identity.duplicate_source_faces.is_empty() {
                duplicates.extend(family_ids_for_faces(
                    &family_by_face,
                    &identity.duplicate_source_faces,
                ));
            }
            if identity.revision_ids.len() > 1 {
                revisions.extend(family_ids_for_faces(&family_by_face, &identity.face_ids));
            }
            if !identity.conflicts.is_empty() {
                conflicts.extend(family_ids_for_faces(&family_by_face, &identity.face_ids));
            }
            face_ids.extend(identity.face_ids.iter().copied());
            face_ids.extend(identity.duplicate_source_faces.iter().copied());
        }
        health.damaged_files = 0;
        health.duplicate_sources = duplicates.len();
        health.multiple_revisions = revisions.len();
        health.metadata_conflicts = conflicts.len();
        (health, face_ids)
    }

    fn face_ids_for_state(&self, state: &str) -> BTreeSet<FontFaceId> {
        let roots = FontSourceRoots::new(&self.managed_directory, &self.catalog);
        let user_group = roots.user.iter().find(|group| group.id == state);
        let kinds = FontStateKind::matching(state);
        if kinds.is_empty() && user_group.is_none() {
            return BTreeSet::new();
        }
        self.catalog
            .families
            .iter()
            .flat_map(|family| family.faces.iter())
            .filter(|face| {
                if let Some(group) = user_group {
                    face.sources.iter().any(|source| {
                        source.path().exists()
                            && group
                                .roots
                                .iter()
                                .any(|root| source.path().starts_with(root))
                    })
                } else {
                    classify_face(face, &roots)
                        .iter()
                        .any(|kind| kinds.contains(kind))
                }
            })
            .map(|face| face.id)
            .collect()
    }

    fn face_ids_for_health(&self) -> BTreeSet<FontFaceId> {
        self.health_overview().1
    }
}

struct FontSourceRoots {
    managed: PathBuf,
    system: Vec<PathBuf>,
    user: Vec<UserFontGroup>,
}

struct UserFontGroup {
    id: String,
    name: String,
    roots: Vec<PathBuf>,
}

impl FontSourceRoots {
    fn new(managed: &Path, catalog: &Catalog) -> Self {
        // 扫描结果使用规范路径，Windows 下包含 \\?\ 前缀，目录也须按同一形式比较。
        let current_roots = user_font_roots();
        let current_profile = current_roots
            .first()
            .map(|root| normalize_font_root(root))
            .and_then(|root| user_profile_for_font_root(&root))
            .map(|profile| normalize_font_root(&profile));
        let mut candidates = current_roots.into_iter().collect::<BTreeSet<_>>();
        for source in catalog
            .families
            .iter()
            .flat_map(|family| &family.faces)
            .flat_map(|face| &face.sources)
        {
            if let Some(root) = user_font_root_for_path(source.path()) {
                candidates.insert(root);
            }
        }
        let mut by_profile: BTreeMap<PathBuf, UserFontGroup> = BTreeMap::new();
        for candidate in candidates {
            let root = normalize_font_root(&candidate);
            let Some(profile) = user_profile_for_font_root(&root) else {
                continue;
            };
            let profile = normalize_font_root(&profile);
            let name = if current_profile.as_ref() == Some(&profile) {
                current_account_name().unwrap_or_else(|| profile_name(&profile))
            } else {
                profile_name(&profile)
            };
            let group = by_profile
                .entry(profile.clone())
                .or_insert_with(|| UserFontGroup {
                    id: format!("user:{}", profile.to_string_lossy()),
                    name,
                    roots: Vec::new(),
                });
            if !group.roots.contains(&root) {
                group.roots.push(root);
            }
        }
        let mut user = by_profile.into_values().collect::<Vec<_>>();
        user.sort_by(|left, right| left.name.cmp(&right.name).then(left.id.cmp(&right.id)));
        Self {
            managed: normalize_font_root(managed),
            system: system_font_roots()
                .iter()
                .map(|path| normalize_font_root(path))
                .collect(),
            user,
        }
    }

    fn user_group_for_path(&self, path: &Path) -> Option<&UserFontGroup> {
        self.user
            .iter()
            .find(|group| group.roots.iter().any(|root| path.starts_with(root)))
    }
}

fn normalize_font_root(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn current_account_name() -> Option<String> {
    let key = if cfg!(target_os = "windows") {
        "USERNAME"
    } else {
        "USER"
    };
    std::env::var(key)
        .ok()
        .filter(|name| !name.trim().is_empty())
}

fn profile_name(profile: &Path) -> String {
    profile
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "未知用户".to_owned())
}

fn user_font_root_for_path(path: &Path) -> Option<PathBuf> {
    path.ancestors()
        .find(|ancestor| user_profile_for_font_root(ancestor).is_some())
        .map(Path::to_path_buf)
}

fn user_profile_for_font_root(root: &Path) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let mut node = root;
        for expected in ["Fonts", "Windows", "Microsoft", "Local", "AppData"] {
            if !node
                .file_name()?
                .to_string_lossy()
                .eq_ignore_ascii_case(expected)
            {
                return None;
            }
            node = node.parent()?;
        }
        return Some(node.to_path_buf());
    }
    #[cfg(target_os = "linux")]
    {
        let mut node = root;
        let parts = if root.file_name()? == ".fonts" {
            &[".fonts"][..]
        } else {
            &["fonts", "share", ".local"][..]
        };
        for expected in parts {
            if node.file_name()? != *expected {
                return None;
            }
            node = node.parent()?;
        }
        return Some(node.to_path_buf());
    }
    #[allow(unreachable_code)]
    None
}

fn classify_face(face: &FontFace, roots: &FontSourceRoots) -> Vec<FontStateKind> {
    if face.sources.is_empty() {
        return vec![FontStateKind::Unavailable];
    }
    face.sources
        .iter()
        .map(|source| classify_source(source.path(), roots))
        .collect()
}

fn classify_source(path: &Path, roots: &FontSourceRoots) -> FontStateKind {
    if !path.exists() {
        return FontStateKind::Unavailable;
    }
    if path.starts_with(&roots.managed) {
        return FontStateKind::Available;
    }
    if roots.user_group_for_path(path).is_some() {
        return FontStateKind::User;
    }
    if roots.system.iter().any(|root| path.starts_with(root)) {
        return FontStateKind::System;
    }
    FontStateKind::External
}

fn family_ids_for_faces(
    family_by_face: &HashMap<FontFaceId, FontFamilyId>,
    face_ids: &[FontFaceId],
) -> BTreeSet<FontFamilyId> {
    face_ids
        .iter()
        .filter_map(|face_id| family_by_face.get(face_id).copied())
        .collect()
}

/// 字族在跨平台字体来源模型下的状态。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum FontStateKind {
    /// 操作系统当前可用的字体（系统目录或用户字体目录）。
    Active,
    /// 当前用户字体目录中的字体。
    User,
    /// 位于 Folio 管理目录、尚未安装。
    Available,
    /// 引用的外部文件或用户添加的文件夹。
    External,
    /// 系统级字体目录，包含面向所有用户安装的字体。
    System,
    /// 来源文件已不可访问。
    Unavailable,
}

impl FontStateKind {
    const ALL: [Self; 6] = [
        Self::Active,
        Self::User,
        Self::Available,
        Self::External,
        Self::System,
        Self::Unavailable,
    ];

    fn key(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::User => "user",
            Self::Available => "available",
            Self::External => "external",
            Self::System => "system",
            Self::Unavailable => "unavailable",
        }
    }

    fn matching(state: &str) -> Vec<Self> {
        match state {
            "active" => vec![Self::User, Self::System],
            "user" => vec![Self::User],
            "available" => vec![Self::Available],
            "external" => vec![Self::External],
            "system" => vec![Self::System],
            "unavailable" => vec![Self::Unavailable],
            _ => Vec::new(),
        }
    }
}

fn query_facets(facets: QueryFacets) -> FacetFilter {
    let categories = facets
        .categories
        .iter()
        .filter_map(|value| match value.as_str() {
            "SansSerif" => Some(FontCategory::SansSerif),
            "Serif" => Some(FontCategory::Serif),
            "Monospace" => Some(FontCategory::Monospace),
            "Script" => Some(FontCategory::Script),
            "Decorative" => Some(FontCategory::Decorative),
            "Symbol" => Some(FontCategory::Symbol),
            "Unknown" => Some(FontCategory::Unknown),
            _ => None,
        })
        .collect();
    let licenses = facets
        .licenses
        .iter()
        .filter_map(|value| match value.as_str() {
            "SilOpenFontLicense" => Some(LicenseKind::SilOpenFontLicense),
            "Apache2" => Some(LicenseKind::Apache2),
            "Mit" => Some(LicenseKind::Mit),
            "Custom" => Some(LicenseKind::Custom),
            "Unknown" => Some(LicenseKind::Unknown),
            _ => None,
        })
        .collect();
    let features = facets
        .features
        .iter()
        .filter_map(|value| match value.as_str() {
            "Variable" => Some(FontFeature::Variable),
            "Italic" => Some(FontFeature::Italic),
            "Oblique" => Some(FontFeature::Oblique),
            "Monospace" => Some(FontFeature::Monospace),
            "Color" => Some(FontFeature::Color),
            value if value.starts_with("OpenType:") => {
                Some(FontFeature::OpenType(value[9..].to_owned()))
            }
            _ => None,
        })
        .collect();
    let states = facets
        .states
        .iter()
        .filter_map(|value| match value.as_str() {
            "Favorite" => Some(FontState::Favorite),
            "Recent" => Some(FontState::Recent),
            "DuplicateSources" => Some(FontState::DuplicateSources),
            "MultipleRevisions" => Some(FontState::MultipleRevisions),
            "MetadataConflict" => Some(FontState::MetadataConflict),
            _ => None,
        })
        .collect();
    let widths = facets
        .widths
        .into_iter()
        .filter_map(|value| value.parse::<u16>().ok())
        .filter_map(FontWidth::from_width_class)
        .collect();
    let roots = facets
        .roots
        .iter()
        .filter_map(|value| parse_root_key(value))
        .collect();
    FacetFilter {
        categories,
        scripts: facets.scripts,
        licenses,
        foundries: facets
            .foundries
            .into_iter()
            .map(|value| FoundryKey::new(&value))
            .collect(),
        features,
        states,
        weights: facets
            .weights
            .into_iter()
            .filter_map(|value| {
                value
                    .parse::<f32>()
                    .ok()
                    .filter(|weight| weight.is_finite())
                    .map(FontWeight::new)
            })
            .collect(),
        widths,
        roots,
        multiple_variants: facets.multiple_variants.iter().any(|value| value == "true"),
        ..FacetFilter::default()
    }
}

fn parse_root_key(value: &str) -> Option<LibraryRootKey> {
    if value.len() != 32 {
        return None;
    }
    let mut bytes = [0; 16];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).ok()?;
    }
    Some(LibraryRootKey(bytes))
}

fn facet_option(value: &FacetValue, label: Option<String>) -> (&'static str, String, String) {
    match value {
        FacetValue::Category(value) => (
            "categories",
            format!("{value:?}"),
            match value {
                FontCategory::SansSerif => "无衬线".to_owned(),
                FontCategory::Serif => "衬线".to_owned(),
                FontCategory::Monospace => "等宽".to_owned(),
                FontCategory::Script => "手写".to_owned(),
                FontCategory::Decorative => "装饰".to_owned(),
                FontCategory::Symbol => "符号".to_owned(),
                FontCategory::Unknown => "未分类".to_owned(),
            },
        ),
        FacetValue::Script(value) => ("scripts", value.clone(), value.clone()),
        FacetValue::License(value) => (
            "licenses",
            format!("{value:?}"),
            match value {
                LicenseKind::SilOpenFontLicense => "SIL 开源字体许可".to_owned(),
                LicenseKind::Apache2 => "Apache 2.0".to_owned(),
                LicenseKind::Mit => "MIT".to_owned(),
                LicenseKind::Custom => "自定义许可".to_owned(),
                LicenseKind::Unknown => "未知".to_owned(),
            },
        ),
        FacetValue::Foundry(value) => (
            "foundries",
            value.0.clone(),
            label.unwrap_or_else(|| value.0.clone()),
        ),
        FacetValue::Feature(value) => (
            "features",
            match value {
                FontFeature::OpenType(tag) => format!("OpenType:{tag}"),
                _ => format!("{value:?}"),
            },
            match value {
                FontFeature::Variable => "可变字体".to_owned(),
                FontFeature::Italic => "斜体".to_owned(),
                FontFeature::Oblique => "倾斜体".to_owned(),
                FontFeature::Monospace => "等宽".to_owned(),
                FontFeature::Color => "彩色字形".to_owned(),
                FontFeature::OpenType(tag) => format!("OpenType {tag}"),
            },
        ),
        FacetValue::State(value) => (
            "states",
            format!("{value:?}"),
            match value {
                FontState::Favorite => "已收藏".to_owned(),
                FontState::Recent => "最近查看".to_owned(),
                FontState::DuplicateSources => "多个来源".to_owned(),
                FontState::MultipleRevisions => "多个版本".to_owned(),
                FontState::MetadataConflict => "元数据冲突".to_owned(),
            },
        ),
        FacetValue::Weight(value) => ("weights", value.clone(), value.clone()),
        FacetValue::Width(value) => ("widths", value.to_string(), format!("字宽 {value}")),
        FacetValue::Root(value) => (
            "roots",
            value.0.iter().map(|byte| format!("{byte:02x}")).collect(),
            "来源目录".to_owned(),
        ),
        FacetValue::MultipleVariants => {
            ("multipleVariants", "true".to_owned(), "多个样式".to_owned())
        }
    }
}

fn parse_identity_id(value: &str) -> Result<FontIdentityId, LibraryError> {
    Ok(FontIdentityId::from_bytes(parse_id_bytes(
        value,
        "字体标识无效",
    )?))
}

fn parse_collection_id(value: &str) -> Result<CollectionId, LibraryError> {
    Ok(CollectionId::from_bytes(parse_id_bytes(
        value,
        "收藏夹标识无效",
    )?))
}

fn parse_smart_folder_id(value: &str) -> Result<SmartFolderId, LibraryError> {
    Ok(SmartFolderId::from_bytes(parse_id_bytes(
        value,
        "智慧收藏夹标识无效",
    )?))
}

fn parse_id_bytes(value: &str, label: &str) -> Result<[u8; 16], LibraryError> {
    let raw = value.as_bytes();
    if raw.len() != 32 {
        return Err(LibraryError::Message(label.to_owned()));
    }
    let mut bytes = [0; 16];
    for (index, byte) in bytes.iter_mut().enumerate() {
        let decode = |value: u8| match value {
            b'0'..=b'9' => Some(value - b'0'),
            b'a'..=b'f' => Some(value - b'a' + 10),
            b'A'..=b'F' => Some(value - b'A' + 10),
            _ => None,
        };
        let high = decode(raw[index * 2]).ok_or_else(|| LibraryError::Message(label.to_owned()))?;
        let low =
            decode(raw[index * 2 + 1]).ok_or_else(|| LibraryError::Message(label.to_owned()))?;
        *byte = high * 16 + low;
    }
    Ok(bytes)
}

fn query_sort(value: &str) -> QuerySort {
    match value {
        "recent" => QuerySort::Recent,
        "relevance" => QuerySort::Relevance,
        "name" => QuerySort::Name,
        _ => QuerySort::Auto,
    }
}

fn smart_folder_dto(
    folder: SmartFolder,
    match_count: usize,
    saved: SavedFontQuery,
) -> SmartFolderDto {
    SmartFolderDto {
        id: folder.id.to_string(),
        name: folder.name,
        icon: folder.icon.key().to_owned(),
        color: folder.color.key().to_owned(),
        query_json: folder.query_json,
        query_text: saved.text,
        facets: QueryFacets {
            categories: saved
                .categories
                .into_iter()
                .map(|value| format!("{value:?}"))
                .collect(),
            scripts: saved.scripts,
            licenses: saved
                .licenses
                .into_iter()
                .map(|value| format!("{value:?}"))
                .collect(),
            foundries: saved.foundries,
            features: saved
                .features
                .into_iter()
                .map(|value| match value {
                    FontFeature::OpenType(tag) => format!("OpenType:{tag}"),
                    other => format!("{other:?}"),
                })
                .collect(),
            states: saved
                .states
                .into_iter()
                .map(|value| format!("{value:?}"))
                .collect(),
            weights: saved
                .weights
                .into_iter()
                .map(|value| value.to_string())
                .collect(),
            widths: saved
                .widths
                .into_iter()
                .map(|value| value.to_string())
                .collect(),
            roots: Vec::new(),
            multiple_variants: if saved.multiple_variants {
                vec!["true".to_owned()]
            } else {
                Vec::new()
            },
        },
        match_count,
    }
}

fn face_dto(face: &FontFace) -> FaceDto {
    let sources = face
        .sources
        .iter()
        .map(|source| SourceDto {
            path: source.path().to_string_lossy().into_owned(),
            face_index: source.face_index(),
        })
        .collect();
    FaceDto {
        location: None,
        id: face.id.to_string(),
        identity_id: face.identity_id.to_string(),
        style_name: face.display_subfamily(),
        postscript_name: face.metadata.postscript_name.clone(),
        format: format!("{:?}", face.format),
        is_variable: face.metadata.is_variable,
        weight: face.metadata.weight.map(|value| value.value()),
        width: face.metadata.width.map(|value| value.ratio()),
        variable_axes: face
            .metadata
            .variable_axes
            .iter()
            .map(|axis| VariableAxisDto {
                tag: axis.tag.clone(),
                min_value: axis.min_value,
                default_value: axis.default_value,
                max_value: axis.max_value,
            })
            .collect(),
        named_instances: face
            .metadata
            .named_instances
            .iter()
            .enumerate()
            .map(|(index, instance)| NamedInstanceDto {
                name: instance
                    .subfamily_name
                    .clone()
                    .unwrap_or_else(|| format!("样式 {}", index + 1)),
                coordinates: instance
                    .coordinates
                    .iter()
                    .map(|coordinate| (coordinate.axis_tag.clone(), coordinate.value))
                    .collect(),
            })
            .collect(),
        sources,
    }
}

fn preview_source_index(catalog: &Catalog) -> HashMap<String, Vec<SourceDto>> {
    catalog
        .faces()
        .map(|face| {
            (
                face.id.to_string(),
                face.sources
                    .iter()
                    .map(|source| SourceDto {
                        path: source.path().to_string_lossy().into_owned(),
                        face_index: source.face_index(),
                    })
                    .collect(),
            )
        })
        .collect()
}

// 集合与签名字体重建 sfnt；普通独立字体复用原始字节。
pub fn load_preview_font(source: &SourceDto) -> Result<PreviewFont, LibraryError> {
    let data = std::fs::read(&source.path).map_err(|_| LibraryError::Preview)?;
    let font = FontRef::from_index(&data, source.face_index).map_err(|_| LibraryError::Preview)?;
    let rebuild = data.starts_with(b"ttcf")
        || font
            .table_directory
            .table_records()
            .iter()
            .any(|record| record.tag().to_be_bytes() == *b"DSIG");
    let mut coverage: Vec<[u32; 2]> = Vec::new();
    let mut sample = String::new();
    let mut sample_length = 0;
    for (codepoint, _) in font.charmap().mappings() {
        if let Some(last) = coverage.last_mut().filter(|last| last[1] + 1 == codepoint) {
            last[1] = codepoint;
        } else {
            coverage.push([codepoint, codepoint]);
        }
        if sample_length < 12 {
            if let Some(character) = char::from_u32(codepoint)
                .filter(|character| !character.is_control() && !character.is_whitespace())
            {
                sample.push(character);
                sample_length += 1;
            }
        }
    }
    let bytes = if rebuild {
        let mut builder = FontBuilder::new();
        for record in font.table_directory.table_records() {
            let tag = record.tag();
            if tag.to_be_bytes() != *b"DSIG" {
                if let Some(table) = font.table_data(tag) {
                    builder.add_raw(tag, table.as_bytes());
                }
            }
        }
        builder.build()
    } else {
        data
    };
    Ok(PreviewFont {
        bytes,
        coverage,
        sample,
    })
}

pub fn render_face_preview(
    source: &SourceDto,
    sample: &str,
    size: f32,
) -> Result<String, LibraryError> {
    const WIDTH: i32 = 360;
    const HEIGHT: i32 = 96;
    let font =
        Font::from_path(&source.path, source.face_index).map_err(|_| LibraryError::Preview)?;
    let mut canvas = Canvas::new(Vector2I::new(WIDTH, HEIGHT), Format::A8);
    let baseline = (HEIGHT as f32 * 0.72).round();
    let mut x = 4.0f32;
    for character in sample.chars().take(48) {
        if character.is_control() {
            continue;
        }
        // 不支持的字符显示缺字字形，避免一个字符使整张预览失效。
        let glyph = font.glyph_for_char(character).unwrap_or(0);
        let transform = Transform2F::from_translation(Vector2F::new(x, baseline));
        font.rasterize_glyph(
            &mut canvas,
            glyph,
            size,
            transform,
            HintingOptions::None,
            RasterizationOptions::GrayscaleAa,
        )
        .map_err(|_| LibraryError::Preview)?;
        x += font.advance(glyph).map_err(|_| LibraryError::Preview)?.x() * size
            / font.metrics().units_per_em as f32;
        if x >= WIDTH as f32 - size * 0.4 {
            break;
        }
    }

    let mut rgba = Vec::with_capacity((WIDTH * HEIGHT * 4) as usize);
    for alpha in canvas.pixels {
        rgba.extend_from_slice(&[24, 25, 27, alpha]);
    }
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, WIDTH as u32, HEIGHT as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|_| LibraryError::Preview)?;
        writer
            .write_image_data(&rgba)
            .map_err(|_| LibraryError::Preview)?;
    }
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

fn system_font_roots() -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let mut roots = Vec::new();
        if let Some(windows) = std::env::var_os("WINDIR") {
            roots.push(PathBuf::from(windows).join("Fonts"));
        }
        return roots;
    }
    #[cfg(target_os = "linux")]
    {
        return vec![
            PathBuf::from("/usr/share/fonts"),
            PathBuf::from("/usr/local/share/fonts"),
        ];
    }
    #[allow(unreachable_code)]
    Vec::new()
}

fn user_font_roots() -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let mut roots = Vec::new();
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            roots.push(PathBuf::from(local).join("Microsoft/Windows/Fonts"));
        }
        return roots;
    }
    #[cfg(target_os = "linux")]
    {
        let mut roots = Vec::new();
        if let Some(home) = std::env::var_os("HOME") {
            roots.push(PathBuf::from(&home).join(".local/share/fonts"));
            roots.push(PathBuf::from(&home).join(".fonts"));
        }
        return roots;
    }
    #[allow(unreachable_code)]
    Vec::new()
}

fn default_font_roots() -> Vec<PathBuf> {
    let mut roots = system_font_roots();
    roots.extend(user_font_roots());
    roots
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decoded_preview(source: &SourceDto) -> Vec<u8> {
        load_preview_font(source).unwrap().bytes
    }

    #[test]
    fn preview_packet_has_little_endian_metadata_and_raw_font_bytes() {
        let packet = PreviewFont {
            bytes: vec![0, 1, 0, 0],
            coverage: vec![[32, 126], [0x1f600, 0x1f600]],
            sample: "Aa😀".to_owned(),
        }
        .into_packet()
        .unwrap();
        let length = u32::from_le_bytes(packet[..4].try_into().unwrap()) as usize;
        let metadata: serde_json::Value = serde_json::from_slice(&packet[4..4 + length]).unwrap();
        assert_eq!(metadata["sample"], "Aa😀");
        assert_eq!(metadata["coverage"][1][0], 0x1f600);
        assert_eq!(&packet[4 + length..], &[0, 1, 0, 0]);
    }

    #[test]
    fn preview_reuses_unsigned_single_fonts_and_removes_invalid_signatures() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/fonts");
        let path = root.join("Lato-Regular.ttf");
        let original_data = std::fs::read(&path).unwrap();
        let original = FontRef::new(&original_data).unwrap();
        let source = SourceDto {
            path: path.to_string_lossy().into_owned(),
            face_index: 0,
        };
        assert_eq!(load_preview_font(&source).unwrap().bytes, original_data);
        let mut builder = FontBuilder::new();
        for record in original.table_directory.table_records() {
            if let Some(table) = original.table_data(record.tag()) {
                builder.add_raw(record.tag(), table.as_bytes());
            }
        }
        builder.add_raw(write_fonts::types::Tag::new(b"DSIG"), &[0; 8]);
        let directory = tempfile::tempdir().unwrap();
        let signed_path = directory.path().join("signed.ttf");
        std::fs::write(&signed_path, builder.build()).unwrap();
        let exported_data = decoded_preview(&SourceDto {
            path: signed_path.to_string_lossy().into_owned(),
            face_index: 0,
        });
        let exported = FontRef::new(&exported_data).unwrap();
        assert!(exported
            .table_data(write_fonts::types::Tag::new(b"DSIG"))
            .is_none());
        for tag in [b"glyf", b"cmap", b"name"] {
            let tag = write_fonts::types::Tag::new(tag);
            assert_eq!(
                original.table_data(tag).unwrap().as_bytes(),
                exported.table_data(tag).unwrap().as_bytes()
            );
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "本机字体性能采样，需要单独执行"]
    fn preview_performance() {
        use std::time::Instant;
        fn p95(values: &mut [f64]) -> f64 {
            values.sort_by(f64::total_cmp);
            values[(values.len() as f64 * 0.95).ceil() as usize - 1]
        }
        let root = PathBuf::from(std::env::var_os("WINDIR").unwrap()).join("Fonts");
        for name in [
            "arial.ttf",
            "NotoSansSC-VF.ttf",
            "NotoSerifSC-VF.ttf",
            "mingliub.ttc",
        ] {
            let path = root.join(name);
            if !path.is_file() {
                continue;
            }
            let source = SourceDto {
                path: path.to_string_lossy().into_owned(),
                face_index: 0,
            };
            let service = crate::preview::PreviewService::default();
            let mut baseline = Vec::new();
            let mut binary = Vec::new();
            let mut warm = Vec::new();
            let mut baseline_bytes = 0;
            let mut binary_bytes = 0;
            for _ in 0..10 {
                let start = Instant::now();
                let data = std::fs::read(&path).unwrap();
                let font = FontRef::from_index(&data, 0).unwrap();
                let mut builder = FontBuilder::new();
                for record in font.table_directory.table_records() {
                    if record.tag().to_be_bytes() != *b"DSIG" {
                        if let Some(table) = font.table_data(record.tag()) {
                            builder.add_raw(record.tag(), table.as_bytes());
                        }
                    }
                }
                let mut coverage: Vec<[u32; 2]> = Vec::new();
                let mut sample = String::new();
                for (codepoint, _) in font.charmap().mappings() {
                    if let Some(last) = coverage.last_mut().filter(|last| last[1] + 1 == codepoint)
                    {
                        last[1] = codepoint;
                    } else {
                        coverage.push([codepoint, codepoint]);
                    }
                    if sample.chars().count() < 12 {
                        if let Some(character) = char::from_u32(codepoint)
                            .filter(|c| !c.is_control() && !c.is_whitespace())
                        {
                            sample.push(character);
                        }
                    }
                }
                let response = serde_json::to_vec(&serde_json::json!({ "dataUrl": format!("data:font/otf;base64,{}", STANDARD.encode(builder.build())), "coverage": coverage, "sample": sample })).unwrap();
                baseline_bytes = response.len();
                baseline.push(start.elapsed().as_secs_f64() * 1000.0);
                drop(response);
                service.invalidate();
                let start = Instant::now();
                let response = service
                    .font(name, std::slice::from_ref(&source), service.generation())
                    .unwrap()
                    .as_ref()
                    .clone();
                binary_bytes = response.len();
                binary.push(start.elapsed().as_secs_f64() * 1000.0);
                drop(response);
                let start = Instant::now();
                let response = service
                    .font(name, std::slice::from_ref(&source), service.generation())
                    .unwrap()
                    .as_ref()
                    .clone();
                warm.push(start.elapsed().as_secs_f64() * 1000.0);
                drop(response);
            }
            println!(
                "{}",
                serde_json::json!({ "font": name, "samples": 10, "baselineP95Ms": p95(&mut baseline), "binaryP95Ms": p95(&mut binary), "warmP95Ms": p95(&mut warm), "baselineBytes": baseline_bytes, "binaryBytes": binary_bytes })
            );
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "本机 TTC 导出分段采样，需要单独执行"]
    fn preview_export_stages() {
        use std::time::Instant;
        let path = PathBuf::from(std::env::var_os("WINDIR").unwrap()).join("Fonts/mingliub.ttc");
        if !path.is_file() {
            return;
        }
        let mut stages = [Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new()];
        for _ in 0..10 {
            let start = Instant::now();
            let data = std::fs::read(&path).unwrap();
            stages[0].push(start.elapsed().as_secs_f64() * 1000.0);
            let start = Instant::now();
            let font = FontRef::from_index(&data, 0).unwrap();
            let mut coverage: Vec<[u32; 2]> = Vec::new();
            for (codepoint, _) in font.charmap().mappings() {
                if let Some(last) = coverage.last_mut().filter(|last| last[1] + 1 == codepoint) {
                    last[1] = codepoint;
                } else {
                    coverage.push([codepoint, codepoint]);
                }
            }
            stages[1].push(start.elapsed().as_secs_f64() * 1000.0);
            let start = Instant::now();
            let mut builder = FontBuilder::new();
            for record in font.table_directory.table_records() {
                if record.tag().to_be_bytes() != *b"DSIG" {
                    if let Some(table) = font.table_data(record.tag()) {
                        builder.add_raw(record.tag(), table.as_bytes());
                    }
                }
            }
            let bytes = builder.build();
            stages[2].push(start.elapsed().as_secs_f64() * 1000.0);
            let start = Instant::now();
            let packet = PreviewFont {
                bytes,
                coverage,
                sample: String::new(),
            }
            .into_packet()
            .unwrap();
            stages[3].push(start.elapsed().as_secs_f64() * 1000.0);
            let start = Instant::now();
            let response = packet.clone();
            stages[4].push(start.elapsed().as_secs_f64() * 1000.0);
            std::hint::black_box(response);
        }
        let names = ["read", "coverage", "rebuild", "packet", "response-copy"];
        for (name, values) in names.into_iter().zip(&mut stages) {
            values.sort_by(f64::total_cmp);
            println!(
                "{}",
                serde_json::json!({ "stage": name, "samples": values.len(), "p95Ms": values[(values.len() as f64 * 0.95).ceil() as usize - 1] })
            );
        }
    }

    #[test]
    #[ignore = "本机最近记录性能采样，需要提供独立数据库副本"]
    fn recent_performance() {
        use std::time::Instant;
        let Some(path) = std::env::var_os("FOLIO_PERFORMANCE_DATABASE") else {
            return;
        };
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("folio.sqlite");
        std::fs::copy(path, &database).unwrap();
        let mut library = LibraryService::open(database).unwrap();
        let identities: Vec<_> = library
            .catalog
            .faces()
            .take(20)
            .map(|face| face.identity_id.to_string())
            .collect();
        let mut baseline = Vec::new();
        let mut current = Vec::new();
        for identity in &identities {
            let start = Instant::now();
            library
                .database
                .record_recent(parse_identity_id(identity).unwrap())
                .unwrap();
            library.state = library.database.library_state_snapshot().unwrap();
            library.query_index.update_state(&library.state);
            baseline.push(start.elapsed().as_secs_f64() * 1000.0);
            let start = Instant::now();
            library.record_recent(identity).unwrap();
            current.push(start.elapsed().as_secs_f64() * 1000.0);
        }
        if identities.is_empty() {
            return;
        }
        baseline.sort_by(f64::total_cmp);
        current.sort_by(f64::total_cmp);
        let index = (identities.len() as f64 * 0.95).ceil() as usize - 1;
        println!(
            "{}",
            serde_json::json!({ "samples": identities.len(), "faces": library.catalog.faces().count(), "baselineP95Ms": baseline[index], "currentP95Ms": current[index] })
        );
    }

    #[test]
    fn preview_extracts_each_collection_face_without_changing_glyph_tables() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("collection.ttc");
        std::fs::write(&path, font_test_data::ttc::TTC).unwrap();
        for index in 0..2 {
            let source = SourceDto {
                path: path.to_string_lossy().into_owned(),
                face_index: index,
            };
            let data = decoded_preview(&source);
            let exported = FontRef::new(&data).unwrap();
            let original = FontRef::from_index(font_test_data::ttc::TTC, index).unwrap();
            for tag in [*b"cmap", *b"glyf", *b"hmtx", *b"name"] {
                let tag = write_fonts::types::Tag::new(&tag);
                assert_eq!(
                    exported.table_data(tag).unwrap().as_bytes(),
                    original.table_data(tag).unwrap().as_bytes()
                );
            }
        }
        assert!(load_preview_font(&SourceDto {
            path: path.to_string_lossy().into_owned(),
            face_index: 100
        })
        .is_err());
    }

    #[test]
    fn preview_preserves_variable_axes_and_cff_outlines() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/fonts");
        for (name, tags) in [
            ("Inter-Variable.ttf", vec![*b"fvar", *b"gvar"]),
            ("SourceSerif4-Regular.otf", vec![*b"CFF "]),
        ] {
            let path = root.join(name);
            let original_data = std::fs::read(&path).unwrap();
            let original = FontRef::new(&original_data).unwrap();
            let data = decoded_preview(&SourceDto {
                path: path.to_string_lossy().into_owned(),
                face_index: 0,
            });
            let exported = FontRef::new(&data).unwrap();
            for tag in tags {
                let tag = write_fonts::types::Tag::new(&tag);
                assert_eq!(
                    exported.table_data(tag).unwrap().as_bytes(),
                    original.table_data(tag).unwrap().as_bytes()
                );
            }
        }
    }

    #[test]
    fn native_preview_keeps_latin_glyphs_when_sample_contains_missing_characters() {
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../fixtures/fonts/Lato-Regular.ttf");
        let report =
            folio_core::scan_files(&[fixture], &folio_core::ScanOptions::default()).unwrap();
        let face = report.catalog.faces().next().unwrap();
        assert!(render_face_preview(&face_dto(face).sources[0], "Folio 字体预览", 48.0).is_ok());
        let preview = load_preview_font(&SourceDto {
            path: face.sources[0].path().to_string_lossy().into_owned(),
            face_index: 0,
        })
        .unwrap();
        let covers = |codepoint| {
            preview
                .coverage
                .iter()
                .any(|range| range[0] <= codepoint && codepoint <= range[1])
        };
        assert!(covers('F' as u32));
        assert!(!covers('字' as u32));
        assert!(!preview.sample.is_empty());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn preview_exports_windows_system_fonts_and_collection_members() {
        let root = PathBuf::from(std::env::var_os("WINDIR").unwrap()).join("Fonts");
        let output = std::env::var_os("FOLIO_PREVIEW_VERIFY_DIR").map(PathBuf::from);
        if let Some(output) = &output {
            std::fs::create_dir_all(output).unwrap();
        }
        let mut manifest = Vec::new();
        for name in [
            "arial.ttf",
            "arialbd.ttf",
            "cambria.ttc",
            "msyh.ttc",
            "simsun.ttc",
            "SegUIVar.ttf",
            "bahnschrift.ttf",
            "segmdl2.ttf",
            "seguisym.ttf",
            "seguiemj.ttf",
            "wingding.ttf",
        ] {
            let path = root.join(name);
            if !path.is_file() {
                continue;
            }
            let bytes = std::fs::read(&path).unwrap();
            for (index, original) in FontRef::fonts(&bytes).enumerate() {
                let original = original.unwrap();
                let source = SourceDto {
                    path: path.to_string_lossy().into_owned(),
                    face_index: index as u32,
                };
                let preview = load_preview_font(&source).unwrap();
                let data = preview.bytes;
                let exported = FontRef::new(&data).unwrap();
                let cmap = write_fonts::types::Tag::new(b"cmap");
                assert_eq!(
                    exported.table_data(cmap).unwrap().as_bytes(),
                    original.table_data(cmap).unwrap().as_bytes(),
                    "{name}, {index}"
                );
                // 可选导出供浏览器验证，默认只做内存中的回归检查。
                if let Some(output) = &output {
                    let filename = format!("{name}-{index}.otf");
                    std::fs::write(output.join(&filename), &data).unwrap();
                    manifest.push(serde_json::json!({ "name": name, "index": index, "file": filename, "coverage": preview.coverage, "sample": preview.sample }));
                }
            }
        }
        if let Some(output) = &output {
            std::fs::write(
                output.join("manifest.json"),
                serde_json::to_vec(&manifest).unwrap(),
            )
            .unwrap();
        }
    }

    #[test]
    fn canonical_font_sources_match_their_roots() {
        let source = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../fixtures/fonts/Lato-Regular.ttf")
            .canonicalize()
            .unwrap();
        let raw_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/fonts");
        let normalized_root = normalize_font_root(&raw_root);
        let external = FontSourceRoots {
            managed: raw_root.join("not-managed"),
            system: Vec::new(),
            user: Vec::new(),
        };
        assert_eq!(classify_source(&source, &external), FontStateKind::External);

        let system = FontSourceRoots {
            system: vec![normalized_root.clone()],
            ..external
        };
        assert_eq!(classify_source(&source, &system), FontStateKind::System);
        let user = FontSourceRoots {
            system: Vec::new(),
            user: vec![UserFontGroup {
                id: "user:test".to_owned(),
                name: "test".to_owned(),
                roots: vec![normalized_root.clone()],
            }],
            ..system
        };
        assert_eq!(classify_source(&source, &user), FontStateKind::User);
        let managed = FontSourceRoots {
            managed: normalized_root,
            user: Vec::new(),
            ..user
        };
        assert_eq!(classify_source(&source, &managed), FontStateKind::Available);
        assert_eq!(
            classify_source(&source.with_file_name("missing.ttf"), &managed),
            FontStateKind::Unavailable
        );
    }

    #[test]
    fn recording_recent_preserves_other_state_and_updates_query() {
        let directory = tempfile::tempdir().unwrap();
        let managed = directory.path().join("ManagedFonts");
        std::fs::create_dir(&managed).unwrap();
        let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/fonts");
        for name in ["Lato-Regular.ttf", "Inter-Variable.ttf"] {
            std::fs::copy(fixtures.join(name), managed.join(name)).unwrap();
        }
        let mut library = LibraryService::open(directory.path().join("folio.sqlite")).unwrap();
        library.refresh().unwrap();
        let identities: Vec<_> = library
            .catalog
            .faces()
            .map(|face| face.identity_id.to_string())
            .collect();
        library.set_favorites(&identities[..1], true).unwrap();
        let collection = library
            .save_collection(CollectionMutation {
                id: None,
                name: "字体收藏".to_owned(),
                icon: "folder".to_owned(),
                color: "gray".to_owned(),
            })
            .unwrap();
        library
            .set_collection_members(CollectionMembershipMutation {
                collection_id: collection.id.clone(),
                identity_ids: identities[..1].to_vec(),
                member: true,
            })
            .unwrap();
        let roots: Vec<_> = library
            .state
            .roots
            .iter()
            .map(|root| (root.root_id, root.face_ids.clone()))
            .collect();
        assert_eq!(library.record_recent(&identities[0]).unwrap(), 1);
        assert_eq!(library.record_recent(&identities[0]).unwrap(), 1);
        assert_eq!(library.record_recent(&identities[1]).unwrap(), 2);
        assert_eq!(
            library
                .state
                .roots
                .iter()
                .map(|root| (root.root_id, root.face_ids.clone()))
                .collect::<Vec<_>>(),
            roots
        );
        for (scope, count) in [("recent", 2), ("favorites", 1), ("collection", 1)] {
            let request: PageRequest = serde_json::from_value(
                serde_json::json!({ "scope": scope, "collectionId": collection.id }),
            )
            .unwrap();
            assert_eq!(library.query(request).unwrap().families.len(), count);
        }
        let stored = library.database.list_recent(usize::MAX).unwrap();
        assert_eq!(library.state.recent.len(), stored.len());
        assert_eq!(
            stored[0].identity_id,
            parse_identity_id(&identities[1]).unwrap()
        );
    }

    #[test]
    fn snapshot_counts_variable_families_in_the_complete_catalog() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("fonts");
        std::fs::create_dir(&root).unwrap();
        let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/fonts");
        for name in ["Lato-Regular.ttf", "Lato-Italic.ttf", "Inter-Variable.ttf"] {
            std::fs::copy(fixtures.join(name), root.join(name)).unwrap();
        }
        let mut library = LibraryService::open(dir.path().join("folio.sqlite")).unwrap();
        let snapshot = library.add_root(root).unwrap();
        assert_eq!(snapshot.family_count, 2);
        assert_eq!(snapshot.variable_family_count, 1);
        let request: PageRequest =
            serde_json::from_value(serde_json::json!({ "limit": 1 })).unwrap();
        assert_eq!(library.query(request).unwrap().families.len(), 1);
        assert_eq!(library.snapshot().variable_family_count, 1);
    }

    #[test]
    fn refresh_indexes_files_already_in_managed_directory() {
        let dir = tempfile::tempdir().unwrap();
        let managed = dir.path().join("ManagedFonts");
        std::fs::create_dir(&managed).unwrap();
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../fixtures/fonts/Lato-Regular.ttf");
        std::fs::copy(fixture, managed.join("Lato-Regular.ttf")).unwrap();
        let mut library = LibraryService::open(dir.path().join("folio.sqlite")).unwrap();

        let snapshot = library.refresh().unwrap();
        assert_eq!(snapshot.family_count, 1);
        assert_eq!(snapshot.font_state_counts["available"], 1);
        assert!(snapshot
            .roots
            .iter()
            .any(|root| root.ends_with("ManagedFonts")));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_user_font_paths_have_independent_profiles() {
        let alice = Path::new(r"C:\Users\Alice\AppData\Local\Microsoft\Windows\Fonts\a.ttf");
        let bob = Path::new(r"D:\Profiles\Bob\AppData\Local\Microsoft\Windows\Fonts\b.ttf");
        let alice_root = user_font_root_for_path(alice).unwrap();
        let bob_root = user_font_root_for_path(bob).unwrap();
        assert_eq!(
            profile_name(&user_profile_for_font_root(&alice_root).unwrap()),
            "Alice"
        );
        assert_eq!(
            profile_name(&user_profile_for_font_root(&bob_root).unwrap()),
            "Bob"
        );
        assert_ne!(alice_root, bob_root);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn user_font_groups_count_and_filter_each_account_separately() {
        let dir = tempfile::tempdir().unwrap();
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../fixtures/fonts/Lato-Regular.ttf");
        let mut library = LibraryService::open(dir.path().join("folio.sqlite")).unwrap();
        for account in ["Alice", "Bob"] {
            let root = dir
                .path()
                .join(account)
                .join("AppData/Local/Microsoft/Windows/Fonts");
            std::fs::create_dir_all(&root).unwrap();
            std::fs::copy(&fixture, root.join("Lato-Regular.ttf")).unwrap();
            library.database.add_root(root, true).unwrap();
        }

        let snapshot = library.refresh().unwrap();
        for account in ["Alice", "Bob"] {
            let group = snapshot
                .user_font_groups
                .iter()
                .find(|group| group.name == account)
                .unwrap();
            assert_eq!(group.family_count, 1);
            assert_eq!(library.face_ids_for_state(&group.id).len(), 1);
        }
    }
}
