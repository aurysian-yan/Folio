//! 增量决策：元数据快路径、内容快路径、重新解析、增删、重命名，以及
//! 已知不支持与损坏字体的缓存。

mod common;

use common::{add_root, bump_mtime, copy_fixture, open_db, read_fixture, refresh, write_in};
use folio_core::FontFace;

fn only_face(catalog: &folio_core::Catalog, postscript: &str) -> FontFace {
    catalog
        .faces()
        .find(|face| face.metadata.postscript_name.as_deref() == Some(postscript))
        .unwrap_or_else(|| panic!("face {postscript} not found"))
        .clone()
}

#[test]
fn unchanged_second_refresh_uses_metadata_cache() {
    let library = tempfile::tempdir().expect("library");
    copy_fixture(library.path(), "Lato-Regular.ttf", "Lato-Regular.ttf");
    copy_fixture(
        library.path(),
        "SourceSerif4-Regular.otf",
        "SourceSerif4-Regular.otf",
    );
    copy_fixture(library.path(), "Inter-Variable.ttf", "Inter-Variable.ttf");

    let db_dir = tempfile::tempdir().expect("db");
    let mut db = open_db(db_dir.path());
    add_root(&mut db, library.path());

    let first = refresh(&mut db);
    assert_eq!(first.stats.candidate_files, 3);
    assert_eq!(first.stats.files_reparsed, 3);
    assert_eq!(first.stats.files_hashed, 3);
    assert_eq!(first.stats.metadata_cache_hits, 0);

    let second = refresh(&mut db);
    assert_eq!(second.stats.candidate_files, 3);
    assert_eq!(
        second.stats.metadata_cache_hits, 3,
        "every unchanged file must be a metadata cache hit"
    );
    assert_eq!(second.stats.files_hashed, 0, "no file may be re-read");
    assert_eq!(second.stats.files_reparsed, 0, "no file may be reparsed");
    assert_eq!(second.stats.content_cache_hits, 0);
    assert_eq!(second.catalog, first.catalog);
}

#[test]
fn touch_only_rehashes_without_reparsing() {
    let library = tempfile::tempdir().expect("library");
    copy_fixture(library.path(), "Lato-Regular.ttf", "Lato-Regular.ttf");
    copy_fixture(library.path(), "Lato-Bold.ttf", "Lato-Bold.ttf");

    let db_dir = tempfile::tempdir().expect("db");
    let mut db = open_db(db_dir.path());
    add_root(&mut db, library.path());
    let first = refresh(&mut db);

    bump_mtime(&library.path().join("Lato-Regular.ttf"));
    let second = refresh(&mut db);

    assert_eq!(second.stats.metadata_cache_hits, 1);
    assert_eq!(second.stats.files_hashed, 1);
    assert_eq!(second.stats.content_cache_hits, 1);
    assert_eq!(
        second.stats.files_reparsed, 0,
        "same bytes must not reparse"
    );
    assert_eq!(second.stats.files_changed, 0);
    assert_eq!(
        second.catalog,
        db.load_cached_catalog().expect("same snapshot")
    );
    let folio_core::FontSource::LocalFile { modified, .. } =
        &only_face(&second.catalog, "Lato-Regular").sources[0];
    assert_eq!(
        *modified,
        Some(
            std::fs::metadata(library.path().join("Lato-Regular.ttf"))
                .unwrap()
                .modified()
                .unwrap()
        )
    );

    // 来源 mtime 改变，但语义保持不变。
    let before = only_face(&first.catalog, "Lato-Regular");
    let after = only_face(&second.catalog, "Lato-Regular");
    assert_eq!(before.id, after.id);
    assert_eq!(before.identity_id, after.identity_id);
    assert_eq!(before.revision_id, after.revision_id);
}

#[test]
fn changed_content_reparses_but_keeps_identity() {
    let library = tempfile::tempdir().expect("library");
    let path = copy_fixture(library.path(), "Lato-Regular.ttf", "Lato-Regular.ttf");

    let db_dir = tempfile::tempdir().expect("db");
    let mut db = open_db(db_dir.path());
    add_root(&mut db, library.path());
    let first = refresh(&mut db);
    let before = only_face(&first.catalog, "Lato-Regular");

    let data = common::valid_revision(&read_fixture("Lato-Regular.ttf"));
    std::fs::write(&path, data).expect("mutate font");
    bump_mtime(&path);

    let second = refresh(&mut db);
    assert_eq!(second.stats.files_reparsed, 1);
    assert_eq!(second.stats.files_changed, 1);
    assert_eq!(second.stats.files_added, 0);

    let after = only_face(&second.catalog, "Lato-Regular");
    assert_eq!(
        before.identity_id, after.identity_id,
        "identity survives re-export"
    );
    assert_ne!(before.revision_id, after.revision_id, "revision changes");
    assert_ne!(before.id, after.id, "face id changes with the revision");
    assert!(
        !second
            .catalog
            .faces()
            .any(|face| face.revision_id == before.revision_id),
        "the old source must not still point at the old revision"
    );
}

#[test]
fn add_and_remove_sources() {
    let library = tempfile::tempdir().expect("library");
    let a = copy_fixture(library.path(), "Lato-Regular.ttf", "a.ttf");

    let db_dir = tempfile::tempdir().expect("db");
    let mut db = open_db(db_dir.path());
    add_root(&mut db, library.path());
    refresh(&mut db);

    copy_fixture(library.path(), "SourceSerif4-Regular.otf", "b.otf");
    let added = refresh(&mut db);
    assert_eq!(added.stats.files_added, 1);
    assert_eq!(added.stats.files_reparsed, 1);
    assert_eq!(added.catalog.face_count(), 2);

    std::fs::remove_file(&a).expect("remove a");
    let removed = refresh(&mut db);
    assert_eq!(removed.stats.files_removed, 1);
    assert_eq!(removed.stats.files_reparsed, 0);
    assert_eq!(removed.catalog.face_count(), 1);
    let face = removed.catalog.faces().next().expect("remaining face");
    assert!(face.sources[0].path().ends_with("b.otf"));
}

#[test]
fn rename_and_move_keep_identity_revision_and_fingerprint() {
    let library = tempfile::tempdir().expect("library");
    let original = copy_fixture(library.path(), "Lato-Regular.ttf", "a/font.ttf");

    let db_dir = tempfile::tempdir().expect("db");
    let mut db = open_db(db_dir.path());
    add_root(&mut db, library.path());
    let first = refresh(&mut db);
    let before = only_face(&first.catalog, "Lato-Regular");

    let target_dir = library.path().join("b");
    std::fs::create_dir_all(&target_dir).expect("mkdir b");
    let target = target_dir.join("renamed.ttf");
    std::fs::rename(&original, &target).expect("move");

    let second = refresh(&mut db);
    let after = only_face(&second.catalog, "Lato-Regular");
    assert_eq!(before.id, after.id);
    assert_eq!(before.identity_id, after.identity_id);
    assert_eq!(before.revision_id, after.revision_id);
    assert_eq!(before.sources.len(), 1);
    assert_eq!(after.sources.len(), 1);
    assert!(after.sources[0].path().ends_with("b/renamed.ttf"));
    assert!(
        !after
            .sources
            .iter()
            .any(|source| source.path().ends_with("a/font.ttf")),
        "old path must not remain"
    );
}

#[test]
fn known_unsupported_is_cached_without_reparsing() {
    let library = tempfile::tempdir().expect("library");
    copy_fixture(library.path(), "Inter-Regular.woff", "a.woff");
    copy_fixture(library.path(), "Inter-Regular.woff2", "b.woff2");

    let db_dir = tempfile::tempdir().expect("db");
    let mut db = open_db(db_dir.path());
    add_root(&mut db, library.path());

    let first = refresh(&mut db);
    assert_eq!(first.stats.known_unsupported, 2);
    assert_eq!(first.stats.files_reparsed, 2);

    let second = refresh(&mut db);
    assert_eq!(second.stats.known_unsupported, 2);
    assert_eq!(second.stats.metadata_cache_hits, 2);
    assert_eq!(second.stats.files_reparsed, 0);
    assert_eq!(second.stats.malformed_files, 0);
    assert_eq!(second.catalog.face_count(), 0);
}

#[test]
fn malformed_result_is_cached_deterministically() {
    let library = tempfile::tempdir().expect("library");
    write_in(library.path(), "bad.ttf", &read_fixture("not-a-font.ttf"));

    let db_dir = tempfile::tempdir().expect("db");
    let mut db = open_db(db_dir.path());
    add_root(&mut db, library.path());

    let first = refresh(&mut db);
    assert_eq!(first.stats.malformed_files, 1);
    assert_eq!(first.stats.failed_files, 1);

    let second = refresh(&mut db);
    assert_eq!(second.stats.metadata_cache_hits, 1);
    assert_eq!(second.stats.files_reparsed, 0);
    assert_eq!(second.stats.malformed_files, 1);
    assert_eq!(second.stats.failed_files, 1);
    assert_eq!(first.issues, second.issues);
    assert_eq!(second.catalog.face_count(), 0);
}

#[test]
fn clearing_cache_then_rebuild_restores_catalog() {
    let library = tempfile::tempdir().expect("library");
    copy_fixture(library.path(), "Lato-Regular.ttf", "Lato-Regular.ttf");

    let db_dir = tempfile::tempdir().expect("db");
    let mut db = open_db(db_dir.path());
    add_root(&mut db, library.path());
    let first = refresh(&mut db);

    db.clear_catalog_cache().expect("clear");
    assert!(db
        .load_cached_catalog()
        .expect("empty")
        .faces()
        .next()
        .is_none());

    let rebuilt = db
        .refresh(folio_storage::RefreshMode::Rebuild)
        .expect("rebuild");
    assert_eq!(rebuilt.stats.files_reparsed, 1);
    assert_eq!(rebuilt.catalog, first.catalog);
}
