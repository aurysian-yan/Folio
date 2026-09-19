//! 持久用户状态、事务与目录生命周期回归。
mod common;
use common::*;
use folio_core::{resolve_identities, Catalog, CollectionId, FontIdentityId};
use folio_storage::{RefreshMode, StorageError};
fn id(n: u8) -> FontIdentityId {
    FontIdentityId::from_bytes([n; 16])
}

#[test]
fn collections_keep_display_names_and_stable_random_ids() {
    let dir = tempfile::tempdir().unwrap();
    let db = open_db(dir.path());
    let a = db.create_collection("  CAFÉ\u{a0} Fonts  ").unwrap();
    assert_eq!(a.name, "  CAFÉ\u{a0} Fonts  ");
    assert!(matches!(
        db.create_collection("cafe\u{301} fonts"),
        Err(StorageError::CollectionNameConflict)
    ));
    assert!(matches!(
        db.create_collection(" \n\t"),
        Err(StorageError::InvalidCollectionName)
    ));
    let b = db.create_collection("Other").unwrap();
    assert_ne!(a.id, b.id);
    assert!(matches!(
        db.rename_collection(b.id, "café fonts"),
        Err(StorageError::CollectionNameConflict)
    ));
    db.rename_collection(a.id, "School").unwrap();
    let renamed = db
        .list_collections()
        .unwrap()
        .into_iter()
        .find(|c| c.id == a.id)
        .unwrap();
    assert_eq!(renamed.name, "School");
    assert_eq!(renamed.created_at_ns, a.created_at_ns);
    assert!(renamed.updated_at_ns >= a.updated_at_ns);
    db.delete_collection(a.id).unwrap();
    assert_eq!(db.list_collections().unwrap().len(), 1);
    assert!(matches!(
        db.delete_collection(a.id),
        Err(StorageError::CollectionNotFound { .. })
    ));
    assert!(matches!(
        db.rename_collection(a.id, "Again"),
        Err(StorageError::CollectionNotFound { .. })
    ));
}
#[test]
fn membership_bulk_is_idempotent_and_delete_cascades_only_members() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = open_db(dir.path());
    let c = db.create_collection("School").unwrap();
    db.add_collection_members(c.id, &[id(1), id(2), id(1)])
        .unwrap();
    assert_eq!(
        db.list_collection_members(c.id).unwrap(),
        vec![id(1), id(2)]
    );
    db.remove_collection_members(c.id, &[id(2), id(2), id(3)])
        .unwrap();
    assert_eq!(db.list_collection_members(c.id).unwrap(), vec![id(1)]);
    db.set_favorite(id(1), true).unwrap();
    db.record_recent(id(1)).unwrap();
    db.delete_collection(c.id).unwrap();
    assert!(db.is_favorite(id(1)).unwrap());
    assert_eq!(db.list_recent(10).unwrap().len(), 1);
    assert!(matches!(
        db.list_collection_members(c.id),
        Err(StorageError::CollectionNotFound { .. })
    ));
    assert!(matches!(
        db.add_collection_members(CollectionId::from_bytes([9; 16]), &[id(1)]),
        Err(StorageError::CollectionNotFound { .. })
    ));
    let conn = rusqlite::Connection::open(db.path()).unwrap();
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM collection_members", [], |r| r.get(0))
            .unwrap(),
        0
    );
}
#[test]
fn favorites_bulk_true_false_and_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = open_db(dir.path());
    db.bulk_set_favorite(&[id(2), id(1), id(1)], true).unwrap();
    assert_eq!(db.list_favorites().unwrap(), vec![id(1), id(2)]);
    db.set_favorite(id(1), false).unwrap();
    db.set_favorite(id(1), false).unwrap();
    assert!(!db.is_favorite(id(1)).unwrap());
    drop(db);
    let mut db = open_db(dir.path());
    assert_eq!(db.list_favorites().unwrap(), vec![id(2)]);
    db.bulk_set_favorite(&[id(2), id(3)], false).unwrap();
    assert!(db.list_favorites().unwrap().is_empty());
}
#[test]
fn recent_is_explicit_ordered_limited_and_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = open_db(dir.path());
    db.record_recent(id(1)).unwrap();
    let first = db.list_recent(1).unwrap()[0].last_accessed_at_ns;
    db.record_recent(id(2)).unwrap();
    db.record_recent(id(1)).unwrap();
    let recent = db.list_recent(10).unwrap();
    assert_eq!(recent.len(), 2);
    assert_eq!(recent[0].identity_id, id(1));
    assert!(recent[0].last_accessed_at_ns >= first);
    assert!(recent[0].last_accessed_at_ns >= recent[1].last_accessed_at_ns);
    assert_eq!(db.list_recent(1).unwrap().len(), 1);
    assert!(db.list_recent(0).unwrap().is_empty());
    db.load_cached_catalog().unwrap();
    db.refresh(RefreshMode::Incremental).unwrap();
    db.library_state_snapshot().unwrap();
    assert_eq!(recent, db.list_recent(10).unwrap());
    db.clear_recent().unwrap();
    assert!(db.list_recent(10).unwrap().is_empty());
}
#[test]
fn unresolved_state_survives_clear_rebuild_offline_revision_and_root_removal() {
    let dir = tempfile::tempdir().unwrap();
    let fonts = dir.path().join("fonts");
    std::fs::create_dir(&fonts).unwrap();
    let path = copy_fixture(&fonts, "Lato-Regular.ttf", "font.ttf");
    let mut db = open_db(dir.path());
    let root = add_root(&mut db, &fonts);
    let first = refresh(&mut db);
    let face = first.catalog.faces().next().unwrap();
    let identity = face.identity_id;
    let revision = face.revision_id;
    let c = db.create_collection("School").unwrap();
    db.add_collection_members(c.id, &[identity, id(99)])
        .unwrap();
    db.bulk_set_favorite(&[identity, id(99)], true).unwrap();
    db.record_recent(identity).unwrap();
    db.record_recent(id(99)).unwrap();
    let before = db.library_state_snapshot().unwrap();
    assert_eq!(
        resolve_identities(&before.favorites, &first.catalog)
            .iter()
            .filter(|r| !r.resolved)
            .count(),
        1
    );
    db.clear_catalog_cache().unwrap();
    let empty = db.load_cached_catalog().unwrap();
    assert_eq!(
        resolve_identities(&before.favorites, &empty)
            .iter()
            .filter(|r| !r.resolved)
            .count(),
        2
    );
    assert_eq!(db.list_favorites().unwrap(), before.favorites);
    assert_eq!(db.list_collection_members(c.id).unwrap().len(), 2);
    assert_eq!(db.list_recent(10).unwrap(), before.recent);
    let rebuilt = db.refresh(RefreshMode::Rebuild).unwrap();
    assert_eq!(
        rebuilt.catalog.faces().next().unwrap().identity_id,
        identity
    );
    let offline = dir.path().join("offline");
    std::fs::rename(&fonts, &offline).unwrap();
    let unavailable = refresh(&mut db);
    assert_eq!(unavailable.stats.roots_unavailable, 1);
    assert_eq!(db.list_favorites().unwrap(), before.favorites);
    // 离线时清空可重建缓存，持久引用仍保留并变为 unresolved。
    assert_eq!(unavailable.catalog.face_count(), 1);
    db.clear_catalog_cache().unwrap();
    let offline_catalog = refresh(&mut db).catalog;
    assert_eq!(offline_catalog, Catalog::default());
    assert!(!resolve_identities(&[identity], &offline_catalog)[0].resolved);
    assert_eq!(db.list_favorites().unwrap(), before.favorites);
    std::fs::rename(&offline, &fonts).unwrap();
    std::fs::write(&path, valid_revision(&read_fixture("Lato-Regular.ttf"))).unwrap();
    bump_mtime(&path);
    let updated = refresh(&mut db);
    let face = updated.catalog.faces().next().unwrap();
    assert_eq!(face.identity_id, identity);
    assert_ne!(face.revision_id, revision);
    assert_eq!(db.list_recent(10).unwrap(), before.recent);
    assert_eq!(db.list_favorites().unwrap(), before.favorites);
    assert_eq!(db.list_collection_members(c.id).unwrap().len(), 2);
    let warm = refresh(&mut db);
    assert_eq!(warm.stats.metadata_cache_hits, 1);
    assert_eq!(warm.stats.files_hashed, 0);
    assert_eq!(warm.stats.files_reparsed, 0);
    assert_eq!(warm.catalog, db.load_cached_catalog().unwrap());
    db.remove_root(root.id).unwrap();
    assert_eq!(db.list_favorites().unwrap(), before.favorites);
}
#[test]
fn bulk_operations_rollback_when_a_later_write_fails() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = open_db(dir.path());
    let c = db.create_collection("School").unwrap();
    let conn = rusqlite::Connection::open(db.path()).unwrap();
    conn.execute_batch("CREATE TRIGGER stop_favorite BEFORE INSERT ON favorites WHEN NEW.identity_id=zeroblob(16) BEGIN SELECT RAISE(ABORT,'stop'); END; CREATE TRIGGER stop_member BEFORE INSERT ON collection_members WHEN NEW.identity_id=zeroblob(16) BEGIN SELECT RAISE(ABORT,'stop'); END;").unwrap();
    assert!(db.bulk_set_favorite(&[id(1), id(0)], true).is_err());
    assert!(db.list_favorites().unwrap().is_empty());
    assert!(db.add_collection_members(c.id, &[id(1), id(0)]).is_err());
    assert!(db.list_collection_members(c.id).unwrap().is_empty());
    assert_eq!(db.list_collections().unwrap()[0], c);
}
#[test]
fn invalid_stored_identity_is_typed_and_never_deleted() {
    let dir = tempfile::tempdir().unwrap();
    let db = open_db(dir.path());
    let conn = rusqlite::Connection::open(db.path()).unwrap();
    conn.execute_batch("PRAGMA ignore_check_constraints=ON; INSERT INTO favorites VALUES(x'01');")
        .unwrap();
    assert!(matches!(
        db.list_favorites(),
        Err(StorageError::InvalidStoredId { .. })
    ));
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM favorites", [], |r| r.get(0))
            .unwrap(),
        1
    );
}
