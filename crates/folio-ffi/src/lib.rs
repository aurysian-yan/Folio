//! Folio 的 Swift 友好粗粒度桥接层。

#![forbid(unsafe_code)]

use std::collections::BTreeSet;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use folio_core::{
    Catalog, CollectionId, FontCategory, FontFace, FontFaceId, FontFamilyId, FontIdentityId,
    LicenseKind,
};
use folio_query::{
    FacetFilter, FacetValue, FontQuery, FontQueryIndex, FoundryKey, QueryScope, QuerySort,
};
use folio_storage::{AddRootOutcome, FolioDatabase, RefreshIssueKind, RefreshMode};

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
    pub face_index: u32,
    pub file_size: u64,
    pub version: Option<String>,
    pub manufacturer: Option<String>,
    pub category: String,
    pub license: String,
    pub scripts: Vec<String>,
    pub axes: Vec<VariableAxisDto>,
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
    pub member_count: u64,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct RootDto {
    pub id: RootIdDto,
    pub display_path: String,
    pub recursive: bool,
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

    pub fn query_library(&self, query: LibraryQueryDto) -> Result<LibraryPageDto, FolioFfiError> {
        let state = self.lock()?;
        let query = query_from_dto(query)?;
        let result = state
            .index
            .query(&query)
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
                state
                    .catalog
                    .find_family(matched.family_id)
                    .map(|family| family_card(family, &matched.matched_face_ids, &favorites))
            })
            .collect();
        Ok(LibraryPageDto {
            total_matches: result.total_matches as u64,
            families,
            facets: result
                .facet_summary
                .into_iter()
                .filter_map(facet_count)
                .collect(),
            unresolved_scope_items: result.unresolved_scope_items.len() as u64,
        })
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
            faces: family.faces.iter().map(face_summary).collect(),
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
        let state = self.lock()?;
        let collection = state
            .database
            .create_collection(&name)
            .map_err(FolioFfiError::operation)?;
        Ok(CollectionDto {
            id: collection_dto(collection.id),
            name: collection.name,
            member_count: 0,
        })
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
) -> FamilyCardDto {
    let identities = family_identities(family);
    FamilyCardDto {
        id: family_dto(family.id),
        display_name: family
            .display_name
            .clone()
            .unwrap_or_else(|| "未命名字体".to_owned()),
        faces: family.faces.iter().map(face_summary).collect(),
        identity_ids: identities.iter().copied().map(identity_dto).collect(),
        matched_face_ids: matched_faces.iter().copied().map(face_dto).collect(),
        is_favorite: !identities.is_empty() && identities.iter().all(|id| favorites.contains(id)),
        is_variable: family.faces.iter().any(|face| face.metadata.is_variable),
        manufacturer: family
            .faces
            .iter()
            .find_map(|face| face.metadata.enrichment.foundry.manufacturer.clone()),
    }
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

fn face_summary(face: &FontFace) -> FaceSummaryDto {
    let source = face.sources.first();
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
    FaceSummaryDto {
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
        face_index: source.map_or(0, |source| source.face_index()),
        file_size: source
            .map(|source| std::fs::metadata(source.path()).map_or(0, |metadata| metadata.len()))
            .unwrap_or(0),
        version,
        manufacturer: face.metadata.enrichment.foundry.manufacturer.clone(),
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
    }
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
                offset: 0,
                limit: 120,
            })
            .unwrap();
        assert_eq!(page.total_matches, 0);
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
