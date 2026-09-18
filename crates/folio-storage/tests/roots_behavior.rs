//! 根目录不可用与遍历不完整时都不得删除缓存。

mod common;

use common::{add_root, copy_fixture, open_db, refresh};
use folio_storage::{RefreshIssueKind, RefreshMode};

#[test]
fn unavailable_root_keeps_cached_catalog() {
    let library = tempfile::tempdir().expect("library");
    let fonts = library.path().join("fonts");
    std::fs::create_dir_all(&fonts).expect("mkdir");
    copy_fixture(&fonts, "Lato-Regular.ttf", "Lato-Regular.ttf");

    let db_dir = tempfile::tempdir().expect("db");
    let mut db = open_db(db_dir.path());
    let root = add_root(&mut db, &fonts);
    let first = refresh(&mut db);
    assert_eq!(first.catalog.face_count(), 1);

    // 让根目录暂时不可用。
    let moved = library.path().join("fonts-offline");
    std::fs::rename(&fonts, &moved).expect("move root away");

    let unavailable = db.refresh(RefreshMode::Incremental).expect("refresh");
    assert_eq!(unavailable.stats.roots_unavailable, 1);
    assert_eq!(unavailable.stats.files_removed, 0, "must not delete cache");
    assert_eq!(unavailable.catalog, first.catalog);
    assert!(unavailable
        .issues
        .iter()
        .any(|issue| issue.kind == RefreshIssueKind::RootUnavailable));

    // 持久根目录与缓存保持完整。
    assert!(db.get_root(root.id).expect("get root").is_some());
    assert_eq!(
        db.load_cached_catalog().expect("cached").face_count(),
        1,
        "cached catalog survives an unavailable root"
    );

    // 恢复。
    std::fs::rename(&moved, &fonts).expect("restore root");
    let recovered = db.refresh(RefreshMode::Incremental).expect("refresh");
    assert_eq!(recovered.stats.roots_unavailable, 0);
    assert_eq!(recovered.stats.metadata_cache_hits, 1);
    assert_eq!(recovered.catalog, first.catalog);
}

#[test]
#[cfg(unix)]
fn incomplete_traversal_does_not_delete_unseen_sources() {
    use std::os::unix::fs::PermissionsExt;

    let library = tempfile::tempdir().expect("library");
    let fonts = library.path().join("fonts");
    let hidden = fonts.join("hidden");
    std::fs::create_dir_all(&hidden).expect("mkdir");
    copy_fixture(&fonts, "Lato-Regular.ttf", "top.ttf");
    copy_fixture(&hidden, "Lato-Bold.ttf", "deep.ttf");

    let db_dir = tempfile::tempdir().expect("db");
    let mut db = open_db(db_dir.path());
    add_root(&mut db, &fonts);
    let first = refresh(&mut db);
    assert_eq!(first.catalog.face_count(), 2);

    // 拒绝进入 `hidden`；目录仍然存在。
    std::fs::set_permissions(&hidden, std::fs::Permissions::from_mode(0o000))
        .expect("deny traversal");
    let result = db.refresh(RefreshMode::Incremental);
    // 断言前先恢复权限，确保清理总是可行。
    std::fs::set_permissions(&hidden, std::fs::Permissions::from_mode(0o755))
        .expect("restore traversal");

    let incomplete = result.expect("refresh");
    assert_eq!(incomplete.stats.roots_incomplete, 1);
    assert_eq!(
        incomplete.stats.files_removed, 0,
        "must not delete unseen rows"
    );
    assert_eq!(incomplete.catalog.face_count(), 2);
    assert!(incomplete
        .issues
        .iter()
        .any(|issue| issue.kind == RefreshIssueKind::TraversalIncomplete));

    let recovered = refresh(&mut db);
    assert_eq!(recovered.stats.roots_incomplete, 0);
    assert_eq!(recovered.catalog.face_count(), 2);
}
