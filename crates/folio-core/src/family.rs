//! 全局家族聚合：按名称元数据分组，保留来源，使用有序映射和集合。
//! 名称不足时按逻辑身份隔离，不根据路径或样式后缀猜测归属。

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use unicode_normalization::UnicodeNormalization;

use crate::attributes::FontStyle;
use crate::classification::classify_names;
use crate::face::{FaceMetadata, FontFace, ParsedFace};
use crate::identity::normalize_name;
use crate::ids::FontFamilyId;
use crate::names::{preferred_value, LocalizedName, NameKind};
use crate::source::FontSource;

/// A group of faces that belong to the same typographic family.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct FontFamily {
    /// Stable family identifier.
    pub id: FontFamilyId,
    /// Preferred display name of the family.
    pub display_name: Option<String>,
    /// Union of family localized names across all faces, sorted.
    pub localized_names: Vec<LocalizedName>,
    /// Faces of this family, sorted deterministically.
    pub faces: Vec<FontFace>,
}

/// Builds the canonical grouping key of a face.
pub(crate) fn family_key(metadata: &FaceMetadata) -> String {
    if let Some(name) = metadata.family_name.as_deref() {
        if let Some(name) =
            normalize_name(Some(name)).map(|name| name.to_lowercase().nfc().collect::<String>())
        {
            return format!("family\u{0}{name}");
        }
    }
    if let Some(name) = metadata.postscript_name.as_deref() {
        let name = name.trim();
        if !name.is_empty() {
            return format!("ps\u{0}{name}");
        }
    }
    if let Some(name) = metadata.full_name.as_deref() {
        let name = name.trim();
        if !name.is_empty() {
            return format!("full\u{0}{name}");
        }
    }
    "unnamed".to_owned()
}

/// Preferred display name for a family, derived from the preferred family
/// name of a representative face.
pub(crate) fn family_display_name(metadata: &FaceMetadata) -> Option<String> {
    metadata
        .family_name
        .clone()
        .or_else(|| preferred_value(&metadata.localized_names, NameKind::Family))
}

/// Merges parsed faces into catalog families.
///
/// Input faces are the deduplicated set of catalog faces, each with its
/// full source list. Output families and their faces are sorted
/// deterministically.
pub(crate) fn build_families(faces: Vec<(ParsedFace, Vec<FontSource>)>) -> Vec<FontFamily> {
    let mut groups: BTreeMap<FontFamilyId, FamilyBuilder> = BTreeMap::new();
    for (parsed, sources) in faces {
        let key = family_key(&parsed.metadata);
        let key = if key == "unnamed" {
            format!("unnamed\0{}", parsed.identity.id)
        } else {
            key
        };
        let family_id = FontFamilyId::from_family_key(&key);
        let builder = groups.entry(family_id).or_insert_with(|| FamilyBuilder {
            id: family_id,
            display_name: family_display_name(&parsed.metadata),
            localized_names: BTreeSet::new(),
            faces: Vec::new(),
        });
        for name in &parsed.metadata.localized_names {
            if matches!(
                name.kind,
                NameKind::Family | NameKind::TypographicFamily | NameKind::WwsFamily
            ) {
                builder.localized_names.insert(name.clone());
            }
        }
        builder.faces.push(FontFace {
            id: parsed.id,
            identity_id: parsed.identity.id,
            revision_id: parsed.revision.id,
            family_id,
            format: parsed.format,
            classification: classify_names(
                parsed.metadata.postscript_name.as_deref(),
                parsed.metadata.family_name.as_deref(),
            ),
            metadata: parsed.metadata,
            sources,
        });
    }

    let mut families: Vec<FontFamily> = groups
        .into_values()
        .map(|mut builder| {
            builder.faces.sort_by(face_order);
            FontFamily {
                id: builder.id,
                display_name: builder.display_name,
                localized_names: builder.localized_names.into_iter().collect(),
                faces: builder.faces,
            }
        })
        .collect();

    families.sort_by(|a, b| {
        let a_name = a.display_name.as_deref().unwrap_or("").to_lowercase();
        let b_name = b.display_name.as_deref().unwrap_or("").to_lowercase();
        a_name.cmp(&b_name).then_with(|| a.id.cmp(&b.id))
    });
    families
}

struct FamilyBuilder {
    id: FontFamilyId,
    display_name: Option<String>,
    localized_names: BTreeSet<LocalizedName>,
    faces: Vec<FontFace>,
}

fn face_order(a: &FontFace, b: &FontFace) -> std::cmp::Ordering {
    style_rank(a.metadata.style)
        .cmp(&style_rank(b.metadata.style))
        .then_with(|| {
            let a_weight = a.metadata.weight.map(|w| w.value()).unwrap_or(400.0);
            let b_weight = b.metadata.weight.map(|w| w.value()).unwrap_or(400.0);
            a_weight.total_cmp(&b_weight)
        })
        .then_with(|| {
            let a_name = a.display_subfamily().to_lowercase();
            let b_name = b.display_subfamily().to_lowercase();
            a_name.cmp(&b_name)
        })
        .then_with(|| a.id.cmp(&b.id))
}

fn style_rank(style: FontStyle) -> u8 {
    match style {
        FontStyle::Normal => 0,
        FontStyle::Oblique { .. } => 1,
        FontStyle::Italic => 2,
    }
}

/// Sorts sources and removes duplicates. Used by the scan pipeline.
pub(crate) fn normalize_sources(mut sources: Vec<FontSource>) -> Vec<FontSource> {
    sources.sort();
    sources.dedup();
    sources
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metadata(family: Option<&str>, postscript: Option<&str>) -> FaceMetadata {
        FaceMetadata {
            family_name: family.map(str::to_owned),
            postscript_name: postscript.map(str::to_owned),
            ..Default::default()
        }
    }

    #[test]
    fn typographic_family_is_preferred() {
        let key = family_key(&metadata(Some("Inter"), Some("Inter-Regular")));
        assert_eq!(key, "family\u{0}inter");
    }

    #[test]
    fn faces_without_family_do_not_merge() {
        let a = family_key(&metadata(None, Some("Alpha-Regular")));
        let b = family_key(&metadata(None, Some("Beta-Regular")));
        assert_ne!(a, b);
    }

    #[test]
    fn family_key_is_trimmed() {
        let a = family_key(&metadata(Some("  Inter "), None));
        let b = family_key(&metadata(Some("Inter"), None));
        assert_eq!(a, b);
    }

    #[test]
    fn family_id_is_stable_for_same_key() {
        let a = FontFamilyId::from_family_key("family\u{0}Inter");
        let b = FontFamilyId::from_family_key("family\u{0}Inter");
        assert_eq!(a, b);
    }

    #[test]
    fn family_id_differs_across_keys() {
        let a = FontFamilyId::from_family_key("family\u{0}Inter");
        let b = FontFamilyId::from_family_key("family\u{0}Roboto");
        assert_ne!(a, b);
    }
}
