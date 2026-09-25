//! schema 迁移行为。

mod common;

use common::open_db;
use folio_core::FontIdentityId;
use folio_storage::{FolioDatabase, StorageError, CURRENT_SCHEMA_VERSION};

#[test]
fn empty_database_migrates_to_current() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db = open_db(dir.path());
    assert_eq!(
        db.schema_version().expect("version"),
        CURRENT_SCHEMA_VERSION
    );
    assert_eq!(CURRENT_SCHEMA_VERSION, 7);
}

#[test]
fn reopening_current_schema_is_not_destructive() {
    let dir = tempfile::tempdir().expect("tempdir");
    let id = {
        let db = open_db(dir.path());
        db.add_root(dir.path(), true).expect("add root");
        db.list_roots().expect("roots")[0].id
    };

    let reopened = open_db(dir.path());
    assert_eq!(
        reopened.schema_version().expect("version"),
        CURRENT_SCHEMA_VERSION
    );
    let roots = reopened.list_roots().expect("roots");
    assert_eq!(roots.len(), 1);
    assert_eq!(roots[0].id, id);
}

#[test]
fn v5_user_data_survives_sync_migration() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("folio.sqlite");
    let identity = FontIdentityId::from_bytes([7; 16]);
    let root_id;
    let collection_id;
    {
        let mut db = FolioDatabase::open(&path).expect("open");
        db.add_root(dir.path(), true).expect("root");
        root_id = db.list_roots().expect("roots")[0].id;
        collection_id = db.create_collection("常用字体").expect("collection").id;
        db.set_favorite(identity, true).expect("favorite");
        db.add_collection_members(collection_id, &[identity])
            .expect("member");
        db.record_recent(identity).expect("recent");
    }
    {
        let conn = rusqlite::Connection::open(&path).expect("open v5");
        conn.execute_batch(
            "DROP TABLE sync_conflicts; DROP TABLE sync_remote_cursors; DROP TABLE sync_assets; DROP TABLE sync_events; \
             DROP TABLE sync_metadata; PRAGMA user_version = 5;",
        )
        .expect("restore v5 schema");
    }
    let migrated = FolioDatabase::open(&path).expect("migrate");
    assert_eq!(migrated.schema_version().unwrap(), 7);
    assert_eq!(migrated.list_roots().unwrap()[0].id, root_id);
    assert_eq!(migrated.list_collections().unwrap()[0].id, collection_id);
    assert_eq!(migrated.list_favorites().unwrap(), vec![identity]);
    assert_eq!(
        migrated.list_collection_members(collection_id).unwrap(),
        vec![identity]
    );
    assert_eq!(migrated.list_recent(10).unwrap()[0].identity_id, identity);
    assert!(migrated.list_sync_events().unwrap().is_empty());
    assert_eq!(migrated.sync_remote_cursor("device").unwrap(), 0);
}

#[test]
fn incomplete_v6_sync_schema_is_repaired_without_losing_data() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("folio.sqlite");
    let identity = FontIdentityId::from_bytes([9; 16]);
    let root_id;
    {
        let mut db = FolioDatabase::open(&path).expect("open");
        db.add_root(dir.path(), true).expect("root");
        root_id = db.list_roots().unwrap()[0].id;
        db.set_favorite(identity, true).expect("favorite");
        db.set_sync_metadata("device_id", "existing-device")
            .expect("metadata");
    }
    {
        let conn = rusqlite::Connection::open(&path).expect("open v6");
        conn.execute_batch("DROP TABLE sync_remote_cursors; PRAGMA user_version = 6;")
            .expect("simulate incomplete v6");
    }

    let db = FolioDatabase::open(&path).expect("repair");
    assert_eq!(db.schema_version().unwrap(), 7);
    assert_eq!(db.sync_remote_cursor("other-device").unwrap(), 0);
    assert_eq!(db.list_roots().unwrap()[0].id, root_id);
    assert_eq!(db.list_favorites().unwrap(), vec![identity]);
    assert_eq!(
        db.sync_metadata("device_id").unwrap().as_deref(),
        Some("existing-device")
    );
}

#[test]
fn future_schema_version_is_refused() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("future.sqlite");
    {
        let conn = rusqlite::Connection::open(&path).expect("create");
        conn.pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION + 1)
            .expect("bump version");
    }

    let error = FolioDatabase::open(&path).expect_err("must refuse newer schema");
    match error {
        StorageError::DatabaseTooNew { found, supported } => {
            assert_eq!(found, CURRENT_SCHEMA_VERSION + 1);
            assert_eq!(supported, CURRENT_SCHEMA_VERSION);
        }
        other => panic!("unexpected error: {other:?}"),
    }
}

#[test]
fn failed_migration_leaves_no_half_migrated_state() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("conflict.sqlite");
    {
        // 预先存在同名表会让首个迁移步骤失败。版本必须保持 0，
        // 且该外部对象不得被改动。
        let conn = rusqlite::Connection::open(&path).expect("create");
        conn.execute_batch("CREATE TABLE library_roots (bogus TEXT)")
            .expect("create conflicting table");
    }

    let error = FolioDatabase::open(&path).expect_err("migration must fail");
    assert!(
        matches!(error, StorageError::Migration { from: 0, to: 1, .. }),
        "unexpected error: {error:?}"
    );

    let conn = rusqlite::Connection::open(&path).expect("reopen");
    let version: i32 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("version");
    assert_eq!(version, 0, "failed migration must not bump the version");

    let columns: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('library_roots')",
            [],
            |row| row.get(0),
        )
        .expect("columns");
    assert_eq!(columns, 1, "foreign table must be untouched");
}

#[test]
fn negative_schema_version_is_rejected_without_migration() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("negative.sqlite");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.pragma_update(None, "user_version", i32::MIN).unwrap();
    assert!(matches!(
        FolioDatabase::open(&path),
        Err(StorageError::InvalidSchemaVersion(i32::MIN))
    ));
    assert_eq!(
        conn.query_row::<i32, _, _>("PRAGMA user_version", [], |r| r.get(0))
            .unwrap(),
        i32::MIN
    );
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM sqlite_master", [], |r| r.get(0))
            .unwrap(),
        0
    );
}
