//! Phase 2A 独立审计回归：缓存、根目录和刷新语义。

mod common;

use common::*;
use folio_storage::{
    AddRootOutcome, FolioDatabase, LibraryRootId, RefreshIssueKind, RefreshMode, StorageError,
};
use rusqlite::Connection;

fn root_id(outcome: AddRootOutcome) -> LibraryRootId {
    match outcome {
        AddRootOutcome::Created(root) | AddRootOutcome::Existing(root) => root.id,
    }
}

#[test]
fn root_path_conflict_does_not_hide_other_constraints() {
    let dir = tempfile::tempdir().unwrap();
    let db = open_db(dir.path());
    let a = dir.path().join("a");
    let b = dir.path().join("b");
    db.add_root(&a, true).unwrap();
    let sql = Connection::open(db.path()).unwrap();
    sql.execute(
        "UPDATE library_roots SET id = ?1",
        [LibraryRootId::for_path(&b).as_bytes().as_slice()],
    )
    .unwrap();
    assert!(matches!(
        db.add_root(&b, true),
        Err(StorageError::Sqlite(_))
    ));
    assert_eq!(db.list_roots().unwrap()[0].path, a);
}

#[test]
fn root_paths_are_absolute_and_trailing_slashes_are_normalized() {
    let dir = tempfile::tempdir().unwrap();
    let db = open_db(dir.path());
    let id = root_id(db.add_root(dir.path(), true).unwrap());
    assert_eq!(
        id,
        root_id(
            db.add_root(format!("{}/./", dir.path().display()), false)
                .unwrap()
        )
    );
    let relative = root_id(db.add_root("fixtures/fonts", true).unwrap());
    assert_eq!(
        db.get_root(relative).unwrap().unwrap().path,
        std::env::current_dir().unwrap().join("fixtures/fonts")
    );
    assert_eq!(
        relative,
        root_id(
            db.add_root(
                std::env::current_dir().unwrap().join("fixtures/fonts"),
                true
            )
            .unwrap()
        )
    );
    assert!(db.add_root("", true).is_err());
}

#[test]
fn reopened_connection_cascades_only_removed_root_membership() {
    let dir = tempfile::tempdir().unwrap();
    let fonts = dir.path().join("fonts");
    let nested = fonts.join("nested");
    copy_fixture(&nested, "Lato-Regular.ttf", "a.ttf");
    let mut db = open_db(dir.path());
    let outer = add_root(&mut db, &fonts);
    let inner = add_root(&mut db, &nested);
    refresh(&mut db);
    drop(db);
    let db = open_db(dir.path());
    let sql = Connection::open(db.path()).unwrap();
    assert_eq!(
        sql.query_row::<i64, _, _>("SELECT count(*) FROM source_files", [], |r| r.get(0))
            .unwrap(),
        2
    );
    db.remove_root(inner.id).unwrap();
    assert_eq!(
        sql.query_row::<i64, _, _>(
            "SELECT count(*) FROM source_files WHERE root_id = ?1",
            [inner.id.as_bytes().as_slice()],
            |r| r.get(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(db.load_cached_catalog().unwrap().face_count(), 1);
    db.remove_root(outer.id).unwrap();
    assert_eq!(
        sql.query_row::<i64, _, _>("SELECT count(*) FROM source_files", [], |r| r.get(0))
            .unwrap(),
        0
    );
    assert_eq!(db.load_cached_catalog().unwrap().face_count(), 0);
}

#[test]
fn disabling_recursion_removes_nested_membership_and_enabling_restores_it() {
    let dir = tempfile::tempdir().unwrap();
    let fonts = dir.path().join("fonts");
    copy_fixture(&fonts, "Lato-Regular.ttf", "top.ttf");
    copy_fixture(&fonts, "Lato-Bold.ttf", "nested/deep.ttf");
    let mut db = open_db(dir.path());
    let root = add_root(&mut db, &fonts);
    assert_eq!(refresh(&mut db).catalog.face_count(), 2);
    db.set_root_recursive(root.id, false).unwrap();
    let result = refresh(&mut db);
    assert_eq!(result.stats.candidate_files, 1);
    assert_eq!(result.stats.files_removed, 1);
    assert_eq!(db.load_cached_catalog().unwrap().face_count(), 1);
    db.set_root_recursive(root.id, true).unwrap();
    let result = refresh(&mut db);
    assert_eq!(result.stats.files_added, 1);
    assert_eq!(result.catalog.face_count(), 2);
}

#[test]
fn same_size_and_mtime_is_an_explicit_incremental_assumption() {
    let dir = tempfile::tempdir().unwrap();
    let fonts = dir.path().join("fonts");
    let path = copy_fixture(&fonts, "Lato-Regular.ttf", "a.ttf");
    let time = std::fs::metadata(&path).unwrap().modified().unwrap();
    let mut db = open_db(dir.path());
    add_root(&mut db, &fonts);
    let first = refresh(&mut db);
    let data = read_fixture("Lato-Regular.ttf");
    let revision = valid_revision(&data);
    assert_eq!(revision.len(), data.len());
    std::fs::write(&path, revision).unwrap();
    std::fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_modified(time)
        .unwrap();
    let incremental = refresh(&mut db);
    assert_eq!(incremental.stats.metadata_cache_hits, 1);
    assert_eq!(incremental.stats.files_hashed, 0);
    assert_eq!(incremental.catalog, first.catalog);
    let rebuilt = db.refresh(RefreshMode::Rebuild).unwrap();
    assert_eq!(rebuilt.stats.files_changed, 1);
    let before = first.catalog.faces().next().unwrap();
    let after = rebuilt.catalog.faces().next().unwrap();
    assert_eq!(before.identity_id, after.identity_id);
    assert_ne!(before.revision_id, after.revision_id);
    assert_ne!(before.id, after.id);
}

#[test]
fn rebuild_and_cache_repair_do_not_count_unchanged_bytes_as_changed() {
    let dir = tempfile::tempdir().unwrap();
    let fonts = dir.path().join("fonts");
    copy_fixture(&fonts, "Lato-Regular.ttf", "a.ttf");
    let mut db = open_db(dir.path());
    add_root(&mut db, &fonts);
    refresh(&mut db);
    let result = db.refresh(RefreshMode::Rebuild).unwrap();
    assert_eq!(result.stats.files_reparsed, 1);
    assert_eq!(result.stats.files_changed, 0);
    Connection::open(db.path())
        .unwrap()
        .execute("UPDATE source_files SET payload_version = 999", [])
        .unwrap();
    assert!(db.load_cached_catalog().is_err());
    let result = refresh(&mut db);
    assert_eq!(result.stats.files_reparsed, 1);
    assert_eq!(result.stats.files_changed, 0);
    assert_eq!(result.stats.cache_corrupt_rows, 1);
    assert!(result
        .issues
        .iter()
        .any(|i| i.kind == RefreshIssueKind::CacheCorrupt));
}

#[test]
fn corrupted_cache_columns_are_typed_and_self_healing() {
    let mutations = [
        "status = 'invalid'",
        "format = 'invalid'",
        "format = NULL",
        "file_size = -1",
        "payload_version = -1",
        "payload_version = 4294967297",
        "path_platform = 'invalid'",
        "path_bytes = X'00'",
        "path_bytes = X''",
        "content_hash = X'01'",
        "content_hash = NULL",
        "content_hash = zeroblob(32)",
        "payload = X'0000'",
        "payload = X'FFFFFFFFFFFFFFFF'",
        "payload = NULL",
        "payload = zeroblob(67108865)",
    ];
    for mutation in mutations {
        let dir = tempfile::tempdir().unwrap();
        let fonts = dir.path().join("fonts");
        copy_fixture(&fonts, "Lato-Regular.ttf", "a.ttf");
        let mut db = open_db(dir.path());
        add_root(&mut db, &fonts);
        refresh(&mut db);
        let sql = Connection::open(db.path()).unwrap();
        sql.execute(&format!("UPDATE source_files SET {mutation}"), [])
            .unwrap();
        assert!(db.load_cached_catalog().is_err(), "{mutation}");
        let result = refresh(&mut db);
        assert_eq!(result.stats.cache_corrupt_rows, 1, "{mutation}");
        assert_eq!(result.stats.files_hashed, 1, "{mutation}");
        assert_eq!(result.stats.files_reparsed, 1, "{mutation}");
        assert_eq!(result.catalog.face_count(), 1, "{mutation}");
        assert_eq!(
            db.load_cached_catalog().unwrap(),
            result.catalog,
            "{mutation}"
        );
        assert_eq!(
            sql.query_row::<i64, _, _>("SELECT count(*) FROM source_files", [], |r| r.get(0))
                .unwrap(),
            1,
            "{mutation}"
        );
    }
}

#[test]
fn corrupt_durable_roots_are_never_silently_deleted() {
    for mutation in [
        "id = X'01'",
        "recursive = 7",
        "path_platform = 'invalid'",
        "path_bytes = X'00'",
        "path_bytes = X'61'",
    ] {
        let dir = tempfile::tempdir().unwrap();
        let mut db = open_db(dir.path());
        db.add_root(dir.path(), true).unwrap();
        let sql = Connection::open(db.path()).unwrap();
        sql.execute(&format!("UPDATE library_roots SET {mutation}"), [])
            .unwrap();
        assert!(db.list_roots().is_err(), "{mutation}");
        assert!(db.refresh(RefreshMode::Rebuild).is_err(), "{mutation}");
        assert_eq!(
            sql.query_row::<i64, _, _>("SELECT count(*) FROM library_roots", [], |r| r.get(0))
                .unwrap(),
            1
        );
    }
}

#[test]
fn foreign_platform_root_never_scans_its_display_path() {
    let dir = tempfile::tempdir().unwrap();
    let fonts = dir.path().join("fonts");
    copy_fixture(&fonts, "Lato-Regular.ttf", "a.ttf");
    let mut db = open_db(dir.path());
    add_root(&mut db, &fonts);
    let foreign = if cfg!(windows) { "unix" } else { "windows" };
    Connection::open(db.path())
        .unwrap()
        .execute(
            "UPDATE library_roots SET path_platform = ?1, path_bytes = X'4100'",
            [foreign],
        )
        .unwrap();
    assert!(db.refresh(RefreshMode::Incremental).is_err());
    assert_eq!(db.load_cached_catalog().unwrap().face_count(), 0);
}

#[test]
fn unsupported_touch_and_malformed_content_changes_have_consistent_counts() {
    let dir = tempfile::tempdir().unwrap();
    let fonts = dir.path().join("fonts");
    let a = copy_fixture(&fonts, "Inter-Regular.woff", "a.woff");
    let b = copy_fixture(&fonts, "Inter-Regular.woff2", "b.woff2");
    let bad = write_in(&fonts, "bad.ttf", b"bad");
    let mut db = open_db(dir.path());
    add_root(&mut db, &fonts);
    refresh(&mut db);
    bump_mtime(&a);
    bump_mtime(&b);
    let touch = refresh(&mut db);
    assert_eq!(touch.stats.files_hashed, 2);
    assert_eq!(touch.stats.content_cache_hits, 2);
    assert_eq!(touch.stats.files_reparsed, 0);
    assert_eq!(touch.stats.known_unsupported, 2);
    assert_eq!(touch.stats.failed_files, 1);
    std::fs::write(&bad, read_fixture("Lato-Regular.ttf")).unwrap();
    let fixed = refresh(&mut db);
    assert_eq!(fixed.stats.files_reparsed, 1);
    assert_eq!(fixed.stats.files_changed, 1);
    assert_eq!(fixed.stats.failed_files, 0);
    assert_eq!(fixed.catalog.face_count(), 1);
}

#[test]
fn duplicate_binary_paths_survive_load_and_independent_source_removal() {
    let dir = tempfile::tempdir().unwrap();
    let fonts = dir.path().join("fonts");
    let a = copy_fixture(&fonts, "Lato-Regular.ttf", "a.ttf");
    copy_fixture(&fonts, "Lato-Regular.ttf", "b.ttf");
    let mut db = open_db(dir.path());
    add_root(&mut db, &fonts);
    let first = refresh(&mut db);
    assert_eq!(first.catalog.face_count(), 1);
    assert_eq!(first.catalog.faces().next().unwrap().sources.len(), 2);
    assert_eq!(db.load_cached_catalog().unwrap(), first.catalog);
    std::fs::remove_file(a).unwrap();
    let result = refresh(&mut db);
    assert_eq!(result.stats.files_removed, 1);
    assert_eq!(result.catalog.faces().next().unwrap().sources.len(), 1);
    assert_eq!(
        result.catalog.faces().next().unwrap().revision_id,
        first.catalog.faces().next().unwrap().revision_id
    );
}

#[test]
fn future_database_is_unchanged_and_late_migration_failure_rolls_back() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("future.sqlite");
    let sql = Connection::open(&path).unwrap();
    sql.execute_batch("CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES ('preserve'); PRAGMA user_version = 99;").unwrap();
    let before = std::fs::read(&path).unwrap();
    assert!(matches!(
        FolioDatabase::open(&path),
        Err(StorageError::DatabaseTooNew { .. })
    ));
    assert_eq!(std::fs::read(&path).unwrap(), before);
    let conflict = dir.path().join("conflict.sqlite");
    let sql = Connection::open(&conflict).unwrap();
    sql.execute_batch(
        "CREATE TABLE source_files (sentinel TEXT); INSERT INTO source_files VALUES ('preserve');",
    )
    .unwrap();
    assert!(matches!(
        FolioDatabase::open(&conflict),
        Err(StorageError::Migration { .. })
    ));
    assert_eq!(
        sql.query_row::<i64, _, _>("PRAGMA user_version", [], |r| r.get(0))
            .unwrap(),
        0
    );
    assert_eq!(
        sql.query_row::<i64, _, _>(
            "SELECT count(*) FROM sqlite_master WHERE name = 'library_roots'",
            [],
            |r| r.get(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        sql.query_row::<String, _, _>("SELECT sentinel FROM source_files", [], |r| r.get(0))
            .unwrap(),
        "preserve"
    );
}

#[test]
fn refresh_root_returns_its_scope_and_leaves_other_roots_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let a = dir.path().join("a");
    let b = dir.path().join("b");
    copy_fixture(&a, "Lato-Regular.ttf", "a.ttf");
    copy_fixture(&b, "Lato-Bold.ttf", "b.ttf");
    let mut db = open_db(dir.path());
    let root_a = add_root(&mut db, &a);
    add_root(&mut db, &b);
    refresh(&mut db);
    let result = db
        .refresh_root(root_a.id, RefreshMode::Incremental)
        .unwrap();
    assert_eq!(result.stats.roots_scanned, 1);
    assert_eq!(result.catalog.face_count(), 1);
    assert_eq!(db.load_cached_catalog().unwrap().face_count(), 2);
}

#[test]
#[cfg(unix)]
fn symlink_root_is_explicit_and_descendant_symlinks_are_skipped() {
    use std::os::unix::fs::symlink;
    let dir = tempfile::tempdir().unwrap();
    let fonts = dir.path().join("fonts");
    let a = copy_fixture(&fonts, "Lato-Regular.ttf", "a.ttf");
    let outside = dir.path().join("outside");
    copy_fixture(&outside, "Lato-Bold.ttf", "b.ttf");
    symlink(&a, fonts.join("alias.ttf")).unwrap();
    symlink(&outside, fonts.join("linked-dir")).unwrap();
    let alias = dir.path().join("alias-root");
    symlink(&fonts, &alias).unwrap();
    let mut db = open_db(dir.path());
    add_root(&mut db, &fonts);
    add_root(&mut db, &alias);
    let result = refresh(&mut db);
    assert_eq!(result.stats.candidate_files, 2);
    assert_eq!(result.catalog.face_count(), 1);
    assert_eq!(result.catalog.faces().next().unwrap().sources.len(), 1);
    assert_eq!(db.list_roots().unwrap().len(), 2);
}

#[test]
fn fresh_warm_touch_and_valid_revision_smoke() {
    fn log(stage: &str, result: &folio_storage::RefreshResult) {
        println!(
            "{stage}: {}",
            serde_json::json!({
                "stats": result.stats, "faces": result.catalog.face_count(),
                "families": result.catalog.family_count(), "issues": result.issues.len(),
            })
        );
    }
    let dir = tempfile::tempdir().unwrap();
    let fonts = dir.path().join("fonts");
    for name in [
        "Lato-Regular.ttf",
        "Lato-Bold.ttf",
        "Lato-Italic.ttf",
        "SourceSerif4-Regular.otf",
        "Inter-Variable.ttf",
        "Inter-Regular.woff",
        "Inter-Regular.woff2",
    ] {
        copy_fixture(&fonts, name, name);
    }
    let mut db = open_db(dir.path());
    add_root(&mut db, &fonts);
    let first = refresh(&mut db);
    log("fresh", &first);
    assert_eq!(first.stats.files_added, 7);
    assert_eq!(first.stats.files_hashed, 7);
    assert_eq!(first.stats.files_reparsed, 7);
    let warm = refresh(&mut db);
    log("warm", &warm);
    assert_eq!(warm.stats.metadata_cache_hits, 7);
    assert_eq!(warm.stats.files_hashed, 0);
    assert_eq!(warm.stats.files_reparsed, 0);
    let path = fonts.join("Lato-Regular.ttf");
    bump_mtime(&path);
    let touch = refresh(&mut db);
    log("touch", &touch);
    assert_eq!(touch.stats.files_hashed, 1);
    assert_eq!(touch.stats.content_cache_hits, 1);
    assert_eq!(touch.stats.files_reparsed, 0);
    std::fs::write(&path, valid_revision(&read_fixture("Lato-Regular.ttf"))).unwrap();
    bump_mtime(&path);
    let changed = refresh(&mut db);
    log("content-change", &changed);
    assert_eq!(changed.stats.files_hashed, 1);
    assert_eq!(changed.stats.files_reparsed, 1);
    assert_eq!(changed.stats.files_changed, 1);
    let before = first
        .catalog
        .faces()
        .find(|f| f.metadata.postscript_name.as_deref() == Some("Lato-Regular"))
        .unwrap();
    let after = changed
        .catalog
        .faces()
        .find(|f| f.metadata.postscript_name.as_deref() == Some("Lato-Regular"))
        .unwrap();
    assert_eq!(before.identity_id, after.identity_id);
    assert_ne!(before.revision_id, after.revision_id);
    assert_ne!(before.id, after.id);
    println!(
        "identity={} revision={} -> {} face={} -> {}",
        before.identity_id, before.revision_id, after.revision_id, before.id, after.id
    );
    assert_eq!(changed.catalog, db.load_cached_catalog().unwrap());
}

#[test]
fn damaged_cache_root_id_is_typed_and_cache_clear_preserves_roots() {
    let dir = tempfile::tempdir().unwrap();
    let fonts = dir.path().join("fonts");
    copy_fixture(&fonts, "Lato-Regular.ttf", "a.ttf");
    let mut db = open_db(dir.path());
    add_root(&mut db, &fonts);
    refresh(&mut db);
    let sql = Connection::open(db.path()).unwrap();
    sql.pragma_update(None, "foreign_keys", false).unwrap();
    sql.execute("UPDATE source_files SET root_id = X'01'", [])
        .unwrap();
    assert!(matches!(
        db.load_cached_catalog(),
        Err(StorageError::InvalidStoredId { .. })
    ));
    db.clear_catalog_cache().unwrap();
    assert_eq!(db.list_roots().unwrap().len(), 1);
    assert_eq!(refresh(&mut db).catalog.face_count(), 1);
}

#[test]
fn collection_and_standalone_group_across_roots_after_reopen() {
    #[path = "../../folio-core/tests/common/mod.rs"]
    mod core_fixtures;
    let dir = tempfile::tempdir().unwrap();
    let a = dir.path().join("a");
    let b = dir.path().join("b");
    write_in(
        &a,
        "family.ttc",
        &core_fixtures::collection(&[
            read_fixture("Lato-Regular.ttf"),
            read_fixture("Lato-Bold.ttf"),
        ]),
    );
    copy_fixture(&b, "Lato-Italic.ttf", "italic.ttf");
    let mut db = open_db(dir.path());
    add_root(&mut db, &a);
    add_root(&mut db, &b);
    let result = refresh(&mut db);
    assert_eq!(result.catalog.family_count(), 1);
    assert_eq!(result.catalog.face_count(), 3);
    drop(db);
    assert_eq!(
        open_db(dir.path()).load_cached_catalog().unwrap(),
        result.catalog
    );
}
