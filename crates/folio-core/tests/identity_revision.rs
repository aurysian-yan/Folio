//! Stable IDs, content fingerprints, identity and revision semantics.

mod common;

use common::{copy_fixture, fixture, read_fixture, write_in};
use folio_core::{parse_font_file, ContentFingerprint};

#[test]
fn fingerprint_only_depends_on_content() {
    let a = ContentFingerprint::from_bytes(b"same bytes");
    let b = ContentFingerprint::from_bytes(b"same bytes");
    let c = ContentFingerprint::from_bytes(b"other bytes");
    assert_eq!(a, b);
    assert_ne!(a, c);
    assert_eq!(a.to_hex().len(), 64);
}

#[test]
fn stable_ids_are_deterministic_for_identical_input() {
    let path = fixture("Lato-Regular.ttf");
    let first = parse_font_file(&path).expect("first parse");
    let second = parse_font_file(&path).expect("second parse");
    let a = &first.faces[0];
    let b = &second.faces[0];
    assert_eq!(first.fingerprint, second.fingerprint);
    assert_eq!(a.id, b.id);
    assert_eq!(a.identity.id, b.identity.id);
    assert_eq!(a.revision.id, b.revision.id);
}

#[test]
fn copy_to_another_path_keeps_fingerprint_identity_and_revision() {
    let original = parse_font_file(fixture("Lato-Regular.ttf")).expect("original parse");
    let dir = tempfile::tempdir().expect("tempdir");
    let copied_path = copy_fixture(dir.path(), "Lato-Regular.ttf", "moved-and-renamed.ttf");
    let copied = parse_font_file(&copied_path).expect("copied parse");

    assert_eq!(original.fingerprint, copied.fingerprint);
    assert_eq!(original.faces[0].id, copied.faces[0].id);
    assert_eq!(original.faces[0].identity.id, copied.faces[0].identity.id);
    assert_eq!(original.faces[0].revision.id, copied.faces[0].revision.id);
    assert_eq!(
        original.faces[0].metadata.postscript_name,
        copied.faces[0].metadata.postscript_name
    );
}

#[test]
fn changed_content_changes_revision_but_not_identity() {
    // 只验证二进制变更的不变量，不模拟字体编译器输出。
    let mut data = read_fixture("Lato-Regular.ttf");
    let dir = tempfile::tempdir().expect("tempdir");
    let original_path = write_in(dir.path(), "original.ttf", &data);
    let original = parse_font_file(&original_path).expect("original parse");

    data.push(0);
    let reexport_path = write_in(dir.path(), "reexport.ttf", &data);
    let reexport = parse_font_file(&reexport_path).expect("re-export parse");

    assert_ne!(original.fingerprint, reexport.fingerprint);
    assert_eq!(
        original.faces[0].identity.id, reexport.faces[0].identity.id,
        "identity is metadata based and must survive a re-export"
    );
    assert_ne!(
        original.faces[0].revision.id, reexport.faces[0].revision.id,
        "revision must change when the binary changes"
    );
    assert_ne!(original.faces[0].id, reexport.faces[0].id);
}

#[test]
fn ids_are_domain_separated() {
    let parsed = parse_font_file(fixture("Lato-Regular.ttf")).expect("parse");
    let face = &parsed.faces[0];
    assert_ne!(face.identity.id.as_bytes(), face.revision.id.as_bytes());
    assert_ne!(face.revision.id.as_bytes(), face.id.as_bytes());
    assert_ne!(face.identity.id.as_bytes(), face.id.as_bytes());
}

#[test]
fn collection_faces_share_content_but_not_revision() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = write_in(dir.path(), "collection.ttc", font_test_data::ttc::TTC);
    let parsed = parse_font_file(&path).expect("TTC parse");
    assert_eq!(parsed.faces.len(), 2);
    assert_eq!(parsed.faces[0].identity.id, parsed.faces[1].identity.id);
    assert_eq!(
        parsed.faces[0].revision.content_fingerprint, parsed.faces[1].revision.content_fingerprint,
        "all members share the file level fingerprint"
    );
    assert_ne!(
        parsed.faces[0].revision.id, parsed.faces[1].revision.id,
        "the collection index discriminates member revisions"
    );
}
