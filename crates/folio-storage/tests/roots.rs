//! 库根目录增删查与路径编解码往返。

mod common;

use common::open_db;
use folio_storage::AddRootOutcome;

#[test]
fn add_is_deterministic_for_duplicate_paths() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db = open_db(dir.path());

    let first = db.add_root(dir.path(), true).expect("first add");
    let created = match first {
        AddRootOutcome::Created(root) => root,
        AddRootOutcome::Existing(_) => panic!("first add must create"),
    };
    assert_eq!(created.path, dir.path());
    assert!(created.recursive);
    assert!(created.path_is_lossless);

    let second = db.add_root(dir.path(), false).expect("second add");
    match second {
        AddRootOutcome::Existing(root) => assert_eq!(root.id, created.id),
        AddRootOutcome::Created(_) => panic!("duplicate add must not create"),
    }
    assert_eq!(db.list_roots().expect("list").len(), 1);
}

#[test]
fn recursive_flag_is_persisted_and_updatable() {
    let dir = tempfile::tempdir().expect("tempdir");
    let inner = dir.path().join("inner");
    std::fs::create_dir_all(&inner).expect("mkdir");

    let id = {
        let db = open_db(dir.path());
        let root = match db.add_root(dir.path(), false).expect("add outer") {
            AddRootOutcome::Created(root) => root,
            AddRootOutcome::Existing(_) => panic!("new"),
        };
        let inner_root = match db.add_root(&inner, true).expect("add inner") {
            AddRootOutcome::Created(root) => root,
            AddRootOutcome::Existing(_) => panic!("new"),
        };
        assert!(!root.recursive);
        assert!(inner_root.recursive);
        db.set_root_recursive(root.id, true).expect("update");
        root.id
    };

    let reopened = open_db(dir.path());
    let roots = reopened.list_roots().expect("list");
    assert_eq!(roots.len(), 2);
    let outer = roots.iter().find(|root| root.id == id).expect("outer");
    assert!(outer.recursive, "updated flag must persist");
}

#[test]
fn remove_root_deletes_its_cache_but_not_others() {
    let dir = tempfile::tempdir().expect("tempdir");
    let a = dir.path().join("a");
    let b = dir.path().join("b");
    std::fs::create_dir_all(&a).expect("mkdir a");
    std::fs::create_dir_all(&b).expect("mkdir b");
    common::copy_fixture(&a, "Lato-Regular.ttf", "a.ttf");
    common::copy_fixture(&b, "Lato-Bold.ttf", "b.ttf");

    let mut db = open_db(dir.path());
    let root_a = match db.add_root(&a, true).expect("add a") {
        AddRootOutcome::Created(root) => root,
        AddRootOutcome::Existing(_) => panic!("new"),
    };
    db.add_root(&b, true).expect("add b");
    common::refresh(&mut db);

    assert_eq!(db.load_cached_catalog().expect("catalog").face_count(), 2);

    assert!(db.remove_root(root_a.id).expect("remove"));
    let catalog = db.load_cached_catalog().expect("catalog");
    assert_eq!(catalog.face_count(), 1, "only root A's face disappears");
    assert_eq!(db.list_roots().expect("roots").len(), 1);
    assert!(db.get_root(root_a.id).expect("get").is_none());
}

#[test]
fn clear_catalog_cache_keeps_library_roots() {
    let dir = tempfile::tempdir().expect("tempdir");
    let fonts = dir.path().join("fonts");
    std::fs::create_dir_all(&fonts).expect("mkdir");
    common::copy_fixture(&fonts, "Lato-Regular.ttf", "Lato-Regular.ttf");

    let mut db = open_db(dir.path());
    let root = common::add_root(&mut db, &fonts);
    common::refresh(&mut db);
    assert_eq!(db.load_cached_catalog().expect("catalog").face_count(), 1);

    let removed = db.clear_catalog_cache().expect("clear");
    assert!(removed >= 1);
    assert!(db
        .load_cached_catalog()
        .expect("catalog")
        .faces()
        .next()
        .is_none());

    let roots = db.list_roots().expect("roots");
    assert_eq!(roots.len(), 1);
    assert_eq!(roots[0].id, root.id);

    // 清空后仍可从根目录重建。
    let result = db
        .refresh(folio_storage::RefreshMode::Rebuild)
        .expect("rebuild");
    assert_eq!(result.catalog.face_count(), 1);
}

#[test]
#[cfg(unix)]
fn non_utf8_root_path_round_trips() {
    use std::ffi::OsString;
    use std::os::unix::ffi::OsStringExt;

    let dir = tempfile::tempdir().expect("tempdir");
    let mut raw = dir.path().as_os_str().as_encoded_bytes().to_vec();
    raw.extend_from_slice(&[b'/', 0xff, 0xfe, b'f', b'o', b'n', b't', b's']);
    let root_path = std::path::PathBuf::from(OsString::from_vec(raw));

    // macOS/APFS 会以 EILSEQ 拒绝非 UTF-8 文件名。当主机无法创建该极端
    // 路径时，编解码本身仍由 `path_codec` 单元测试覆盖；此处文件系统
    // 往返如实记为未验证，而不是伪造通过。
    match std::fs::create_dir_all(&root_path) {
        Ok(()) => {}
        Err(error) => {
            eprintln!(
                "NOT VERIFIED on this host: non-UTF-8 filesystem paths are rejected ({error}); \
                 the codec is covered by unit tests"
            );
            return;
        }
    }
    common::copy_fixture(&root_path, "Lato-Regular.ttf", "Lato-Regular.ttf");

    let mut db = open_db(dir.path());
    let root = common::add_root(&mut db, &root_path);
    assert!(root.path_is_lossless);
    assert_eq!(root.path, root_path);

    let result = common::refresh(&mut db);
    assert_eq!(result.catalog.face_count(), 1);

    let reopened = open_db(dir.path());
    let roots = reopened.list_roots().expect("roots");
    assert_eq!(roots.len(), 1);
    assert!(roots[0].path_is_lossless);
    assert_eq!(roots[0].path, root_path);

    let face = reopened
        .load_cached_catalog()
        .expect("catalog")
        .faces()
        .next()
        .expect("face")
        .clone();
    assert!(
        face.sources[0].path().starts_with(&root_path),
        "non-UTF-8 source path must round trip"
    );
}
