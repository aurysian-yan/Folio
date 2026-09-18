//! Scanning: failure isolation, stats, diagnostics, explicit files and
//! classification.

mod common;

use std::collections::HashSet;
use std::path::PathBuf;

use common::{copy_fixture, patch_lato_postscript_name, read_fixture, write_in, TINY_PNG};
use folio_core::{
    scan_directory, scan_files, FontClassification, IssueKind, ScanError, ScanOptions,
};

fn options() -> ScanOptions {
    ScanOptions::default()
}

#[test]
fn directory_scan_isolates_failures() {
    let dir = tempfile::tempdir().expect("tempdir");
    copy_fixture(dir.path(), "Lato-Regular.ttf", "good.ttf");
    copy_fixture(dir.path(), "SourceSerif4-Regular.otf", "good.otf");
    write_in(dir.path(), "broken.ttf", b"definitely not a font");
    write_in(dir.path(), "notes.txt", b"remember to buy milk");
    write_in(dir.path(), "pixel.png", TINY_PNG);
    copy_fixture(dir.path(), "Inter-Regular.woff2", "web.woff2");

    let result = scan_directory(dir.path(), &options()).expect("scan must succeed");

    assert_eq!(result.stats.files_seen, 6);
    assert_eq!(result.stats.candidate_font_files, 4);
    assert_eq!(result.stats.supported_font_files, 2);
    assert_eq!(result.stats.unsupported_known_font_files, 1);
    assert_eq!(result.stats.failed_files, 1);
    assert_eq!(result.stats.faces_parsed, 2);
    assert_eq!(result.stats.families_created, 2);
    assert_eq!(result.catalog.family_count(), 2);

    assert_eq!(result.issues.len(), 2);
    let kinds: HashSet<IssueKind> = result.issues.iter().map(|issue| issue.kind).collect();
    assert!(kinds.contains(&IssueKind::MalformedFont));
    assert!(kinds.contains(&IssueKind::KnownUnsupportedFormat));

    let malformed = result
        .issues
        .iter()
        .find(|issue| issue.kind == IssueKind::MalformedFont)
        .expect("malformed issue");
    assert!(malformed.path.ends_with("broken.ttf"));
}

#[test]
fn non_recursive_scan_stays_on_one_level() {
    let dir = tempfile::tempdir().expect("tempdir");
    copy_fixture(dir.path(), "Lato-Regular.ttf", "top.ttf");
    copy_fixture(dir.path(), "Lato-Bold.ttf", "nested/deep.ttf");

    let recursive = scan_directory(dir.path(), &options()).expect("recursive scan");
    assert_eq!(recursive.stats.files_seen, 2);
    assert_eq!(recursive.stats.candidate_font_files, 2);
    assert_eq!(recursive.catalog.families[0].faces.len(), 2);

    let shallow =
        scan_directory(dir.path(), &ScanOptions { recursive: false }).expect("shallow scan");
    assert_eq!(shallow.stats.files_seen, 1);
    assert_eq!(shallow.stats.candidate_font_files, 1);
    assert_eq!(shallow.catalog.family_count(), 1);
    assert_eq!(shallow.catalog.families[0].faces.len(), 1);
}

#[test]
fn explicit_file_scan_reuses_the_directory_pipeline() {
    let dir = tempfile::tempdir().expect("tempdir");
    let regular = copy_fixture(dir.path(), "Lato-Regular.ttf", "Lato-Regular.ttf");
    let bold = copy_fixture(dir.path(), "Lato-Bold.ttf", "Lato-Bold.ttf");

    let from_directory = scan_directory(dir.path(), &options()).expect("directory scan");
    let from_files = scan_files(&[bold.clone(), regular.clone()], &options()).expect("file scan");

    assert_eq!(from_directory.catalog, from_files.catalog);
    assert_eq!(from_directory.issues, from_files.issues);
    assert_eq!(from_directory.stats, from_files.stats);
}

#[test]
fn explicit_scan_accepts_unknown_extensions() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = write_in(dir.path(), "mystery.bin", &read_fixture("Lato-Regular.ttf"));

    let result = scan_files(&[path], &options()).expect("file scan");
    assert_eq!(result.stats.files_seen, 1);
    assert_eq!(result.stats.candidate_font_files, 1);
    assert_eq!(result.stats.supported_font_files, 1);
    assert_eq!(result.stats.faces_parsed, 1);
    assert!(result.issues.is_empty());
}

#[test]
fn explicit_scan_reports_missing_files_as_issues() {
    let missing = PathBuf::from("/definitely/not/here/font.ttf");
    let result = scan_files(&[missing], &options()).expect("scan returns a result");
    assert_eq!(result.stats.failed_files, 1);
    assert_eq!(result.stats.supported_font_files, 0);
    assert_eq!(result.issues.len(), 1);
    assert_eq!(result.issues[0].kind, IssueKind::FileRead);
    assert!(result.catalog.families.is_empty());
}

#[test]
fn missing_scan_root_is_a_top_level_error() {
    let missing = PathBuf::from("/definitely/not/here");
    let error = scan_directory(&missing, &options()).expect_err("missing root must fail");
    assert!(matches!(error, ScanError::RootUnreadable { .. }));
}

#[test]
fn file_as_scan_root_is_a_top_level_error() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = write_in(dir.path(), "font.ttf", &read_fixture("Lato-Regular.ttf"));
    let error = scan_directory(&path, &options()).expect_err("file root must fail");
    assert!(matches!(error, ScanError::RootNotDirectory { .. }));
}

#[test]
fn internal_and_system_like_fonts_are_classified_but_kept() {
    let dir = tempfile::tempdir().expect("tempdir");
    let data = read_fixture("Lato-Regular.ttf");
    write_in(
        dir.path(),
        "dot-prefixed.ttf",
        &patch_lato_postscript_name(&data, ".AppleLato-R"),
    );
    write_in(
        dir.path(),
        "last-resort.ttf",
        &patch_lato_postscript_name(&data, "LastResort-A"),
    );

    let result = scan_directory(dir.path(), &options()).expect("scan");
    assert_eq!(
        result.catalog.face_count(),
        2,
        "internal fonts stay in the catalog"
    );

    let classifications: Vec<FontClassification> = result
        .catalog
        .faces()
        .map(|face| face.classification)
        .collect();
    assert!(classifications.contains(&FontClassification::Internal));
    assert!(classifications.contains(&FontClassification::SystemLike));
}

#[test]
fn ordinary_fonts_are_classified_normal() {
    let dir = tempfile::tempdir().expect("tempdir");
    copy_fixture(dir.path(), "Lato-Regular.ttf", "Lato-Regular.ttf");
    let result = scan_directory(dir.path(), &options()).expect("scan");
    let face = result.catalog.faces().next().expect("one face");
    assert_eq!(face.classification, FontClassification::Normal);
}

#[test]
fn duplicate_files_merge_into_one_face_with_multiple_sources() {
    let dir = tempfile::tempdir().expect("tempdir");
    copy_fixture(dir.path(), "Lato-Regular.ttf", "copy-a.ttf");
    copy_fixture(dir.path(), "Lato-Regular.ttf", "copy-b.ttf");

    let result = scan_directory(dir.path(), &options()).expect("scan");
    assert_eq!(result.stats.faces_parsed, 2);
    assert_eq!(
        result.catalog.face_count(),
        1,
        "identical content is one revision"
    );
    let face = result.catalog.faces().next().expect("one face");
    assert_eq!(face.sources.len(), 2);
    assert!(face.sources[0].path() < face.sources[1].path());
}

#[test]
fn issues_are_deterministically_sorted() {
    let dir = tempfile::tempdir().expect("tempdir");
    write_in(dir.path(), "b-broken.ttf", b"nope");
    write_in(dir.path(), "a-broken.ttf", b"nope");
    write_in(dir.path(), "c-broken.ttf", b"nope");

    let first = scan_directory(dir.path(), &options()).expect("scan");
    let second = scan_directory(dir.path(), &options()).expect("scan");
    assert_eq!(first.issues, second.issues);
    assert_eq!(first.issues.len(), 3);
    assert!(first.issues[0].path.ends_with("a-broken.ttf"));
    assert!(first.issues[2].path.ends_with("c-broken.ttf"));
}
