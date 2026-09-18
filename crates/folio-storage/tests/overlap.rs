//! 重叠根目录与跨根目录的家族分组。

mod common;

use common::{add_root, copy_fixture, open_db, refresh};

#[test]
fn overlapping_roots_do_not_duplicate_a_source() {
    let library = tempfile::tempdir().expect("library");
    let nested = library.path().join("nested");
    std::fs::create_dir_all(&nested).expect("mkdir");
    copy_fixture(&nested, "Lato-Regular.ttf", "Font.ttf");

    let db_dir = tempfile::tempdir().expect("db");
    let mut db = open_db(db_dir.path());
    add_root(&mut db, library.path());
    let nested_root = add_root(&mut db, &nested);

    let result = refresh(&mut db);
    assert_eq!(result.catalog.face_count(), 1);
    let face = result.catalog.faces().next().expect("face");
    assert_eq!(face.sources.len(), 1, "same file must not appear twice");

    // 删除嵌套根目录不得删除父根目录仍覆盖的字体。
    assert!(db.remove_root(nested_root.id).expect("remove nested"));
    let after = refresh(&mut db);
    assert_eq!(after.catalog.face_count(), 1);
    assert_eq!(after.catalog.faces().next().expect("face").sources.len(), 1);
}

#[test]
fn family_grouping_spans_directories_and_roots() {
    let library = tempfile::tempdir().expect("library");
    let a = library.path().join("a");
    let b = library.path().join("b");
    std::fs::create_dir_all(&a).expect("mkdir a");
    std::fs::create_dir_all(&b).expect("mkdir b");
    copy_fixture(&a, "Lato-Regular.ttf", "Lato-Regular.ttf");
    copy_fixture(&b, "Lato-Bold.ttf", "Lato-Bold.ttf");

    let db_dir = tempfile::tempdir().expect("db");
    let mut db = open_db(db_dir.path());
    add_root(&mut db, &a);
    add_root(&mut db, &b);

    let result = refresh(&mut db);
    assert_eq!(result.catalog.family_count(), 1, "one global family");
    let family = &result.catalog.families[0];
    assert_eq!(family.display_name.as_deref(), Some("Lato"));
    assert_eq!(family.faces.len(), 2);
}
