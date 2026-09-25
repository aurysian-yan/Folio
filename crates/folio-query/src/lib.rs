//! 可重建内存索引：逐面搜索和筛选，按家族返回稳定结果。
#![forbid(unsafe_code)]

mod health;
use folio_core::*;
pub use health::*;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub enum QueryScope {
    #[default]
    All,
    Favorites,
    Recent,
    Collection(CollectionId),
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub enum QuerySort {
    #[default]
    Auto,
    Name,
    Relevance,
    Recent,
}
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum FontFeature {
    Variable,
    Italic,
    Oblique,
    Monospace,
    Color,
    OpenType(String),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum FontState {
    Favorite,
    Recent,
    DuplicateSources,
    MultipleRevisions,
    MetadataConflict,
}
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct FoundryKey(pub String);
impl FoundryKey {
    pub fn new(label: &str) -> Self {
        Self(normalize_search(label))
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
/// 同组多值取 OR，跨组取 AND；所有组必须由同一个 Face 满足。
pub struct FacetFilter {
    pub categories: Vec<FontCategory>,
    pub scripts: Vec<String>,
    pub licenses: Vec<LicenseKind>,
    pub foundries: Vec<FoundryKey>,
    pub weights: Vec<FontWeight>,
    pub widths: Vec<FontWidth>,
    pub features: Vec<FontFeature>,
    pub roots: Vec<LibraryRootKey>,
    pub states: Vec<FontState>,
    pub multiple_variants: bool,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct FontQuery {
    pub text: Option<String>,
    pub scope: QueryScope,
    pub facets: FacetFilter,
    pub sort: QuerySort,
    pub offset: usize,
    pub limit: Option<usize>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct SavedFontQuery {
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub categories: Vec<FontCategory>,
    #[serde(default)]
    pub scripts: Vec<String>,
    #[serde(default)]
    pub licenses: Vec<LicenseKind>,
    #[serde(default)]
    pub foundries: Vec<String>,
    #[serde(default)]
    pub weights: Vec<f32>,
    #[serde(default)]
    pub widths: Vec<u16>,
    #[serde(default)]
    pub features: Vec<FontFeature>,
    #[serde(default)]
    pub states: Vec<FontState>,
    #[serde(default)]
    pub multiple_variants: bool,
}

impl SavedFontQuery {
    pub fn from_filter(text: Option<String>, facets: FacetFilter) -> Result<Self, QueryError> {
        if !facets.roots.is_empty() {
            return Err(QueryError::NonPortableRootFilter);
        }
        let mut query = Self {
            text: text.filter(|value| !value.trim().is_empty()),
            categories: facets.categories,
            scripts: facets.scripts,
            licenses: facets.licenses,
            foundries: facets
                .foundries
                .into_iter()
                .map(|value| FoundryKey::new(&value.0).0)
                .collect(),
            weights: facets.weights.into_iter().map(FontWeight::value).collect(),
            widths: facets.widths.into_iter().map(FontWidth::class).collect(),
            features: facets.features,
            states: facets.states,
            multiple_variants: facets.multiple_variants,
        };
        query.categories.sort();
        query.categories.dedup();
        query.scripts.sort();
        query.scripts.dedup();
        query.licenses.sort();
        query.licenses.dedup();
        query.foundries.sort();
        query.foundries.dedup();
        query.weights.sort_by(|left, right| left.total_cmp(right));
        query.weights.dedup_by(|left, right| *left == *right);
        query.widths.sort();
        query.widths.dedup();
        query.features.sort();
        query.features.dedup();
        query.states.sort();
        query.states.dedup();
        Ok(query)
    }

    pub fn into_query(self, offset: usize, limit: Option<usize>) -> Result<FontQuery, QueryError> {
        let widths = self
            .widths
            .into_iter()
            .map(|class| {
                FontWidth::from_width_class(class).ok_or(QueryError::InvalidSavedWidth(class))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut weights = Vec::with_capacity(self.weights.len());
        for value in self.weights {
            if !value.is_finite() {
                return Err(QueryError::InvalidSavedWeight);
            }
            weights.push(FontWeight::new(value));
        }
        Ok(FontQuery {
            text: self.text,
            scope: QueryScope::All,
            facets: FacetFilter {
                categories: self.categories,
                scripts: self.scripts,
                licenses: self.licenses,
                foundries: self.foundries.into_iter().map(FoundryKey).collect(),
                weights,
                widths,
                features: self.features,
                roots: Vec::new(),
                states: self.states,
                multiple_variants: self.multiple_variants,
            },
            sort: QuerySort::Auto,
            offset,
            limit,
        })
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FamilyMatch {
    pub family_id: FontFamilyId,
    pub display_name: Option<String>,
    pub matched_face_ids: Vec<FontFaceId>,
    pub matched_identity_ids: Vec<FontIdentityId>,
    pub score: u32,
    pub last_accessed_at_ns: Option<i64>,
}
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub enum FacetValue {
    Category(FontCategory),
    Script(String),
    License(LicenseKind),
    Foundry(FoundryKey),
    Weight(String),
    Width(u16),
    Feature(FontFeature),
    Root(LibraryRootKey),
    State(FontState),
    MultipleVariants,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
/// 统计分页前的匹配家族，每个值在同一家族中只计一次。
pub struct FacetCount {
    pub value: FacetValue,
    pub display_label: Option<String>,
    pub family_count: usize,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
/// 未解析引用不受文本、Facet 或分页影响，不会被删除。
pub struct QueryResult {
    pub total_matches: usize,
    pub families: Vec<FamilyMatch>,
    pub facet_summary: Vec<FacetCount>,
    pub unresolved_scope_items: Vec<FontIdentityId>,
}
#[derive(Debug, thiserror::Error)]
pub enum QueryError {
    #[error("duplicate family identifier: {0}")]
    DuplicateFamily(FontFamilyId),
    #[error("duplicate or inconsistent face identifier: {0}")]
    InvalidFace(FontFaceId),
    #[error("unknown collection: {0}")]
    CollectionNotFound(CollectionId),
    #[error("smart folder queries cannot contain device-local library roots")]
    NonPortableRootFilter,
    #[error("invalid saved width class: {0}")]
    InvalidSavedWidth(u16),
    #[error("invalid saved weight")]
    InvalidSavedWeight,
}

#[derive(Debug)]
struct Document {
    face: FontFaceId,
    identity: FontIdentityId,
    family: FontFamilyId,
    fields: Vec<(String, u32)>,
    family_text: String,
    category: FontCategory,
    scripts: Vec<String>,
    license: LicenseKind,
    foundry: Option<FoundryKey>,
    foundry_label: Option<String>,
    weight: Option<FontWeight>,
    width: Option<FontWidth>,
    features: Vec<FontFeature>,
    health_states: Vec<FontState>,
    roots: BTreeSet<LibraryRootKey>,
    states: BTreeSet<FontState>,
    recent: Option<i64>,
    multiple_variants: bool,
}
#[derive(Debug)]
pub struct FontQueryIndex {
    documents: Vec<Document>,
    names: BTreeMap<FontFamilyId, (Option<String>, String)>,
    identities: BTreeSet<FontIdentityId>,
    favorites: BTreeSet<FontIdentityId>,
    recent: BTreeMap<FontIdentityId, i64>,
    collections: BTreeMap<CollectionId, BTreeSet<FontIdentityId>>,
    health: CatalogHealth,
}
impl FontQueryIndex {
    pub fn build(catalog: &Catalog, state: &LibraryStateSnapshot) -> Result<Self, QueryError> {
        let health = analyze_catalog(catalog);
        let by_identity: BTreeMap<_, _> = health
            .identities
            .iter()
            .map(|h| (h.identity_id, h))
            .collect();
        let mut index = Self {
            documents: Vec::new(),
            names: BTreeMap::new(),
            identities: BTreeSet::new(),
            favorites: BTreeSet::new(),
            recent: BTreeMap::new(),
            collections: BTreeMap::new(),
            health: health.clone(),
        };
        let mut face_ids = BTreeSet::new();
        for family in &catalog.families {
            let multiple_variants = family
                .faces
                .iter()
                .map(|face| face.identity_id)
                .collect::<BTreeSet<_>>()
                .len()
                > 1;
            let family_text = normalize_search(family.display_name.as_deref().unwrap_or_default());
            if index
                .names
                .insert(
                    family.id,
                    (family.display_name.clone(), family_text.clone()),
                )
                .is_some()
            {
                return Err(QueryError::DuplicateFamily(family.id));
            }
            for face in &family.faces {
                if face.family_id != family.id || !face_ids.insert(face.id) {
                    return Err(QueryError::InvalidFace(face.id));
                }
                index.identities.insert(face.identity_id);
                let m = &face.metadata;
                let e = &m.enrichment;
                let mut fields = Vec::new();
                let mut add = |text: &str, score| {
                    let text = normalize_search(text);
                    if !text.is_empty() {
                        fields.push((text, score));
                    }
                };
                add(&family_text, 900);
                for text in [
                    m.family_name.as_deref(),
                    m.typographic_family_name.as_deref(),
                    m.legacy_family_name.as_deref(),
                ]
                .into_iter()
                .flatten()
                {
                    add(text, 900);
                }
                for text in [m.postscript_name.as_deref(), m.full_name.as_deref()]
                    .into_iter()
                    .flatten()
                {
                    add(text, 650);
                }
                if let Some(text) = &m.subfamily_name {
                    add(text, 500);
                }
                for name in &m.localized_names {
                    let weight = match name.kind {
                        NameKind::Family | NameKind::TypographicFamily | NameKind::WwsFamily => 450,
                        NameKind::Subfamily
                        | NameKind::TypographicSubfamily
                        | NameKind::WwsSubfamily => 400,
                        NameKind::FullName | NameKind::PostScriptName => 600,
                        NameKind::Other(8 | 9) => 300,
                        NameKind::Other(10 | 13) => 100,
                        _ => continue,
                    };
                    add(&name.value, weight);
                }
                for text in [
                    &e.foundry.manufacturer,
                    &e.foundry.designer,
                    &e.foundry.vendor_id,
                ]
                .into_iter()
                .flatten()
                {
                    add(text, 300);
                }
                for source in &face.sources {
                    if let Some(base) = source.path().file_name() {
                        add(&base.to_string_lossy(), 200);
                    }
                }
                for text in [&e.description, &e.license.description]
                    .into_iter()
                    .flatten()
                {
                    add(text, 100);
                }
                add(
                    match e.license.detected_kind {
                        LicenseKind::SilOpenFontLicense => "OFL SIL Open Font License",
                        LicenseKind::Apache2 => "Apache2 Apache License 2.0",
                        LicenseKind::Mit => "MIT License",
                        LicenseKind::Custom => "Custom",
                        LicenseKind::Unknown => "Unknown",
                    },
                    250,
                );
                fields.sort();
                fields.dedup();
                let mut features = Vec::new();
                if !m.variable_axes.is_empty() {
                    features.push(FontFeature::Variable);
                }
                match m.style {
                    FontStyle::Italic => features.push(FontFeature::Italic),
                    FontStyle::Oblique { .. } => features.push(FontFeature::Oblique),
                    _ => {}
                }
                if e.monospace {
                    features.push(FontFeature::Monospace);
                }
                if e.color {
                    features.push(FontFeature::Color);
                }
                features.extend(e.feature_tags.iter().cloned().map(FontFeature::OpenType));
                features.sort();
                features.dedup();
                let mut health_states = Vec::new();
                if face.sources.len() > 1 {
                    health_states.push(FontState::DuplicateSources);
                }
                if let Some(h) = by_identity.get(&face.identity_id) {
                    if h.revision_ids.len() > 1 {
                        health_states.push(FontState::MultipleRevisions);
                    }
                    if !h.conflicts.is_empty() {
                        health_states.push(FontState::MetadataConflict);
                    }
                }
                index.documents.push(Document {
                    face: face.id,
                    identity: face.identity_id,
                    family: family.id,
                    fields,
                    family_text: family_text.clone(),
                    category: e.category,
                    scripts: e.scripts.iter().map(|s| s.script.clone()).collect(),
                    license: e.license.detected_kind,
                    foundry: e.foundry.manufacturer.as_deref().map(FoundryKey::new),
                    foundry_label: e.foundry.manufacturer.clone(),
                    weight: m.weight,
                    width: m.width,
                    features,
                    health_states,
                    roots: BTreeSet::new(),
                    states: BTreeSet::new(),
                    recent: None,
                    multiple_variants,
                });
            }
        }
        index.documents.sort_by_key(|d| d.face);
        index.update_state(state);
        Ok(index)
    }
    pub fn health(&self) -> &CatalogHealth {
        &self.health
    }
    /// 只替换轻量用户状态，不重新规范化字体元数据。
    pub fn update_state(&mut self, state: &LibraryStateSnapshot) {
        self.favorites = state.favorites.iter().copied().collect();
        self.recent.clear();
        for r in &state.recent {
            self.recent
                .entry(r.identity_id)
                .and_modify(|t| *t = (*t).max(r.last_accessed_at_ns))
                .or_insert(r.last_accessed_at_ns);
        }
        self.collections.clear();
        for c in &state.collections {
            self.collections
                .entry(c.collection_id)
                .or_default()
                .extend(c.identities.iter().copied());
        }
        let mut roots: BTreeMap<_, BTreeSet<_>> = BTreeMap::new();
        for root in &state.roots {
            for face in &root.face_ids {
                roots.entry(*face).or_default().insert(root.root_id);
            }
        }
        for d in &mut self.documents {
            d.roots = roots.get(&d.face).cloned().unwrap_or_default();
            d.states = d.health_states.iter().copied().collect();
            if self.favorites.contains(&d.identity) {
                d.states.insert(FontState::Favorite);
            }
            d.recent = self.recent.get(&d.identity).copied();
            if d.recent.is_some() {
                d.states.insert(FontState::Recent);
            }
        }
    }
    pub fn query(&self, query: &FontQuery) -> Result<QueryResult, QueryError> {
        self.query_with_faces(query, None)
    }

    /// 将结果限制在指定字款，同时保持搜索、Facet 和分页语义。
    pub fn query_with_faces(
        &self,
        query: &FontQuery,
        face_ids: Option<&BTreeSet<FontFaceId>>,
    ) -> Result<QueryResult, QueryError> {
        let recent_ids: BTreeSet<_> = self.recent.keys().copied().collect();
        let allowed = match query.scope {
            QueryScope::All => None,
            QueryScope::Favorites => Some(&self.favorites),
            QueryScope::Recent => Some(&recent_ids),
            QueryScope::Collection(id) => Some(
                self.collections
                    .get(&id)
                    .ok_or(QueryError::CollectionNotFound(id))?,
            ),
        };
        let unresolved_scope_items = allowed
            .map(|ids| ids.difference(&self.identities).copied().collect())
            .unwrap_or_default();
        let text = normalize_search(query.text.as_deref().unwrap_or_default());
        let tokens: Vec<_> = text.split_whitespace().collect();
        let mut matches: BTreeMap<FontFamilyId, FamilyMatch> = BTreeMap::new();
        let mut facets: BTreeMap<FacetValue, (BTreeSet<FontFamilyId>, Option<String>)> =
            BTreeMap::new();
        for d in &self.documents {
            if face_ids.is_some_and(|ids| !ids.contains(&d.face))
                || allowed.is_some_and(|ids| !ids.contains(&d.identity))
                || !d.matches(&query.facets)
            {
                continue;
            }
            let Some(score) = d.score(&text, &tokens) else {
                continue;
            };
            let item = matches.entry(d.family).or_insert_with(|| FamilyMatch {
                family_id: d.family,
                display_name: self.names[&d.family].0.clone(),
                matched_face_ids: Vec::new(),
                matched_identity_ids: Vec::new(),
                score: 0,
                last_accessed_at_ns: None,
            });
            item.matched_face_ids.push(d.face);
            item.matched_identity_ids.push(d.identity);
            item.score = item.score.max(score);
            item.last_accessed_at_ns = item.last_accessed_at_ns.max(d.recent);
            for value in d.facet_values() {
                let label = if matches!(value, FacetValue::Foundry(_)) {
                    d.foundry_label.clone()
                } else {
                    None
                };
                let entry = facets.entry(value).or_default();
                entry.0.insert(d.family);
                if let Some(label) = label {
                    if entry.1.as_ref().is_none_or(|old| label < *old) {
                        entry.1 = Some(label);
                    }
                }
            }
        }
        let mut families: Vec<_> = matches.into_values().collect();
        for f in &mut families {
            f.matched_face_ids.sort();
            f.matched_identity_ids.sort();
            f.matched_identity_ids.dedup();
        }
        let sort = match query.sort {
            QuerySort::Auto if query.scope == QueryScope::Recent => QuerySort::Recent,
            QuerySort::Auto if !tokens.is_empty() => QuerySort::Relevance,
            QuerySort::Auto => QuerySort::Name,
            sort => sort,
        };
        families.sort_by(|a, b| {
            let primary = match sort {
                QuerySort::Recent => b.last_accessed_at_ns.cmp(&a.last_accessed_at_ns),
                QuerySort::Relevance => b.score.cmp(&a.score),
                _ => std::cmp::Ordering::Equal,
            };
            primary
                .then_with(|| self.names[&a.family_id].1.cmp(&self.names[&b.family_id].1))
                .then(a.family_id.cmp(&b.family_id))
        });
        Ok(QueryResult {
            total_matches: families.len(),
            families: families
                .into_iter()
                .skip(query.offset)
                .take(query.limit.unwrap_or(usize::MAX))
                .collect(),
            facet_summary: facets
                .into_iter()
                .map(|(value, (families, display_label))| FacetCount {
                    value,
                    display_label,
                    family_count: families.len(),
                })
                .collect(),
            unresolved_scope_items,
        })
    }
}
fn one_of<T: PartialEq>(filter: &[T], value: Option<&T>) -> bool {
    filter.is_empty() || value.is_some_and(|v| filter.contains(v))
}
fn intersects<T: PartialEq>(filter: &[T], values: &[T]) -> bool {
    filter.is_empty() || filter.iter().any(|v| values.contains(v))
}
impl Document {
    fn matches(&self, f: &FacetFilter) -> bool {
        one_of(&f.categories, Some(&self.category))
            && intersects(&f.scripts, &self.scripts)
            && one_of(&f.licenses, Some(&self.license))
            && one_of(&f.foundries, self.foundry.as_ref())
            && one_of(&f.weights, self.weight.as_ref())
            && one_of(&f.widths, self.width.as_ref())
            && intersects(&f.features, &self.features)
            && (f.roots.is_empty() || f.roots.iter().any(|r| self.roots.contains(r)))
            && (f.states.is_empty() || f.states.iter().any(|s| self.states.contains(s)))
            && (!f.multiple_variants || self.multiple_variants)
    }
    fn score(&self, text: &str, tokens: &[&str]) -> Option<u32> {
        if tokens.is_empty() {
            return Some(0);
        }
        let mut score = 0u32;
        for token in tokens {
            let best = self
                .fields
                .iter()
                .filter_map(|(field, base)| {
                    if field == token {
                        Some(base + 30)
                    } else if field.starts_with(token) {
                        Some(base + 20)
                    } else if field.contains(token) {
                        Some(*base)
                    } else {
                        None
                    }
                })
                .max()?;
            score = score.saturating_add(best);
        }
        let bonus = if self.family_text == text {
            100_000
        } else if self.family_text.starts_with(text) {
            80_000
        } else if self.family_text.contains(text) {
            60_000
        } else {
            0
        };
        Some(score.saturating_add(bonus))
    }
    fn facet_values(&self) -> Vec<FacetValue> {
        let mut values = vec![
            FacetValue::Category(self.category),
            FacetValue::License(self.license),
        ];
        values.extend(self.scripts.iter().cloned().map(FacetValue::Script));
        if let Some(key) = &self.foundry {
            values.push(FacetValue::Foundry(key.clone()));
        }
        if let Some(w) = self.weight {
            values.push(FacetValue::Weight(w.to_string()));
        }
        if let Some(w) = self.width {
            values.push(FacetValue::Width(w.class()));
        }
        values.extend(self.features.iter().cloned().map(FacetValue::Feature));
        values.extend(self.roots.iter().copied().map(FacetValue::Root));
        values.extend(self.states.iter().copied().map(FacetValue::State));
        if self.multiple_variants {
            values.push(FacetValue::MultipleVariants);
        }
        values
    }
}
