//! 使用 Phase 2A 实际 schema 与原始二进制载荷测试迁移。
mod common;
use common::*;
use folio_storage::*;
use rusqlite::{params, Connection};
const V1: &str = include_str!("fixtures/schema_v1.sql");
const PAYLOAD: &[u8] = include_bytes!("fixtures/lato_payload_v1.bin");

#[test]
fn real_v1_schema_preserves_roots_cache_and_rebuilds_old_payload() {
    let dir = tempfile::tempdir().unwrap();
    let fonts = dir.path().join("fonts");
    std::fs::create_dir(&fonts).unwrap();
    let file = copy_fixture(&fonts, "Lato-Regular.ttf", "font.ttf");
    let path = dir.path().join("folio.sqlite");
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(V1).unwrap();
    let root = LibraryRootId::for_path(&fonts);
    #[cfg(unix)]
    let (platform, root_bytes, file_bytes) = {
        use std::os::unix::ffi::OsStrExt;
        (
            "unix",
            fonts.as_os_str().as_bytes().to_vec(),
            file.as_os_str().as_bytes().to_vec(),
        )
    };
    #[cfg(windows)]
    let (platform, root_bytes, file_bytes) = {
        use std::os::windows::ffi::OsStrExt;
        (
            "windows",
            fonts
                .as_os_str()
                .encode_wide()
                .flat_map(u16::to_le_bytes)
                .collect::<Vec<_>>(),
            file.as_os_str()
                .encode_wide()
                .flat_map(u16::to_le_bytes)
                .collect::<Vec<_>>(),
        )
    };
    conn.execute(
        "INSERT INTO library_roots VALUES(?1,?2,?3,?4,1,1)",
        params![
            root.as_bytes().as_slice(),
            platform,
            root_bytes,
            fonts.to_string_lossy()
        ],
    )
    .unwrap();
    let bytes = read_fixture("Lato-Regular.ttf");
    let fingerprint = folio_core::ContentFingerprint::from_bytes(&bytes);
    conn.execute("INSERT INTO source_files (root_id,path_platform,path_bytes,display_path,file_size,mtime_ns,content_hash,status,format,payload_version,payload) VALUES(?1,?2,?3,?4,?5,1,?6,'parsed','truetype',1,?7)",params![root.as_bytes().as_slice(),platform,file_bytes,file.to_string_lossy(),bytes.len() as i64,fingerprint.as_bytes().as_slice(),PAYLOAD]).unwrap();
    let mut db = FolioDatabase::open(&path).unwrap();
    assert_eq!(db.schema_version().unwrap(), 5);
    assert_eq!(db.list_roots().unwrap()[0].kind, LibraryRootKind::Directory);
    assert_eq!(db.list_roots().unwrap()[0].id, root);
    assert_eq!(
        conn.query_row::<Vec<u8>, _, _>("SELECT payload FROM source_files", [], |r| r.get(0))
            .unwrap(),
        PAYLOAD
    );
    assert!(matches!(
        db.load_cached_catalog(),
        Err(StorageError::CacheIncompatible { found: Some(1), .. })
    ));
    let identity = folio_core::parse_font_file(&file).unwrap().faces[0]
        .identity
        .id;
    let c = db.create_collection("School").unwrap();
    db.add_collection_members(c.id, &[identity]).unwrap();
    db.set_favorite(identity, true).unwrap();
    db.record_recent(identity).unwrap();
    let r = db.refresh(RefreshMode::Incremental).unwrap();
    assert_eq!(r.catalog.face_count(), 1);
    assert_eq!(r.stats.files_reparsed, 1);
    assert_eq!(r.stats.cache_corrupt_rows, 0);
    assert!(r
        .issues
        .iter()
        .any(|i| i.kind == RefreshIssueKind::CacheIncompatible));
    assert!(!r
        .issues
        .iter()
        .any(|i| i.kind == RefreshIssueKind::CacheCorrupt));
    let warm = db.refresh(RefreshMode::Incremental).unwrap();
    assert_eq!(warm.stats.metadata_cache_hits, 1);
    assert_eq!(warm.stats.files_hashed, 0);
    assert_eq!(warm.stats.files_reparsed, 0);
    assert_eq!(r.catalog, warm.catalog);
    assert!(db.is_favorite(identity).unwrap());
    assert_eq!(db.list_collection_members(c.id).unwrap(), vec![identity]);
    assert_eq!(db.list_recent(10).unwrap().len(), 1);
    drop(db);
    let reopened = FolioDatabase::open(&path).unwrap();
    assert_eq!(reopened.schema_version().unwrap(), 5);
    assert_eq!(reopened.load_cached_catalog().unwrap(), warm.catalog);
}
#[test]
fn failed_v1_to_v2_rolls_back_tables_and_version() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("folio.sqlite");
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(V1).unwrap();
    conn.execute_batch(
        "CREATE TABLE recent_fonts (sentinel TEXT); INSERT INTO recent_fonts VALUES('keep');",
    )
    .unwrap();
    assert!(matches!(
        FolioDatabase::open(&path),
        Err(StorageError::Migration { from: 1, to: 2, .. })
    ));
    assert_eq!(
        conn.query_row::<i64, _, _>("PRAGMA user_version", [], |r| r.get(0))
            .unwrap(),
        1
    );
    assert_eq!(conn.query_row::<i64,_,_>("SELECT count(*) FROM sqlite_master WHERE name IN ('collections','collection_members','favorites')",[],|r|r.get(0)).unwrap(),0);
    assert_eq!(
        conn.query_row::<String, _, _>("SELECT sentinel FROM recent_fonts", [], |r| r.get(0))
            .unwrap(),
        "keep"
    );
}
