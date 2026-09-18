//! 缓存往返必须完整保留 Phase 1 语义。

mod common;

use common::{
    copy_fixture, open_db, patch_lato_postscript_name, read_fixture, refresh, write_collection,
    write_in,
};
use folio_core::{scan_directory, FontClassification, ScanOptions};
use folio_storage::FolioDatabase;

fn build_library(dir: &std::path::Path) {
    copy_fixture(dir, "Lato-Regular.ttf", "Lato-Regular.ttf");
    copy_fixture(dir, "Lato-Bold.ttf", "Lato-Bold.ttf");
    copy_fixture(dir, "Lato-Italic.ttf", "Lato-Italic.ttf");
    copy_fixture(dir, "SourceSerif4-Regular.otf", "SourceSerif4-Regular.otf");
    copy_fixture(dir, "Inter-Variable.ttf", "Inter-Variable.ttf");
    copy_fixture(dir, "Inter-Regular.woff", "Inter-Regular.woff");
    copy_fixture(dir, "Inter-Regular.woff2", "Inter-Regular.woff2");
    write_collection(dir, "collection.ttc");
    write_in(dir, "not-a-font.ttf", &read_fixture("not-a-font.ttf"));
    let internal = patch_lato_postscript_name(&read_fixture("Lato-Regular.ttf"), ".AppleLato-R");
    write_in(dir, "internal.ttf", &internal);
}

#[test]
fn cached_catalog_matches_a_live_scan_exactly() {
    let library = tempfile::tempdir().expect("library");
    build_library(library.path());

    let scanned = scan_directory(library.path(), &ScanOptions::default()).expect("live scan");

    let db_dir = tempfile::tempdir().expect("db");
    let mut db = open_db(db_dir.path());
    common::add_root(&mut db, library.path());
    let result = refresh(&mut db);
    assert_eq!(result.catalog, scanned.catalog);

    // 关闭后重新打开，仅从 SQLite 加载。
    drop(db);
    let reopened = open_db(db_dir.path());
    let cached = reopened.load_cached_catalog().expect("cached catalog");
    assert_eq!(cached, scanned.catalog);
}

#[test]
fn round_trip_preserves_key_semantics() {
    let library = tempfile::tempdir().expect("library");
    build_library(library.path());
    let scanned = scan_directory(library.path(), &ScanOptions::default()).expect("scan");

    let db_dir = tempfile::tempdir().expect("db");
    let mut db = open_db(db_dir.path());
    common::add_root(&mut db, library.path());
    refresh(&mut db);
    drop(db);
    let cached = open_db(db_dir.path())
        .load_cached_catalog()
        .expect("cached");

    assert_eq!(cached.family_count(), scanned.catalog.family_count());
    assert_eq!(cached.face_count(), scanned.catalog.face_count());

    // TTC 多面往返。
    let ttc_faces = scanned
        .catalog
        .faces()
        .filter(|face| {
            face.sources
                .iter()
                .any(|source| source.path().ends_with("collection.ttc"))
        })
        .count();
    assert_eq!(ttc_faces, 2, "both collection members survive round trip");

    // 本地化名称保留。
    let has_localized = cached
        .faces()
        .any(|face| !face.metadata.localized_names.is_empty());
    assert!(has_localized);

    // 可变轴保留。
    let inter = cached
        .faces()
        .find(|face| {
            face.metadata
                .postscript_name
                .as_deref()
                .is_some_and(|name| name.starts_with("Inter"))
                && face.metadata.is_variable
        })
        .expect("Inter variable face");
    let scanned_inter = scanned
        .catalog
        .faces()
        .find(|face| face.id == inter.id)
        .expect("same face in scan");
    assert!(!inter.metadata.variable_axes.is_empty());
    assert_eq!(
        inter.metadata.variable_axes,
        scanned_inter.metadata.variable_axes
    );
    assert_eq!(
        inter.metadata.named_instances,
        scanned_inter.metadata.named_instances
    );

    // 分类保留。
    let internal = cached
        .faces()
        .find(|face| {
            face.metadata
                .postscript_name
                .as_deref()
                .is_some_and(|name| name.starts_with('.'))
        })
        .expect("internal face");
    assert_eq!(internal.classification, FontClassification::Internal);

    // 身份、修订与面标识精确保留。
    for face in cached.faces() {
        let scanned_face = scanned
            .catalog
            .faces()
            .find(|candidate| candidate.id == face.id)
            .expect("face id survives");
        assert_eq!(face.identity_id, scanned_face.identity_id);
        assert_eq!(face.revision_id, scanned_face.revision_id);
        assert_eq!(face.sources, scanned_face.sources);
    }
}

#[test]
fn known_unsupported_is_not_turned_into_malformed() {
    let library = tempfile::tempdir().expect("library");
    copy_fixture(library.path(), "Inter-Regular.woff", "a.woff");
    copy_fixture(library.path(), "Inter-Regular.woff2", "b.woff2");

    let db_dir = tempfile::tempdir().expect("db");
    let mut db = open_db(db_dir.path());
    common::add_root(&mut db, library.path());
    let result = refresh(&mut db);

    assert_eq!(result.stats.known_unsupported, 2);
    assert_eq!(result.stats.malformed_files, 0);
    assert_eq!(result.catalog.face_count(), 0);
}

#[test]
fn cached_catalog_is_deterministic() {
    let library = tempfile::tempdir().expect("library");
    build_library(library.path());
    let db_dir = tempfile::tempdir().expect("db");
    let mut db = open_db(db_dir.path());
    common::add_root(&mut db, library.path());
    refresh(&mut db);

    let first = db.load_cached_catalog().expect("first");
    let second = db.load_cached_catalog().expect("second");
    assert_eq!(first, second);

    let first_json = serde_json::to_string(&first).expect("json");
    let second_json = serde_json::to_string(&second).expect("json");
    assert_eq!(first_json, second_json);

    let result = refresh(&mut db);
    assert_eq!(
        result.catalog, first,
        "no-op refresh keeps the catalog stable"
    );
}

#[test]
fn database_can_be_reopened_by_path() {
    let library = tempfile::tempdir().expect("library");
    copy_fixture(library.path(), "Lato-Regular.ttf", "Lato-Regular.ttf");
    let db_dir = tempfile::tempdir().expect("db");
    let path = db_dir.path().join("explicit.sqlite");

    {
        let mut db = FolioDatabase::open(&path).expect("open");
        db.add_root(library.path(), true).expect("add");
        refresh(&mut db);
    }
    let db = FolioDatabase::open(&path).expect("reopen");
    assert_eq!(db.load_cached_catalog().expect("catalog").face_count(), 1);
}
