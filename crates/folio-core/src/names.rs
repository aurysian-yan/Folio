//! OpenType `name` table handling.
//!
//! Folio keeps every localized string it can decode, together with a
//! BCP-47 language tag when one can be derived. A single "preferred"
//! value is derived deterministically for display (`en-US`, then `en`,
//! then language-less strings, then the first record in name table
//! order).

use read_fonts::types::NameId;
use read_fonts::FontRef;
use serde::Serialize;
use skrifa::MetadataProvider;

/// Name table identifiers Folio tracks.
pub(crate) const TRACKED_NAME_IDS: [NameId; 9] = [
    NameId::FAMILY_NAME,
    NameId::SUBFAMILY_NAME,
    NameId::FULL_NAME,
    NameId::POSTSCRIPT_NAME,
    NameId::VERSION_STRING,
    NameId::TYPOGRAPHIC_FAMILY_NAME,
    NameId::TYPOGRAPHIC_SUBFAMILY_NAME,
    NameId::WWS_FAMILY_NAME,
    NameId::WWS_SUBFAMILY_NAME,
];

/// Semantic kind of an OpenType name record.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NameKind {
    /// Legacy family name (name ID 1).
    Family,
    /// Legacy subfamily name (name ID 2).
    Subfamily,
    /// Full font name (name ID 4).
    FullName,
    /// PostScript name (name ID 6).
    PostScriptName,
    /// Version string (name ID 5).
    Version,
    /// Typographic family name (name ID 16).
    TypographicFamily,
    /// Typographic subfamily name (name ID 17).
    TypographicSubfamily,
    /// WWS family name (name ID 21).
    WwsFamily,
    /// WWS subfamily name (name ID 22).
    WwsSubfamily,
    /// Any other name identifier.
    Other(u16),
}

impl NameKind {
    pub(crate) fn from_id(id: NameId) -> Self {
        let raw = id.to_u16();
        if id == NameId::FAMILY_NAME {
            NameKind::Family
        } else if id == NameId::SUBFAMILY_NAME {
            NameKind::Subfamily
        } else if id == NameId::FULL_NAME {
            NameKind::FullName
        } else if id == NameId::POSTSCRIPT_NAME {
            NameKind::PostScriptName
        } else if id == NameId::VERSION_STRING {
            NameKind::Version
        } else if id == NameId::TYPOGRAPHIC_FAMILY_NAME {
            NameKind::TypographicFamily
        } else if id == NameId::TYPOGRAPHIC_SUBFAMILY_NAME {
            NameKind::TypographicSubfamily
        } else if id == NameId::WWS_FAMILY_NAME {
            NameKind::WwsFamily
        } else if id == NameId::WWS_SUBFAMILY_NAME {
            NameKind::WwsSubfamily
        } else {
            NameKind::Other(raw)
        }
    }

    /// Human readable label for diagnostics and CLI output.
    pub fn label(self) -> String {
        match self {
            NameKind::Family => "family".into(),
            NameKind::Subfamily => "subfamily".into(),
            NameKind::FullName => "full name".into(),
            NameKind::PostScriptName => "PostScript name".into(),
            NameKind::Version => "version".into(),
            NameKind::TypographicFamily => "typographic family".into(),
            NameKind::TypographicSubfamily => "typographic subfamily".into(),
            NameKind::WwsFamily => "WWS family".into(),
            NameKind::WwsSubfamily => "WWS subfamily".into(),
            NameKind::Other(id) => format!("name ID {id}"),
        }
    }
}

/// A decoded, localized name string.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub struct LocalizedName {
    /// Semantic kind of the name record.
    pub kind: NameKind,
    /// BCP-47 language tag when it can be derived from the record.
    pub language: Option<String>,
    /// Decoded string value.
    pub value: String,
}

impl LocalizedName {
    pub(crate) fn new(kind: NameKind, language: Option<String>, value: String) -> Self {
        Self {
            kind,
            language,
            value,
        }
    }
}

/// Collects all tracked localized names of a face in name table order.
pub(crate) fn collect_localized_names(font: &FontRef<'_>) -> Vec<LocalizedName> {
    let mut names = Vec::new();
    for id in TRACKED_NAME_IDS {
        for string in font.localized_strings(id) {
            let value = string.to_string();
            let value = value.trim();
            if value.is_empty() {
                continue;
            }
            let candidate = LocalizedName::new(
                NameKind::from_id(id),
                string.language().map(str::to_owned),
                value.to_owned(),
            );
            if !names.contains(&candidate) {
                names.push(candidate);
            }
        }
    }
    names
}

/// Collects localized names for a single arbitrary name id (used for axes).
pub(crate) fn collect_names_for_id(font: &FontRef<'_>, id: NameId) -> Vec<LocalizedName> {
    let mut names = Vec::new();
    for string in font.localized_strings(id) {
        let value = string.to_string();
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        let candidate = LocalizedName::new(
            NameKind::from_id(id),
            string.language().map(str::to_owned),
            value.to_owned(),
        );
        if !names.contains(&candidate) {
            names.push(candidate);
        }
    }
    names
}

/// Returns the preferred value for a kind, or `None` when absent.
///
/// Ranking: `en-US`, then `en`, then language-less records, then the first
/// other record in name table order.
pub(crate) fn preferred_value(names: &[LocalizedName], kind: NameKind) -> Option<String> {
    names
        .iter()
        .filter(|name| name.kind == kind)
        .min_by_key(|name| language_rank(name.language.as_deref()))
        .map(|name| name.value.clone())
}

/// Convenience wrapper returning the preferred value for a raw name id.
pub(crate) fn preferred_value_for_id(names: &[LocalizedName], id: NameId) -> Option<String> {
    preferred_value(names, NameKind::from_id(id))
}

fn language_rank(language: Option<&str>) -> u8 {
    match language {
        Some(tag) if tag.eq_ignore_ascii_case("en-US") => 0,
        Some(tag) if tag.eq_ignore_ascii_case("en") => 1,
        None => 2,
        Some(_) => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn name(language: Option<&str>, value: &str) -> LocalizedName {
        LocalizedName::new(
            NameKind::Family,
            language.map(str::to_owned),
            value.to_owned(),
        )
    }

    #[test]
    fn preferred_ranking() {
        let names = vec![
            name(Some("zh-Hans"), "示例"),
            name(Some("en"), "Example"),
            name(Some("en-US"), "Example US"),
        ];
        assert_eq!(
            preferred_value(&names, NameKind::Family).as_deref(),
            Some("Example US")
        );
    }

    #[test]
    fn preferred_falls_back_to_first_other() {
        let names = vec![name(Some("ja"), "見本"), name(Some("ko"), "견본")];
        assert_eq!(
            preferred_value(&names, NameKind::Family).as_deref(),
            Some("見本")
        );
    }

    #[test]
    fn preferred_prefers_english_over_language_less() {
        let names = vec![name(None, "Bare"), name(Some("en"), "English")];
        assert_eq!(
            preferred_value(&names, NameKind::Family).as_deref(),
            Some("English")
        );
    }

    #[test]
    fn name_kind_maps_back() {
        assert_eq!(NameKind::from_id(NameId::FAMILY_NAME), NameKind::Family);
        assert_eq!(NameKind::from_id(NameId::new(999)), NameKind::Other(999));
    }
}
