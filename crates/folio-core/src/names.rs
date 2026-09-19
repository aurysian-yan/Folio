//! 本地化名称：保留原始字符串与语言上下文，按语言优先级选择显示值。
//! 所有名称列表排序去重；未知语言保持未知。

use std::collections::BTreeSet;

use read_fonts::types::NameId;
use read_fonts::{FontRef, TableProvider};
use serde::Serialize;
use skrifa::string::LocalizedString;

/// Name table identifiers Folio tracks.
pub(crate) const TRACKED_NAME_IDS: [NameId; 18] = [
    NameId::new(0),
    NameId::new(7),
    NameId::new(8),
    NameId::new(9),
    NameId::new(10),
    NameId::new(11),
    NameId::new(12),
    NameId::new(13),
    NameId::new(14),
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
    /// 原始语言上下文；未知语言保留原值，不猜测标签。
    pub locale: Option<NameLocale>,
}

/// name 表原始的平台、编码与语言标识。
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub struct NameLocale {
    pub platform_id: u16,
    pub encoding_id: u16,
    pub language_id: u16,
    pub language_tag: Option<String>,
}

impl LocalizedName {
    #[cfg(test)]
    fn new(kind: NameKind, language: Option<String>, value: String) -> Self {
        Self {
            kind,
            language,
            value,
            locale: None,
        }
    }
}

/// 收集已追踪的名称，并按种类、语言、原值和原始语言上下文排序。
pub(crate) fn collect_localized_names(font: &FontRef<'_>) -> Vec<LocalizedName> {
    collect_names(font, |id| TRACKED_NAME_IDS.contains(&id))
}

/// Collects localized names for a single arbitrary name id (used for axes).
pub(crate) fn collect_names_for_id(font: &FontRef<'_>, id: NameId) -> Vec<LocalizedName> {
    collect_names(font, |candidate| candidate == id)
}

fn collect_names(font: &FontRef<'_>, include: impl Fn(NameId) -> bool) -> Vec<LocalizedName> {
    let Ok(table) = font.name() else {
        return Vec::new();
    };
    let mut names = BTreeSet::new();
    for record in table.name_record().iter().filter(|r| include(r.name_id())) {
        let string = LocalizedString::new(&table, record);
        let value = string.to_string();
        if value.trim().is_empty() {
            continue;
        }
        let tagged = table.version() == 1 && record.language_id() >= 0x8000;
        let language_tag = if tagged {
            table
                .lang_tag_record()
                .and_then(|tags| tags.get((record.language_id() - 0x8000) as usize))
                .and_then(|tag| tag.lang_tag(table.string_data()).ok())
                .map(|tag| tag.to_string())
        } else {
            None
        };
        // 上游将 Mac 与 Windows 的映射放在同一张表中，必须先区分平台。
        let language = if tagged {
            language_tag.as_deref()
        } else if matches!(
            (record.platform_id(), record.language_id()),
            (1, 0..=151) | (3, 0x0400..=0x7fff)
        ) {
            string.language()
        } else {
            None
        };
        names.insert(LocalizedName {
            kind: NameKind::from_id(record.name_id()),
            language: language
                .filter(|tag| supported_language_tag(tag))
                .map(str::to_owned),
            value,
            locale: Some(NameLocale {
                platform_id: record.platform_id(),
                encoding_id: record.encoding_id(),
                language_id: record.language_id(),
                language_tag,
            }),
        });
    }
    names.into_iter().collect()
}

/// 保守接受语言、脚本、地区和变体；其他形式保留原始标签。
fn supported_language_tag(tag: &str) -> bool {
    let mut parts = tag.split('-').peekable();
    let Some(language) = parts.next() else {
        return false;
    };
    if !(2..=8).contains(&language.len()) || !language.bytes().all(|b| b.is_ascii_alphabetic()) {
        return false;
    }
    if parts
        .peek()
        .is_some_and(|part| part.len() == 4 && part.bytes().all(|b| b.is_ascii_alphabetic()))
    {
        parts.next();
    }
    if parts.peek().is_some_and(|part| {
        (part.len() == 2 && part.bytes().all(|b| b.is_ascii_alphabetic()))
            || (part.len() == 3 && part.bytes().all(|b| b.is_ascii_digit()))
    }) {
        parts.next();
    }
    let mut variants = BTreeSet::new();
    parts.all(|part| {
        ((5..=8).contains(&part.len()) || (part.len() == 4 && part.as_bytes()[0].is_ascii_digit()))
            && part.bytes().all(|b| b.is_ascii_alphanumeric())
            && variants.insert(part.to_ascii_lowercase())
    })
}

/// Returns the preferred value for a kind, or `None` when absent.
///
/// 优先 en-US、en、未知语言，再按名称全序打破同级排序。
pub(crate) fn preferred_value(names: &[LocalizedName], kind: NameKind) -> Option<String> {
    names
        .iter()
        .filter(|name| name.kind == kind)
        .min_by_key(|name| (language_rank(name.language.as_deref()), *name))
        .map(|name| name.value.trim().to_owned())
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
