//! 缓存损坏处理，以及字体由合法变为非法时的转换。

mod common;

use common::{add_root, copy_fixture, open_db, refresh, write_in};
use folio_storage::{RefreshMode, StorageError};

#[test]
fn corrupt_payload_is_reported_then_repaired() {
    let library = tempfile::tempdir().expect("library");
    copy_fixture(library.path(), "Lato-Regular.ttf", "Lato-Regular.ttf");

    let db_dir = tempfile::tempdir().expect("db");
    let mut db = open_db(db_dir.path());
    add_root(&mut db, library.path());
    refresh(&mut db);

    // 在进程运行期间破坏缓存载荷。
    {
        let conn = rusqlite::Connection::open(db_dir.path().join("folio.sqlite")).expect("conn");
        conn.execute(
            "UPDATE source_files SET payload = X'0000' WHERE status = 'parsed'",
            [],
        )
        .expect("corrupt");
    }

    let error = db
        .load_cached_catalog()
        .expect_err("strict load must surface corruption");
    assert!(matches!(error, StorageError::CorruptCache { .. }));

    let repaired = refresh(&mut db);
    assert_eq!(repaired.stats.cache_corrupt_rows, 1);
    assert_eq!(repaired.stats.files_reparsed, 1);
    assert_eq!(repaired.catalog.face_count(), 1);
    assert_eq!(db.load_cached_catalog().expect("repaired").face_count(), 1);
}

#[test]
fn valid_font_turned_invalid_is_replaced_not_stale() {
    let library = tempfile::tempdir().expect("library");
    let path = copy_fixture(library.path(), "Lato-Regular.ttf", "Lato-Regular.ttf");

    let db_dir = tempfile::tempdir().expect("db");
    let mut db = open_db(db_dir.path());
    add_root(&mut db, library.path());
    let first = refresh(&mut db);
    let before = first.catalog.faces().next().expect("face").clone();

    std::fs::write(&path, b"this is no longer a font").expect("overwrite");
    let broken = refresh(&mut db);
    assert_eq!(broken.stats.malformed_files, 1);
    assert_eq!(broken.catalog.face_count(), 0, "stale face must disappear");
    assert!(
        !broken
            .catalog
            .faces()
            .any(|face| face.revision_id == before.revision_id),
        "the old revision must not survive a failed reparse"
    );

    let conn = rusqlite::Connection::open(db.path()).unwrap();
    let (status, payload, hash): (String, Option<Vec<u8>>, Vec<u8>) = conn
        .query_row(
            "SELECT status, payload, content_hash FROM source_files",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(status, "malformed");
    assert!(payload.is_none());
    assert_eq!(hash, blake3::hash(b"this is no longer a font").as_bytes());
    assert_eq!(db.load_cached_catalog().unwrap().face_count(), 0);

    // 失败结果也会缓存，因此未变化的坏文件不会重新解析。
    let cached = refresh(&mut db);
    assert_eq!(cached.stats.metadata_cache_hits, 1);
    assert_eq!(cached.stats.files_reparsed, 0);
    assert_eq!(cached.stats.malformed_files, 1);
    assert_eq!(cached.catalog.face_count(), 0);
}

#[test]
fn rebuild_ignores_cache_and_reparses() {
    let library = tempfile::tempdir().expect("library");
    copy_fixture(library.path(), "Lato-Regular.ttf", "Lato-Regular.ttf");
    write_in(library.path(), "bad.ttf", b"not a font");

    let db_dir = tempfile::tempdir().expect("db");
    let mut db = open_db(db_dir.path());
    add_root(&mut db, library.path());
    refresh(&mut db);

    let rebuilt = db.refresh(RefreshMode::Rebuild).expect("rebuild");
    assert_eq!(
        rebuilt.stats.files_reparsed, 2,
        "rebuild reparses everything"
    );
    assert_eq!(rebuilt.stats.metadata_cache_hits, 0);
    assert_eq!(rebuilt.catalog.face_count(), 1);
}
