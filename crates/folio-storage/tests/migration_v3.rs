//! 旧目录记录到文件来源 schema 的迁移。

mod common;

use common::{copy_fixture, open_db};
use folio_storage::{LibraryRootKind, RefreshMode};
use rusqlite::Connection;

#[test]
fn v2_directory_and_cache_survive_v3_migration() {
    let dir = tempfile::tempdir().unwrap();
    let fonts = dir.path().join("fonts");
    std::fs::create_dir(&fonts).unwrap();
    copy_fixture(&fonts, "Lato-Regular.ttf", "font.ttf");
    let db = open_db(dir.path());
    let root = match db.add_root(&fonts, true).unwrap() {
        folio_storage::AddRootOutcome::Created(root) => root,
        folio_storage::AddRootOutcome::Existing(_) => panic!("new root"),
    };
    drop(db);
    let path = dir.path().join("folio.sqlite");
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(
        "DROP INDEX source_files_path; ALTER TABLE library_roots DROP COLUMN kind; PRAGMA user_version = 2;",
    )
    .unwrap();
    drop(conn);

    let mut reopened = open_db(dir.path());
    assert_eq!(reopened.schema_version().unwrap(), 5);
    let roots = reopened.list_roots().unwrap();
    assert_eq!(roots.len(), 1);
    assert_eq!(roots[0].id, root.id);
    assert_eq!(roots[0].kind, LibraryRootKind::Directory);
    assert_eq!(
        reopened
            .refresh(RefreshMode::Incremental)
            .unwrap()
            .catalog
            .face_count(),
        1
    );
}
