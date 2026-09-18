//! Phase 1B 的语义与损坏输入回归测试。

mod common;

use std::path::Path;

use common::{collection, read_fixture, replace_table, with_names, write_in};
use folio_core::{
    parse_font_data, scan_directory, scan_files, FontFormat, IssueKind, NameKind, ScanOptions,
};

fn parse(data: &[u8]) -> folio_core::ParsedFontFile {
    parse_font_data(Path::new("asset"), data, data.len() as u64, None).unwrap()
}

fn named(family: &str, subfamily: &str, ps: &str) -> Vec<u8> {
    with_names(
        &[
            (3, 1, 0x409, 1, family),
            (3, 1, 0x409, 2, subfamily),
            (3, 1, 0x409, 6, ps),
        ],
        &[],
    )
}

#[test]
fn normalized_families_merge_without_erasing_meaningful_differences() {
    let dir = tempfile::tempdir().unwrap();
    for (i, family) in [
        "Café Sans",
        " CAFE\u{301}\u{a0}Sans ",
        "café\u{2003} sans",
        "Cafe Sans",
        "CaféSans",
        "Ｃafé Sans",
    ]
    .iter()
    .enumerate()
    {
        write_in(
            dir.path(),
            &format!("{i}.ttf"),
            &named(family, "Regular", &format!("Face-{i}")),
        );
    }
    let result = scan_directory(dir.path(), &ScanOptions::default()).unwrap();
    assert_eq!(result.catalog.family_count(), 4);
    assert!(result.catalog.families.iter().any(|f| f.faces.len() == 3));
}

#[test]
fn unrelated_nameless_faces_do_not_share_a_family() {
    let dir = tempfile::tempdir().unwrap();
    for name in ["Lato-Regular.ttf", "Lato-Bold.ttf"] {
        write_in(
            dir.path(),
            name,
            &replace_table(&read_fixture(name), b"name", None),
        );
    }
    let result = scan_directory(dir.path(), &ScanOptions::default()).unwrap();
    assert_eq!(result.catalog.family_count(), 2);
    assert_eq!(result.issues.len(), 2);
    assert!(result
        .issues
        .iter()
        .all(|issue| issue.kind == IssueKind::MetadataProblem));
}

#[test]
fn family_localized_names_contain_only_family_names() {
    let result = scan_files(
        &[common::fixture("Lato-Regular.ttf")],
        &ScanOptions::default(),
    )
    .unwrap();
    assert!(result.catalog.families[0]
        .localized_names
        .iter()
        .all(|n| matches!(
            n.kind,
            NameKind::Family | NameKind::TypographicFamily | NameKind::WwsFamily
        )));
}

#[test]
fn collection_and_standalone_faces_group_globally_across_directories() {
    let dir = tempfile::tempdir().unwrap();
    let ttc = collection(&[
        read_fixture("Lato-Regular.ttf"),
        read_fixture("Lato-Bold.ttf"),
    ]);
    write_in(dir.path(), "a/family.ttc", &ttc);
    common::copy_fixture(dir.path(), "Lato-Italic.ttf", "b/italic.ttf");
    let result = scan_directory(dir.path(), &ScanOptions::default()).unwrap();
    assert_eq!(result.catalog.family_count(), 1);
    assert_eq!(result.catalog.families[0].faces.len(), 3);
    assert_eq!(result.stats.supported_font_files, 2);
    assert!(result.issues.is_empty());
}

#[test]
fn collection_container_does_not_claim_the_first_members_outline() {
    let tt = read_fixture("Lato-Regular.ttf");
    let ot = read_fixture("SourceSerif4-Regular.otf");
    for fonts in [
        vec![tt.clone(), ot.clone()],
        vec![ot.clone(), tt],
        vec![ot.clone(), ot],
    ] {
        let parsed = parse(&collection(&fonts));
        assert_eq!(
            serde_json::to_string(&parsed.format).unwrap(),
            "\"collection\""
        );
        assert_eq!(parsed.faces.len(), 2);
        assert!(parsed.problems.is_empty());
        for (face, font) in parsed.faces.iter().zip(&fonts) {
            assert_eq!(face.format, parse(font).format);
        }
    }
}

#[test]
fn corrupt_collection_offsets_isolate_first_or_last_member() {
    let good = collection(&[
        read_fixture("Lato-Regular.ttf"),
        read_fixture("Lato-Bold.ttf"),
    ]);
    for bad_index in [0, 1] {
        let mut data = good.clone();
        data[12 + bad_index * 4..16 + bad_index * 4].copy_from_slice(&u32::MAX.to_be_bytes());
        let parsed = parse(&data);
        assert_eq!(parsed.faces.len(), 1);
        assert_eq!(parsed.faces[0].face_index, 1 - bad_index as u32);
        assert_eq!(parsed.problems.len(), 1);
        assert_eq!(parsed.problems[0].face_index, Some(bad_index as u32));
        let dir = tempfile::tempdir().unwrap();
        let path = write_in(dir.path(), "partial.ttc", &data);
        let result = scan_files(&[path], &ScanOptions::default()).unwrap();
        assert_eq!(result.issues[0].kind, IssueKind::CollectionProblem);
        assert_eq!(result.stats.supported_font_files, 1);
        assert_eq!(result.stats.failed_files, 0);
    }
}

#[test]
fn corrupt_member_table_range_is_not_silently_accepted() {
    let mut data = collection(&[
        read_fixture("Lato-Regular.ttf"),
        read_fixture("Lato-Bold.ttf"),
    ]);
    let member = common::u32_at(&data, 12) as usize;
    data[member + 20..member + 24].copy_from_slice(&u32::MAX.to_be_bytes());
    let parsed = parse(&data);
    assert_eq!(parsed.faces.len(), 1);
    assert_eq!(parsed.faces[0].face_index, 1);
    assert_eq!(parsed.problems[0].face_index, Some(0));
}

#[test]
fn windows_and_mac_language_ids_are_not_interchangeable() {
    let data = with_names(
        &[
            (1, 0, 0, 1, "Mac English"),
            (1, 0, 1, 1, "Mac French"),
            (1, 0, 0x409, 1, "Unknown Mac"),
            (3, 1, 0, 1, "Unknown Windows"),
            (3, 1, 0x409, 1, "English"),
            (3, 1, 0x411, 1, "日本語"),
            (3, 1, 0x804, 1, "简体中文"),
            (3, 1, 0xffff, 1, "Unknown"),
        ],
        &[],
    );
    let parsed = parse(&data);
    let names = &parsed.faces[0].metadata.localized_names;
    for (value, expected) in [
        ("Mac English", Some("en")),
        ("Mac French", Some("fr")),
        ("Unknown Mac", None),
        ("Unknown Windows", None),
        ("English", Some("en-US")),
        ("日本語", Some("ja-JP")),
        ("简体中文", Some("zh-Hans")),
        ("Unknown", None),
    ] {
        assert_eq!(
            names
                .iter()
                .find(|n| n.value == value)
                .unwrap()
                .language
                .as_deref(),
            expected,
            "{value}"
        );
    }
}

#[test]
fn format_one_tags_keep_valid_languages_and_reject_invalid_labels() {
    let data = with_names(
        &[
            (3, 1, 0x8000, 1, "English"),
            (3, 1, 0x8001, 1, "繁體中文"),
            (3, 1, 0x8002, 1, "Invalid tag"),
            (3, 1, 0x8003, 1, "Missing tag"),
        ],
        &["en-US", "zh-Hant-HK", "not_a_tag"],
    );
    let parsed = parse(&data);
    for (value, language) in [
        ("English", Some("en-US")),
        ("繁體中文", Some("zh-Hant-HK")),
        ("Invalid tag", None),
        ("Missing tag", None),
    ] {
        assert_eq!(
            parsed.faces[0]
                .metadata
                .localized_names
                .iter()
                .find(|n| n.value == value)
                .unwrap()
                .language
                .as_deref(),
            language
        );
    }
}

#[test]
fn every_tracked_name_id_is_preserved_and_typographic_names_win() {
    let data = with_names(
        &[
            (3, 1, 0x409, 1, "Legacy"),
            (3, 1, 0x409, 2, "Regular"),
            (3, 1, 0x409, 4, "Full"),
            (3, 1, 0x409, 5, "Version 1.0"),
            (3, 1, 0x409, 6, "PS"),
            (3, 1, 0x409, 16, "Typographic"),
            (3, 1, 0x409, 17, "Medium"),
            (3, 1, 0x409, 21, "WWS"),
            (3, 1, 0x409, 22, "WWS Style"),
        ],
        &[],
    );
    let parsed = parse(&data);
    let meta = &parsed.faces[0].metadata;
    assert_eq!(meta.localized_names.len(), 9);
    assert!(meta.localized_names.windows(2).all(|n| n[0] <= n[1]));
    assert_eq!(meta.family_name.as_deref(), Some("Typographic"));
    assert_eq!(meta.subfamily_name.as_deref(), Some("Medium"));
    assert_eq!(meta.legacy_family_name.as_deref(), Some("Legacy"));
}

#[test]
fn colliding_postscript_names_deliberately_share_only_logical_identity() {
    let a = parse(&named("Alpha", "Regular", "Collision"));
    let b = parse(&named("Beta", "Bold", "Collision"));
    assert_eq!(a.faces[0].identity.id, b.faces[0].identity.id);
    assert_ne!(a.faces[0].revision.id, b.faces[0].revision.id);
    assert_ne!(a.faces[0].id, b.faces[0].id);
}

#[test]
fn identity_name_pair_encoding_is_unambiguous() {
    let a = parse(&with_names(
        &[(3, 1, 0x409, 1, "A\0B"), (3, 1, 0x409, 2, "C")],
        &[],
    ));
    let b = parse(&with_names(
        &[(3, 1, 0x409, 1, "A"), (3, 1, 0x409, 2, "B\0C")],
        &[],
    ));
    assert_ne!(a.faces[0].identity.id, b.faces[0].identity.id);
}

#[test]
fn real_table_revision_with_valid_checksums_keeps_identity() {
    let data = read_fixture("Lato-Regular.ttf");
    let font = read_fonts::FontRef::new(&data).unwrap();
    use read_fonts::TableProvider;
    let mut head = font.head().unwrap().offset_data().as_bytes().to_vec();
    let revision = common::u32_at(&head, 4) + 1;
    head[4..8].copy_from_slice(&revision.to_be_bytes());
    let modified = replace_table(&data, b"head", Some(&head));
    assert_eq!(common::checksum(&modified), 0xB1B0_AFBA);
    let font = read_fonts::FontRef::new(&modified).unwrap();
    for record in font.table_directory().table_records() {
        let mut bytes = font.table_data(record.tag()).unwrap().as_bytes().to_vec();
        if record.tag() == read_fonts::types::Tag::new(b"head") {
            bytes[8..12].fill(0);
        }
        assert_eq!(common::checksum(&bytes), record.checksum());
    }
    let a = parse(&data);
    let b = parse(&modified);
    assert_eq!(a.faces[0].identity, b.faces[0].identity);
    assert_ne!(a.faces[0].revision, b.faces[0].revision);
    assert_ne!(
        a.faces[0].metadata.font_version,
        b.faces[0].metadata.font_version
    );
    assert_eq!(
        a.faces[0].metadata.localized_names,
        b.faces[0].metadata.localized_names
    );
}

#[test]
fn misleading_extensions_and_web_magic_use_the_shared_pipeline() {
    let dir = tempfile::tempdir().unwrap();
    let paths = vec![
        write_in(dir.path(), "fake.woff", common::TINY_PNG),
        common::copy_fixture(dir.path(), "Inter-Regular.woff", "web.data"),
        common::copy_fixture(dir.path(), "Inter-Regular.woff2", "web"),
        common::copy_fixture(dir.path(), "Lato-Regular.ttf", "font"),
        dir.path().join("missing.ttf"),
        dir.path().to_path_buf(),
    ];
    let result = scan_files(&paths, &ScanOptions::default()).unwrap();
    assert_eq!(result.stats.unsupported_known_font_files, 2);
    assert_eq!(result.stats.failed_files, 3);
    assert_eq!(result.stats.supported_font_files, 1);
    assert!(
        result
            .issues
            .iter()
            .any(|i| i.kind == IssueKind::KnownUnsupportedFormat
                && i.format == Some(FontFormat::Woff))
    );
    assert!(result
        .issues
        .iter()
        .any(|i| i.kind == IssueKind::MalformedFont && i.path.ends_with("fake.woff")));
}

#[test]
fn canonical_path_aliases_are_one_candidate() {
    let dir = tempfile::tempdir().unwrap();
    let path = common::copy_fixture(dir.path(), "Lato-Regular.ttf", "font.ttf");
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    let result = scan_files(
        &[
            path.clone(),
            path.clone(),
            dir.path().join("sub/../font.ttf"),
        ],
        &ScanOptions::default(),
    )
    .unwrap();
    assert_eq!(result.stats.candidate_font_files, 1);
    assert_eq!(result.catalog.faces().next().unwrap().sources.len(), 1);
}

#[test]
fn mixed_scan_json_is_byte_identical_across_repeated_permutations() {
    let dir = tempfile::tempdir().unwrap();
    let mut paths = vec![
        common::copy_fixture(dir.path(), "Lato-Regular.ttf", "regular.ttf"),
        common::copy_fixture(dir.path(), "Lato-Italic.ttf", "italic.ttf"),
        common::copy_fixture(dir.path(), "Inter-Regular.woff2", "web.woff2"),
        write_in(dir.path(), "bad.ttf", b"broken"),
        write_in(
            dir.path(),
            "collection.ttc",
            &collection(&[read_fixture("Lato-Bold.ttf")]),
        ),
    ];
    let expected =
        serde_json::to_vec(&scan_directory(dir.path(), &ScanOptions::default()).unwrap()).unwrap();
    for _ in 0..8 {
        paths.rotate_left(1);
        let result = scan_files(&paths, &ScanOptions::default()).unwrap();
        assert_eq!(expected, serde_json::to_vec(&result).unwrap());
    }
}

#[test]
fn raw_locales_and_original_name_strings_survive_serialization() {
    let data = with_names(&[(3, 1, 0x8000, 1, "  原始名称\u{a0} ")], &["invalid_tag"]);
    let parsed = parse(&data);
    let name = &parsed.faces[0].metadata.localized_names[0];
    assert_eq!(name.value, "  原始名称\u{a0} ");
    assert_eq!(name.language, None);
    let locale = name.locale.as_ref().unwrap();
    assert_eq!(locale.platform_id, 3);
    assert_eq!(locale.encoding_id, 1);
    assert_eq!(locale.language_id, 0x8000);
    assert_eq!(locale.language_tag.as_deref(), Some("invalid_tag"));
    assert_eq!(
        serde_json::to_value(name).unwrap()["locale"]["language_tag"],
        "invalid_tag"
    );
}

#[test]
fn identity_fallbacks_require_complete_name_pairs() {
    use folio_core::IdentityKind;
    for (records, kind) in [
        (
            vec![(3, 1, 0x409, 16, "Type"), (3, 1, 0x409, 17, "Medium")],
            IdentityKind::TypographicNames,
        ),
        (
            vec![
                (3, 1, 0x409, 16, "Type"),
                (3, 1, 0x409, 1, "Legacy"),
                (3, 1, 0x409, 2, "Regular"),
            ],
            IdentityKind::LegacyNames,
        ),
        (
            vec![
                (3, 1, 0x409, 1, "Family only"),
                (3, 1, 0x409, 4, "Full Name"),
            ],
            IdentityKind::FullName,
        ),
        (
            vec![(3, 1, 0x409, 1, "Family only")],
            IdentityKind::ContentFallback,
        ),
    ] {
        assert_eq!(
            parse(&with_names(&records, &[])).faces[0].identity.kind,
            kind
        );
    }
}

#[test]
fn localized_families_use_preferred_metadata_without_alias_guessing() {
    let dir = tempfile::tempdir().unwrap();
    for (i, localized) in ["示例", "見本"].iter().enumerate() {
        let data = with_names(
            &[
                (3, 1, 0x409, 16, "Example"),
                (3, 1, 0x411, 16, localized),
                (3, 1, 0x409, 17, "Regular"),
                (3, 1, 0x409, 6, &format!("Example-{i}")),
            ],
            &[],
        );
        write_in(dir.path(), &format!("{i}.ttf"), &data);
    }
    let result = scan_directory(dir.path(), &ScanOptions::default()).unwrap();
    assert_eq!(result.catalog.family_count(), 1);
    let names = &result.catalog.families[0].localized_names;
    assert!(names.iter().any(|name| name.value == "示例"));
    assert!(names.iter().any(|name| name.value == "見本"));
}

#[test]
fn reordering_collection_members_keeps_identity_but_changes_revision() {
    let regular = read_fixture("Lato-Regular.ttf");
    let bold = read_fixture("Lato-Bold.ttf");
    let a = parse(&collection(&[regular.clone(), bold.clone()]));
    let b = parse(&collection(&[bold, regular]));
    assert_eq!(a.faces[0].identity.id, b.faces[1].identity.id);
    assert_ne!(a.faces[0].revision.id, b.faces[1].revision.id);
    assert_eq!(b.faces[1].revision.face_discriminator, Some(1));
}

#[test]
fn all_broken_collection_members_fail_only_their_file() {
    let dir = tempfile::tempdir().unwrap();
    let mut broken = collection(&[read_fixture("Lato-Regular.ttf")]);
    broken[12..16].copy_from_slice(&u32::MAX.to_be_bytes());
    let paths = vec![
        write_in(dir.path(), "bad.ttc", &broken),
        common::copy_fixture(dir.path(), "Lato-Bold.ttf", "good.ttf"),
    ];
    let result = scan_files(&paths, &ScanOptions::default()).unwrap();
    assert_eq!(result.stats.failed_files, 1);
    assert_eq!(result.stats.supported_font_files, 1);
    assert_eq!(result.issues[0].kind, IssueKind::MalformedFont);
}

#[test]
fn empty_sfnt_header_is_not_a_usable_font() {
    let data = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    assert!(matches!(
        parse_font_data(Path::new("empty.ttf"), &data, 12, None),
        Err(folio_core::FontError::Malformed { .. })
    ));
}

#[test]
fn missing_head_does_not_discard_other_usable_metadata() {
    let data = replace_table(&read_fixture("Lato-Regular.ttf"), b"head", None);
    let parsed = parse(&data);
    assert_eq!(parsed.faces[0].metadata.units_per_em, None);
    assert_eq!(
        parsed.faces[0].metadata.family_name.as_deref(),
        Some("Lato")
    );
}

#[cfg(unix)]
#[test]
fn non_utf8_paths_do_not_break_public_json() {
    use std::os::unix::ffi::OsStringExt;
    let dir = tempfile::tempdir().unwrap();
    let path = dir
        .path()
        .join(std::ffi::OsString::from_vec(b"font\xff.ttf".to_vec()));
    let data = read_fixture("Lato-Regular.ttf");
    let parsed = parse_font_data(&path, &data, data.len() as u64, None).unwrap();
    assert!(serde_json::to_vec(&parsed).is_ok());
    assert!(serde_json::to_vec(&scan_files(&[path], &ScanOptions::default()).unwrap()).is_ok());
}

#[test]
fn dot_last_resort_is_internal_and_is_kept() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_in(
        dir.path(),
        "internal.ttf",
        &named(".LastResort", "Regular", "LastResort"),
    );
    let result = scan_files(&[path], &ScanOptions::default()).unwrap();
    assert_eq!(result.catalog.face_count(), 1);
    assert_eq!(
        result.catalog.faces().next().unwrap().classification,
        folio_core::FontClassification::Internal
    );
}

#[cfg(unix)]
#[test]
fn explicit_symlink_aliases_merge_but_directory_symlinks_are_skipped() {
    let dir = tempfile::tempdir().unwrap();
    let path = common::copy_fixture(dir.path(), "Lato-Regular.ttf", "font.ttf");
    let alias = dir.path().join("alias.ttf");
    std::os::unix::fs::symlink(&path, &alias).unwrap();
    let explicit = scan_files(&[path, alias], &ScanOptions::default()).unwrap();
    let directory = scan_directory(dir.path(), &ScanOptions::default()).unwrap();
    assert_eq!(explicit, directory);
    assert_eq!(explicit.stats.candidate_font_files, 1);
}

#[cfg(unix)]
#[test]
fn permission_errors_are_isolated_and_keep_io_sources() {
    use std::error::Error;
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let path = common::copy_fixture(dir.path(), "Lato-Regular.ttf", "blocked.ttf");
    common::copy_fixture(dir.path(), "Lato-Bold.ttf", "readable.ttf");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o0)).unwrap();
    let parsed = folio_core::parse_font_file(&path);
    let result = scan_directory(dir.path(), &ScanOptions::default()).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    // 特权测试进程不受 POSIX 权限限制，仍验证其可读取分支。
    if parsed.is_ok() {
        assert_eq!(result.stats.supported_font_files, 2);
        return;
    }
    let error = parsed.unwrap_err();
    let source = error
        .source()
        .unwrap()
        .downcast_ref::<std::io::Error>()
        .unwrap();
    assert_eq!(source.kind(), std::io::ErrorKind::PermissionDenied);
    assert_eq!(result.stats.failed_files, 1);
    assert_eq!(result.stats.supported_font_files, 1);
    assert_eq!(result.issues[0].kind, IssueKind::FileRead);
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o0)).unwrap();
    let root_error = scan_directory(dir.path(), &ScanOptions::default());
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(matches!(
        root_error,
        Err(folio_core::ScanError::RootUnreadable { .. })
    ));
}

#[test]
fn variable_axes_and_named_instance_coordinates_are_verified() {
    let parsed = parse(&read_fixture("Inter-Variable.ttf"));
    let meta = &parsed.faces[0].metadata;
    assert!(meta.is_variable);
    assert_eq!(meta.variable_axes.len(), 2);
    for axis in &meta.variable_axes {
        assert!(axis.localized_names.windows(2).all(|n| n[0] <= n[1]));
    }
    assert!(!meta.named_instances.is_empty());
    let regular = meta
        .named_instances
        .iter()
        .find(|i| i.subfamily_name.as_deref() == Some("Regular"))
        .unwrap();
    assert_eq!(
        regular
            .coordinates
            .iter()
            .find(|c| c.axis_tag == "wght")
            .unwrap()
            .value,
        400.0
    );
    assert_eq!(
        regular
            .coordinates
            .iter()
            .find(|c| c.axis_tag == "opsz")
            .unwrap()
            .value,
        14.0
    );
}
