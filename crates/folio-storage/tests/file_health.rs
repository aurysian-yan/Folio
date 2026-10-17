//! 文件级健康结果不依赖有效字款，重开与重叠来源保持一致。
mod common;

use common::*;
use folio_storage::RefreshIssueKind;

#[test]
fn diagnostics_survive_reopen_and_deduplicate_overlapping_roots() {
    let dir = tempfile::tempdir().unwrap();
    let fonts = dir.path().join("fonts");
    let nested = fonts.join("nested");
    copy_fixture(&fonts, "Lato-Regular.ttf", "valid.ttf");
    copy_fixture(&nested, "Inter-Regular.woff", "unsupported.woff");
    let bad = write_in(&nested, "bad.ttf", b"invalid");
    let mut db = open_db(dir.path());
    add_root(&mut db, &fonts);
    add_root(&mut db, &nested);
    refresh(&mut db);
    assert_eq!(db.cached_damaged_file_count().unwrap(), 1);
    drop(db);
    let mut db = open_db(dir.path());
    assert_eq!(db.cached_damaged_file_count().unwrap(), 1);
    let issues = db.cached_file_issues().unwrap();
    assert!(issues.iter().any(
        |item| item.path.as_ref() == Some(&bad.canonicalize().unwrap())
            && item.kind == RefreshIssueKind::MalformedFont
    ));
    assert!(issues
        .iter()
        .any(|item| item.kind == RefreshIssueKind::KnownUnsupportedFormat));
    std::fs::copy(common::fixture("Lato-Bold.ttf"), &bad).unwrap();
    refresh(&mut db);
    assert_eq!(db.cached_damaged_file_count().unwrap(), 0);
    assert_eq!(db.load_cached_catalog().unwrap().face_count(), 2);
    assert!(bad.exists());
}
