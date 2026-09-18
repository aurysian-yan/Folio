//! Family grouping: metadata based, deterministic, never filename based.

mod common;

use common::copy_fixture;
use folio_core::{scan_directory, FontStyle, ScanOptions};

#[test]
fn groups_weights_and_styles_into_one_family() {
    let dir = tempfile::tempdir().expect("tempdir");
    copy_fixture(dir.path(), "Lato-Regular.ttf", "Lato-Regular.ttf");
    copy_fixture(dir.path(), "Lato-Bold.ttf", "Lato-Bold.ttf");
    copy_fixture(dir.path(), "Lato-Italic.ttf", "Lato-Italic.ttf");

    let result = scan_directory(dir.path(), &ScanOptions::default()).expect("scan");
    assert_eq!(result.catalog.family_count(), 1);
    assert_eq!(result.stats.families_created, 1);

    let family = &result.catalog.families[0];
    assert_eq!(family.display_name.as_deref(), Some("Lato"));
    assert_eq!(family.faces.len(), 3);
    assert!(!family.localized_names.is_empty());

    let ordered: Vec<String> = family
        .faces
        .iter()
        .map(|face| face.display_subfamily())
        .collect();
    assert_eq!(ordered, vec!["Regular", "Bold", "Italic"]);

    let bold = family
        .faces
        .iter()
        .find(|face| face.metadata.subfamily_name.as_deref() == Some("Bold"))
        .expect("bold face");
    assert_eq!(bold.metadata.weight.map(|w| w.value()), Some(700.0));
    assert_eq!(bold.metadata.style, FontStyle::Normal);

    let italic = family
        .faces
        .iter()
        .find(|face| face.metadata.subfamily_name.as_deref() == Some("Italic"))
        .expect("italic face");
    assert_eq!(italic.metadata.style, FontStyle::Italic);
}

#[test]
fn does_not_merge_distinct_families() {
    let dir = tempfile::tempdir().expect("tempdir");
    copy_fixture(dir.path(), "Lato-Regular.ttf", "Lato-Regular.ttf");
    copy_fixture(dir.path(), "SourceSerif4-Regular.otf", "serif.otf");
    copy_fixture(dir.path(), "Inter-Variable.ttf", "inter.ttf");

    let result = scan_directory(dir.path(), &ScanOptions::default()).expect("scan");
    assert_eq!(result.catalog.family_count(), 3);

    let names: Vec<Option<&str>> = result
        .catalog
        .families
        .iter()
        .map(|family| family.display_name.as_deref())
        .collect();
    assert_eq!(
        names,
        vec![Some("Inter"), Some("Lato"), Some("Source Serif 4")]
    );

    let inter = result
        .catalog
        .families
        .iter()
        .find(|family| family.display_name.as_deref() == Some("Inter"))
        .expect("Inter family");
    assert!(inter.faces[0].metadata.is_variable);
    assert!(!inter.faces[0].metadata.variable_axes.is_empty());
}

#[test]
fn grouping_ignores_directory_layout() {
    let dir = tempfile::tempdir().expect("tempdir");
    copy_fixture(dir.path(), "Lato-Regular.ttf", "a/one.ttf");
    copy_fixture(dir.path(), "Lato-Bold.ttf", "b/two.ttf");

    let result = scan_directory(dir.path(), &ScanOptions::default()).expect("scan");
    assert_eq!(result.catalog.family_count(), 1);
    assert_eq!(result.catalog.families[0].faces.len(), 2);
}

#[test]
fn grouping_is_stable_regardless_of_enumeration_order() {
    let dir = tempfile::tempdir().expect("tempdir");
    copy_fixture(dir.path(), "Lato-Bold.ttf", "zz-bold.ttf");
    copy_fixture(dir.path(), "Lato-Regular.ttf", "aa-regular.ttf");
    copy_fixture(dir.path(), "Lato-Italic.ttf", "mm-italic.ttf");

    let first = scan_directory(dir.path(), &ScanOptions::default()).expect("first scan");
    let second = scan_directory(dir.path(), &ScanOptions::default()).expect("second scan");
    assert_eq!(first.catalog, second.catalog);
    assert_eq!(first.issues, second.issues);
}
