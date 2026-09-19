//! 从字体声明与实际字符映射提取可缓存的检索元数据。

use crate::{LocalizedName, NameKind};
use read_fonts::{FontRef, TableProvider};
use serde::{Deserialize, Serialize};
use skrifa::MetadataProvider;
use std::collections::{BTreeMap, BTreeSet};
use unicode_script::UnicodeScript;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum LicenseKind {
    SilOpenFontLicense,
    Apache2,
    Mit,
    Custom,
    #[default]
    Unknown,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LicenseInfo {
    pub description: Option<String>,
    pub url: Option<String>,
    pub detected_kind: LicenseKind,
}

impl LicenseInfo {
    /// 仅匹配完整许可标题、标准链接或 MIT 授权段落。
    pub fn detect(description: Option<String>, url: Option<String>) -> Self {
        let text = crate::normalize_search(description.as_deref().unwrap_or_default());
        let url_key = url.as_deref().unwrap_or_default().trim().to_lowercase();
        let url_key = url_key
            .strip_prefix("https://")
            .or_else(|| url_key.strip_prefix("http://"))
            .unwrap_or(&url_key)
            .trim_end_matches('/');
        let mut kinds = BTreeSet::new();
        if text.contains("sil open font license")
            || matches!(
                url_key,
                "openfontlicense.org"
                    | "openfontlicense.org/open-font-license-official-text"
                    | "scripts.sil.org/ofl"
                    | "scripts.sil.org/cms/scripts/page.php?site_id=nrsi&id=ofl"
            )
        {
            kinds.insert(LicenseKind::SilOpenFontLicense);
        }
        if text.contains("apache license, version 2.0")
            || text.contains("apache license version 2.0")
            || matches!(
                url_key,
                "www.apache.org/licenses/license-2.0"
                    | "www.apache.org/licenses/license-2.0.txt"
                    | "apache.org/licenses/license-2.0"
            )
        {
            kinds.insert(LicenseKind::Apache2);
        }
        if text == "mit license"
            || (text.contains(
                "permission is hereby granted, free of charge, to any person obtaining a copy",
            ) && text.contains("the software is provided")
                && text.contains("without warranty"))
            || matches!(url_key, "opensource.org/licenses/mit")
        {
            kinds.insert(LicenseKind::Mit);
        }
        let detected_kind = if kinds.len() == 1 {
            *kinds.first().unwrap()
        } else if description.is_some() || url.is_some() {
            LicenseKind::Custom
        } else {
            LicenseKind::Unknown
        };
        Self {
            description,
            url,
            detected_kind,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum EmbeddingUsage {
    Installable,
    Restricted,
    PreviewAndPrint,
    Editable,
    Invalid,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EmbeddingPermissions {
    pub raw_flags: u16,
    pub os2_version: u16,
    pub usage: EmbeddingUsage,
    pub no_subsetting: bool,
    pub bitmap_only: bool,
}
impl EmbeddingPermissions {
    pub fn from_flags(raw_flags: u16, os2_version: u16) -> Self {
        let bits = raw_flags & 0xf;
        let usage = match bits {
            0 => EmbeddingUsage::Installable,
            2 => EmbeddingUsage::Restricted,
            4 => EmbeddingUsage::PreviewAndPrint,
            8 => EmbeddingUsage::Editable,
            _ if os2_version <= 2 && bits & 1 == 0 => {
                if bits & 8 != 0 {
                    EmbeddingUsage::Editable
                } else if bits & 4 != 0 {
                    EmbeddingUsage::PreviewAndPrint
                } else {
                    EmbeddingUsage::Invalid
                }
            }
            _ => EmbeddingUsage::Invalid,
        };
        Self {
            raw_flags,
            os2_version,
            usage,
            no_subsetting: os2_version >= 2 && raw_flags & 0x100 != 0,
            bitmap_only: os2_version >= 2 && raw_flags & 0x200 != 0,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FoundryInfo {
    pub manufacturer: Option<String>,
    pub designer: Option<String>,
    pub vendor_id: Option<String>,
    pub vendor_url: Option<String>,
    pub designer_url: Option<String>,
}

/// 技术脚本名称，不构成自然语言支持保证。
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ScriptCoverage {
    pub script: String,
    pub codepoint_count: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum FontCategory {
    SansSerif,
    Serif,
    Monospace,
    Script,
    Decorative,
    Symbol,
    #[default]
    Unknown,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FontEnrichment {
    pub copyright: Option<String>,
    pub trademark: Option<String>,
    pub description: Option<String>,
    pub license: LicenseInfo,
    pub foundry: FoundryInfo,
    pub embedding: Option<EmbeddingPermissions>,
    pub scripts: Vec<ScriptCoverage>,
    pub declared_unicode_ranges: Option<[u32; 4]>,
    pub declared_code_page_ranges: Option<[u32; 2]>,
    pub panose: Option<[u8; 10]>,
    pub family_class: Option<i16>,
    pub category: FontCategory,
    pub monospace: bool,
    pub color: bool,
    pub feature_tags: Vec<String>,
}

pub(crate) fn read_enrichment(font: &FontRef<'_>, names: &[LocalizedName]) -> FontEnrichment {
    let preferred = |id| crate::names::preferred_value(names, NameKind::Other(id));
    let os2 = font.os2().ok();
    let panose: Option<[u8; 10]> = os2.as_ref().and_then(|o| o.panose_10().try_into().ok());
    let fixed = font.post().is_ok_and(|p| p.is_fixed_pitch() != 0)
        || panose.is_some_and(|p| p[0] == 2 && p[3] == 9);
    let class = os2.as_ref().map(|o| o.s_family_class());
    let category = category(panose, class, fixed);
    let mut scripts = BTreeMap::<String, u32>::new();
    for (codepoint, glyph) in font.charmap().mappings() {
        if glyph.to_u32() == 0 {
            continue;
        }
        if let Some(c) = char::from_u32(codepoint) {
            let script = c.script();
            if !matches!(
                script,
                unicode_script::Script::Common
                    | unicode_script::Script::Inherited
                    | unicode_script::Script::Unknown
            ) {
                *scripts.entry(script.full_name().to_owned()).or_default() += 1;
            }
        }
    }
    let mut tags = BTreeSet::new();
    if let Ok(list) = font.gsub().and_then(|t| t.feature_list()) {
        for record in list.feature_records() {
            tags.insert(record.feature_tag().to_string());
        }
    }
    if let Ok(list) = font.gpos().and_then(|t| t.feature_list()) {
        for record in list.feature_records() {
            tags.insert(record.feature_tag().to_string());
        }
    }
    FontEnrichment {
        copyright: preferred(0),
        trademark: preferred(7),
        description: preferred(10),
        license: LicenseInfo::detect(preferred(13), preferred(14)),
        foundry: FoundryInfo {
            manufacturer: preferred(8),
            designer: preferred(9),
            vendor_url: preferred(11),
            designer_url: preferred(12),
            vendor_id: os2.as_ref().map(|o| o.ach_vend_id().to_string()),
        },
        embedding: os2
            .as_ref()
            .map(|o| EmbeddingPermissions::from_flags(o.fs_type(), o.version())),
        scripts: scripts
            .into_iter()
            .map(|(script, codepoint_count)| ScriptCoverage {
                script,
                codepoint_count,
            })
            .collect(),
        declared_unicode_ranges: os2.as_ref().map(|o| {
            [
                o.ul_unicode_range_1(),
                o.ul_unicode_range_2(),
                o.ul_unicode_range_3(),
                o.ul_unicode_range_4(),
            ]
        }),
        declared_code_page_ranges: os2
            .as_ref()
            .and_then(|o| Some([o.ul_code_page_range_1()?, o.ul_code_page_range_2()?])),
        panose,
        family_class: class,
        category,
        monospace: fixed,
        color: font.colr().is_ok()
            || font.svg().is_ok()
            || font.cbdt().is_ok()
            || font.sbix().is_ok(),
        feature_tags: tags.into_iter().collect(),
    }
}

fn category(panose: Option<[u8; 10]>, class: Option<i16>, fixed: bool) -> FontCategory {
    if fixed {
        return FontCategory::Monospace;
    }
    if let Some(p) = panose {
        match (p[0], p[1]) {
            (2, 2..=10) => return FontCategory::Serif,
            (2, 11..=15) => return FontCategory::SansSerif,
            (3, _) => return FontCategory::Script,
            (4, _) => return FontCategory::Decorative,
            (5, _) => return FontCategory::Symbol,
            _ => {}
        }
    }
    match class.map(|c| (c as u16) >> 8) {
        Some(1..=5 | 7) => FontCategory::Serif,
        Some(8) => FontCategory::SansSerif,
        Some(9) => FontCategory::Decorative,
        Some(10) => FontCategory::Script,
        Some(12) => FontCategory::Symbol,
        _ => FontCategory::Unknown,
    }
}
