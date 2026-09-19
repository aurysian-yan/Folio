//! 元数据必须经过合法字体二进制解析，不能只验证 DTO 构造。
mod common;
use common::{name_table, read_fixture, replace_table};
use folio_core::*;
use read_fonts::FontRef;
use std::path::Path;

fn parse(bytes: &[u8]) -> FaceMetadata {
    parse_font_data(Path::new("generated.ttf"), bytes, bytes.len() as u64, None)
        .unwrap()
        .faces
        .remove(0)
        .metadata
}
fn table(bytes: &[u8], tag: &[u8; 4]) -> Vec<u8> {
    FontRef::new(bytes)
        .unwrap()
        .table_data(read_fonts::types::Tag::new(tag))
        .unwrap()
        .as_bytes()
        .to_vec()
}
fn base() -> Vec<u8> {
    read_fixture("Lato-Regular.ttf")
}
fn with_os2(mut change: impl FnMut(&mut Vec<u8>)) -> Vec<u8> {
    let b = base();
    let mut t = table(&b, b"OS/2");
    change(&mut t);
    replace_table(&b, b"OS/2", Some(&t))
}

#[test]
fn localized_extended_names_and_preferred_values_are_preserved() {
    let records = [
        (0, "Copyright Example"),
        (7, "Example Trademark"),
        (8, "Example Foundry"),
        (9, "Example Designer"),
        (10, "Example Description"),
        (11, "https://example.org/vendor"),
        (12, "https://example.org/designer"),
        (13, "SIL Open Font License, Version 1.1"),
        (14, "https://openfontlicense.org"),
    ];
    let mut names = vec![
        (3, 1, 0x409, 1, "Example"),
        (3, 1, 0x409, 2, "Regular"),
        (3, 1, 0x409, 6, "Example-Regular"),
    ];
    for (id, text) in records {
        names.push((3, 1, 0x409, id, text));
        names.push((3, 1, 0x804, id, "中文元数据"));
    }
    let m = parse(&replace_table(
        &base(),
        b"name",
        Some(&name_table(&names, &[])),
    ));
    for (id, text) in records {
        assert!(m
            .localized_names
            .iter()
            .any(|n| n.kind == NameKind::Other(id) && n.value == text));
        assert!(m
            .localized_names
            .iter()
            .any(|n| n.kind == NameKind::Other(id) && n.value == "中文元数据"));
    }
    let e = m.enrichment;
    assert_eq!(e.copyright.as_deref(), Some("Copyright Example"));
    assert_eq!(e.trademark.as_deref(), Some("Example Trademark"));
    assert_eq!(e.description.as_deref(), Some("Example Description"));
    assert_eq!(e.foundry.manufacturer.as_deref(), Some("Example Foundry"));
    assert_eq!(e.foundry.designer.as_deref(), Some("Example Designer"));
    assert_eq!(
        e.foundry.vendor_url.as_deref(),
        Some("https://example.org/vendor")
    );
    assert_eq!(
        e.foundry.designer_url.as_deref(),
        Some("https://example.org/designer")
    );
    assert_eq!(e.license.detected_kind, LicenseKind::SilOpenFontLicense);
}
#[test]
fn license_patterns_are_conservative_and_independent_of_embedding() {
    for (description, url, kind) in [
        (None, None, LicenseKind::Unknown),
        (Some("free for evaluation"), None, LicenseKind::Custom),
        (Some("MIT design office"), None, LicenseKind::Custom),
        (
            Some("SIL Open Font License, Version 1.1"),
            None,
            LicenseKind::SilOpenFontLicense,
        ),
        (
            Some("Apache License, Version 2.0"),
            None,
            LicenseKind::Apache2,
        ),
        (Some("MIT License"), None, LicenseKind::Mit),
        (
            None,
            Some("https://opensource.org/licenses/MIT"),
            LicenseKind::Mit,
        ),
        (
            None,
            Some("https://evil.example/?url=https://opensource.org/licenses/MIT"),
            LicenseKind::Custom,
        ),
        (
            Some("SIL Open Font License and Apache License, Version 2.0"),
            None,
            LicenseKind::Custom,
        ),
    ] {
        assert_eq!(
            LicenseInfo::detect(description.map(str::to_owned), url.map(str::to_owned))
                .detected_kind,
            kind
        );
    }
    let b = with_os2(|t| t[8..10].copy_from_slice(&2u16.to_be_bytes()));
    let e = parse(&b).enrichment;
    assert_eq!(e.embedding.unwrap().usage, EmbeddingUsage::Restricted);
    assert_eq!(e.license.detected_kind, LicenseKind::SilOpenFontLicense);
}
#[test]
fn embedding_flags_follow_table_version_and_preserve_raw_bits() {
    for (flags, usage) in [
        (0, EmbeddingUsage::Installable),
        (2, EmbeddingUsage::Restricted),
        (4, EmbeddingUsage::PreviewAndPrint),
        (8, EmbeddingUsage::Editable),
        (12, EmbeddingUsage::Invalid),
        (1, EmbeddingUsage::Invalid),
    ] {
        let m = parse(&with_os2(|t| {
            t[..2].copy_from_slice(&3u16.to_be_bytes());
            t[8..10].copy_from_slice(&(flags | 0x300u16).to_be_bytes());
        }));
        let e = m.enrichment.embedding.unwrap();
        assert_eq!(e.usage, usage);
        assert_eq!(e.raw_flags, flags | 0x300);
        assert!(e.no_subsetting && e.bitmap_only);
    }
    assert_eq!(
        EmbeddingPermissions::from_flags(12, 2).usage,
        EmbeddingUsage::Editable
    );
    assert!(!EmbeddingPermissions::from_flags(0x300, 1).no_subsetting);
}
#[test]
fn os2_declared_ranges_vendor_and_category_are_parsed() {
    let b = with_os2(|t| {
        t[58..62].copy_from_slice(b"TEST");
        t[42..46].copy_from_slice(&0x12345678u32.to_be_bytes());
        t[32..42].fill(0);
        t[32] = 2;
        t[33] = 11;
    });
    let e = parse(&b).enrichment;
    assert_eq!(e.foundry.vendor_id.as_deref(), Some("TEST"));
    assert_eq!(e.declared_unicode_ranges.unwrap()[0], 0x12345678);
    assert!(e.declared_code_page_ranges.is_some());
    assert_eq!(e.category, FontCategory::SansSerif);
}
#[test]
fn categories_use_structured_signals_with_unknown_fallback() {
    for (family, serif, expected) in [
        (2, 2, FontCategory::Serif),
        (2, 11, FontCategory::SansSerif),
        (3, 0, FontCategory::Script),
        (4, 0, FontCategory::Decorative),
        (5, 0, FontCategory::Symbol),
        (0, 0, FontCategory::Unknown),
    ] {
        let b = with_os2(|t| {
            t[30..42].fill(0);
            t[32] = family;
            t[33] = serif;
        });
        assert_eq!(parse(&b).enrichment.category, expected);
    }
    let b = base();
    let mut p = table(&b, b"post");
    p[12..16].copy_from_slice(&1u32.to_be_bytes());
    let e = parse(&replace_table(&b, b"post", Some(&p))).enrichment;
    assert!(e.monospace);
    assert_eq!(e.category, FontCategory::Monospace);
}
#[test]
fn cmap_observation_covers_common_scripts_and_ignores_missing_glyphs() {
    let chars = ['A', 'Α', 'А', 'א', 'ا', 'क', 'ก', 'あ', 'ア', '一', '가'];
    let mut groups: Vec<_> = chars.iter().map(|c| (*c as u32, 1u32)).collect();
    groups.push((0x10300, 0));
    groups.sort();
    let mut cmap = vec![0, 0, 0, 1, 0, 3, 0, 10, 0, 0, 0, 12, 0, 12, 0, 0];
    cmap.extend_from_slice(&(16u32 + groups.len() as u32 * 12).to_be_bytes());
    cmap.extend_from_slice(&0u32.to_be_bytes());
    cmap.extend_from_slice(&(groups.len() as u32).to_be_bytes());
    for (cp, gid) in groups {
        for n in [cp, cp, gid] {
            cmap.extend_from_slice(&n.to_be_bytes());
        }
    }
    let e = parse(&replace_table(&base(), b"cmap", Some(&cmap))).enrichment;
    let observed: Vec<_> = e.scripts.iter().map(|s| s.script.as_str()).collect();
    for expected in [
        "Latin",
        "Greek",
        "Cyrillic",
        "Hebrew",
        "Arabic",
        "Devanagari",
        "Thai",
        "Hiragana",
        "Katakana",
        "Han",
        "Hangul",
    ] {
        assert!(observed.contains(&expected), "{expected}: {observed:?}");
    }
    assert_eq!(observed.len(), 11);
    assert!(e.scripts.iter().all(|s| s.codepoint_count == 1));
}
#[test]
fn gsub_gpos_feature_tags_are_sorted_deduplicated_and_cached_metadata_is_owned() {
    let e = parse(&base()).enrichment;
    assert!(e.feature_tags.contains(&"liga".to_owned()));
    assert!(e.feature_tags.contains(&"kern".to_owned()));
    assert!(e.feature_tags.windows(2).all(|w| w[0] < w[1]));
    let b = replace_table(&replace_table(&base(), b"GSUB", None), b"GPOS", None);
    assert!(parse(&b).enrichment.feature_tags.is_empty());
}
#[test]
fn metadata_name_language_does_not_imply_script_support() {
    let b = common::with_names(
        &[
            (3, 1, 0x804, 1, "中文名称"),
            (3, 1, 0x409, 6, "Example-Regular"),
        ],
        &[],
    );
    assert!(!parse(&b)
        .enrichment
        .scripts
        .iter()
        .any(|s| s.script == "Han"));
}
