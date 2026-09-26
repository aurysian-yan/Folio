use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use folio_core::{
    Catalog, CollectionColor, CollectionIcon, CollectionId, FontCategory, FontFace, FontIdentityId,
    FontWeight, FontWidth, LibraryRootKey, LicenseKind, SmartFolder, SmartFolderId,
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
    pub sources: Vec<SourceDto>,
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
    pub roots: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontPreviewDto {
    pub face_id: String,
    pub data_url: Option<String>,
    pub error: Option<String>,
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
    preview_cache: HashMap<(String, String, u32), String>,
}

impl LibraryService {
    pub fn open(path: PathBuf) -> Result<Self, LibraryError> {
        let mut database = FolioDatabase::open(path)?;
        let catalog = database.load_cached_catalog()?;
        let state = database.library_state_snapshot()?;
        let query_index = FontQueryIndex::build(&catalog, &state)?;
        Ok(Self {
            database,
            catalog,
            state,
            query_index,
            preview_cache: HashMap::new(),
        })
    }

    pub fn add_default_roots(&mut self) -> Result<(), LibraryError> {
        for path in default_font_roots() {
            if path.is_dir() {
                self.database.add_root(path, true)?;
            }
        }
        Ok(())
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
        self.database.refresh(RefreshMode::Incremental)?;
        self.catalog = self.database.load_cached_catalog()?;
        self.state = self.database.library_state_snapshot()?;
        self.query_index = FontQueryIndex::build(&self.catalog, &self.state)?;
        Ok(self.snapshot())
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
        let result = self.query_index.query(&query)?;
        let mut facet_query = query.clone();
        facet_query.facets = FacetFilter::default();
        let facet_summary = self.query_index.query(&facet_query)?.facet_summary;
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
        let families = result
            .families
            .into_iter()
            .filter_map(|matched| {
                let family = self.catalog.find_family(matched.family_id)?;
                let faces: Vec<FaceDto> = family.faces.iter().map(face_dto).collect();
                Some(FamilyDto {
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

    fn refresh_query_state(&mut self) -> Result<(), LibraryError> {
        self.state = self.database.library_state_snapshot()?;
        self.query_index.update_state(&self.state);
        Ok(())
    }

    pub fn render_previews(
        &mut self,
        face_ids: &[String],
        sample: &str,
        size: u32,
    ) -> Result<Vec<FontPreviewDto>, LibraryError> {
        let size = size.clamp(24, 104) as f32;
        let mut previews = Vec::new();
        for id in face_ids.iter().take(120) {
            let key = (id.clone(), sample.to_owned(), size as u32);
            if let Some(data_url) = self.preview_cache.get(&key) {
                previews.push(FontPreviewDto {
                    face_id: id.clone(),
                    data_url: Some(data_url.clone()),
                    error: None,
                });
                continue;
            }
            if let Some(face) = self.catalog.faces().find(|face| face.id.to_string() == *id) {
                let result = render_face_preview(face, sample, size);
                match result {
                    Ok(data_url) => {
                        if self.preview_cache.len() >= 720 {
                            self.preview_cache.clear();
                        }
                        self.preview_cache.insert(key, data_url.clone());
                        previews.push(FontPreviewDto {
                            face_id: id.clone(),
                            data_url: Some(data_url),
                            error: None,
                        });
                    }
                    Err(_) => previews.push(FontPreviewDto {
                        face_id: id.clone(),
                        data_url: None,
                        error: Some("无法从此字体文件准确载入所选字面".to_owned()),
                    }),
                }
            } else {
                previews.push(FontPreviewDto {
                    face_id: id.clone(),
                    data_url: None,
                    error: Some("字体面已不在当前目录中".to_owned()),
                });
            }
        }
        Ok(previews)
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

    pub fn record_recent(&mut self, identity_id: &str) -> Result<(), LibraryError> {
        self.database
            .record_recent(parse_identity_id(identity_id)?)?;
        self.state = self.database.library_state_snapshot()?;
        self.query_index.update_state(&self.state);
        Ok(())
    }

    fn snapshot(&self) -> LibrarySnapshotDto {
        let roots = self
            .database
            .list_roots()
            .unwrap_or_default()
            .into_iter()
            .map(|root| root.display_path)
            .collect();
        LibrarySnapshotDto {
            family_count: self.catalog.family_count(),
            face_count: self.catalog.face_count(),
            roots,
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
        id: face.id.to_string(),
        identity_id: face.identity_id.to_string(),
        style_name: face.display_subfamily(),
        postscript_name: face.metadata.postscript_name.clone(),
        format: format!("{:?}", face.format),
        is_variable: face.metadata.is_variable,
        weight: face.metadata.weight.map(|value| value.value()),
        width: face.metadata.width.map(|value| value.ratio()),
        sources,
    }
}

fn render_face_preview(face: &FontFace, sample: &str, size: f32) -> Result<String, LibraryError> {
    const WIDTH: i32 = 360;
    const HEIGHT: i32 = 96;
    let source = face.sources.first().ok_or(LibraryError::Preview)?;
    let font =
        Font::from_path(source.path(), source.face_index()).map_err(|_| LibraryError::Preview)?;
    let mut canvas = Canvas::new(Vector2I::new(WIDTH, HEIGHT), Format::A8);
    let baseline = (HEIGHT as f32 * 0.72).round();
    let mut x = 4.0f32;
    for character in sample.chars().take(48) {
        if character.is_control() {
            continue;
        }
        let glyph = font
            .glyph_for_char(character)
            .ok_or(LibraryError::Preview)?;
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

fn default_font_roots() -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let mut roots = Vec::new();
        if let Some(windows) = std::env::var_os("WINDIR") {
            roots.push(PathBuf::from(windows).join("Fonts"));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            roots.push(PathBuf::from(local).join("Microsoft/Windows/Fonts"));
        }
        return roots;
    }
    #[cfg(target_os = "linux")]
    {
        let mut roots = vec![
            PathBuf::from("/usr/share/fonts"),
            PathBuf::from("/usr/local/share/fonts"),
        ];
        if let Some(home) = std::env::var_os("HOME") {
            roots.push(PathBuf::from(&home).join(".local/share/fonts"));
            roots.push(PathBuf::from(&home).join(".fonts"));
        }
        return roots;
    }
    #[allow(unreachable_code)]
    Vec::new()
}
