//! 存储状态快照到查询层的端到端语义。
use folio_query::*;
use folio_storage::{FolioDatabase, RefreshMode};
fn fixture() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/fonts/Lato-Regular.ttf")
}
#[test]
fn real_overlapping_roots_and_durable_scopes_survive_source_move_and_identity_change() {
    let dir = tempfile::tempdir().unwrap();
    let outer = dir.path().join("outer");
    let inner = outer.join("inner");
    std::fs::create_dir_all(&inner).unwrap();
    let path = inner.join("font.ttf");
    std::fs::copy(fixture(), &path).unwrap();
    let mut db = FolioDatabase::open(dir.path().join("library.sqlite")).unwrap();
    db.add_root(&outer, true).unwrap();
    db.add_root(&inner, true).unwrap();
    let roots = db.list_roots().unwrap();
    let first = db.refresh(RefreshMode::Incremental).unwrap();
    let original = first.catalog.faces().next().unwrap().identity_id;
    let c = db.create_collection("School").unwrap();
    db.add_collection_members(c.id, &[original]).unwrap();
    db.set_favorite(original, true).unwrap();
    db.record_recent(original).unwrap();
    let recent = db.list_recent(10).unwrap();
    let snapshot = db.library_state_snapshot().unwrap();
    assert_eq!(snapshot.roots.len(), 2);
    let index = FontQueryIndex::build(&first.catalog, &snapshot).unwrap();
    let q = FontQuery {
        facets: FacetFilter {
            roots: roots.iter().map(|r| r.id.into()).collect(),
            ..Default::default()
        },
        ..Default::default()
    };
    let r = index.query(&q).unwrap();
    assert_eq!(r.total_matches, 1);
    assert_eq!(r.families[0].matched_face_ids.len(), 1);
    assert!(index.health().identities.is_empty());
    for scope in [
        QueryScope::All,
        QueryScope::Favorites,
        QueryScope::Recent,
        QueryScope::Collection(c.id),
    ] {
        let result = index
            .query(&FontQuery {
                scope,
                text: Some("Lato Regular".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(result.total_matches, 1);
        assert!(result.unresolved_scope_items.is_empty());
    }
    assert_eq!(db.list_recent(10).unwrap(), recent);
    let moved = outer.join("renamed.ttf");
    std::fs::rename(&path, &moved).unwrap();
    let after = db.refresh(RefreshMode::Incremental).unwrap();
    assert_eq!(after.catalog.faces().next().unwrap().identity_id, original);
    let index =
        FontQueryIndex::build(&after.catalog, &db.library_state_snapshot().unwrap()).unwrap();
    assert_eq!(
        index
            .query(&FontQuery {
                scope: QueryScope::Favorites,
                ..Default::default()
            })
            .unwrap()
            .total_matches,
        1
    );
    std::fs::remove_file(&moved).unwrap();
    let empty = db.refresh(RefreshMode::Incremental).unwrap();
    let index =
        FontQueryIndex::build(&empty.catalog, &db.library_state_snapshot().unwrap()).unwrap();
    for scope in [
        QueryScope::Favorites,
        QueryScope::Recent,
        QueryScope::Collection(c.id),
    ] {
        let r = index
            .query(&FontQuery {
                scope,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(r.total_matches, 0);
        assert_eq!(r.unresolved_scope_items, vec![original]);
    }
    // 真正不同的逻辑字体不能接管旧引用。
    std::fs::copy(fixture().with_file_name("Lato-Bold.ttf"), &moved).unwrap();
    let other = db.refresh(RefreshMode::Incremental).unwrap();
    assert_ne!(other.catalog.faces().next().unwrap().identity_id, original);
    let index =
        FontQueryIndex::build(&other.catalog, &db.library_state_snapshot().unwrap()).unwrap();
    assert_eq!(
        index
            .query(&FontQuery {
                scope: QueryScope::Favorites,
                ..Default::default()
            })
            .unwrap()
            .unresolved_scope_items,
        vec![original]
    );
    assert_eq!(db.list_recent(10).unwrap(), recent);
}
