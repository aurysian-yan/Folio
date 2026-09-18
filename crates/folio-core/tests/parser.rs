//! Parser behavior: formats, metadata, collections, malformed input and
//! WOFF/WOFF2 recognition.

mod common;

use common::{fixture, read_fixture, write_in};
use folio_core::{parse_font_data, parse_font_file, FontError, FontFormat, FontStyle};

#[test]
fn parses_truetype_font_metadata() {
    let parsed = parse_font_file(fixture("Lato-Regular.ttf")).expect("Lato should parse");
    assert_eq!(parsed.format, FontFormat::TrueType);
    assert_eq!(parsed.faces.len(), 1);

    let face = &parsed.faces[0];
    assert_eq!(face.face_index, 0);
    assert_eq!(face.format, FontFormat::TrueType);
    assert_eq!(
        face.metadata.postscript_name.as_deref(),
        Some("Lato-Regular")
    );
    assert_eq!(face.metadata.family_name.as_deref(), Some("Lato"));
    assert_eq!(face.metadata.subfamily_name.as_deref(), Some("Regular"));
    assert_eq!(face.metadata.full_name.as_deref(), Some("Lato Regular"));
    assert_eq!(
        face.metadata.weight.map(|w| w.value()),
        Some(400.0),
        "Lato Regular should declare weight 400"
    );
    assert_eq!(face.metadata.style, FontStyle::Normal);
    assert!(face.metadata.units_per_em.is_some());
    assert!(!face.metadata.is_variable);
    assert!(face.metadata.variable_axes.is_empty());
    assert!(!face.metadata.localized_names.is_empty());
    assert!(face.metadata.font_version.head_revision.is_some());
}

#[test]
fn parses_bold_and_italic_styles() {
    let bold = parse_font_file(fixture("Lato-Bold.ttf")).expect("Lato Bold should parse");
    assert_eq!(
        bold.faces[0].metadata.weight.map(|w| w.value()),
        Some(700.0)
    );
    assert_eq!(bold.faces[0].metadata.style, FontStyle::Normal);

    let italic = parse_font_file(fixture("Lato-Italic.ttf")).expect("Lato Italic should parse");
    assert_eq!(italic.faces[0].metadata.style, FontStyle::Italic);
    assert_eq!(
        italic.faces[0].metadata.subfamily_name.as_deref(),
        Some("Italic")
    );
}

#[test]
fn parses_cff_open_type_font() {
    let parsed =
        parse_font_file(fixture("SourceSerif4-Regular.otf")).expect("Source Serif should parse");
    assert_eq!(parsed.format, FontFormat::OpenType);
    assert_eq!(parsed.faces.len(), 1);
    let face = &parsed.faces[0];
    assert_eq!(face.format, FontFormat::OpenType);
    assert_eq!(
        face.metadata.postscript_name.as_deref(),
        Some("SourceSerif4-Regular")
    );
    assert_eq!(face.metadata.family_name.as_deref(), Some("Source Serif 4"));
    assert!(!face.metadata.is_variable);
}

#[test]
fn identifies_variable_font_and_axes() {
    let parsed = parse_font_file(fixture("Inter-Variable.ttf")).expect("Inter should parse");
    let face = &parsed.faces[0];
    assert!(face.metadata.is_variable, "Inter is a variable font");
    assert!(!face.metadata.variable_axes.is_empty());

    let wght = face
        .metadata
        .variable_axes
        .iter()
        .find(|axis| axis.tag == "wght")
        .expect("Inter declares a wght axis");
    assert!(wght.min_value <= 100.0);
    assert!(wght.max_value >= 900.0);
    assert!(wght.min_value <= wght.default_value && wght.default_value <= wght.max_value);
    assert!(wght.name.is_some());

    let opsz = face
        .metadata
        .variable_axes
        .iter()
        .find(|axis| axis.tag == "opsz")
        .expect("Inter declares an opsz axis");
    assert!(opsz.max_value > opsz.min_value);
}

#[test]
fn parses_collection_with_multiple_faces() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = write_in(dir.path(), "collection.ttc", font_test_data::ttc::TTC);

    let parsed = parse_font_file(&path).expect("TTC should parse");
    assert_eq!(parsed.format, FontFormat::TrueTypeCollection);
    assert_eq!(parsed.faces.len(), 2);
    assert!(parsed.problems.is_empty());

    for (index, face) in parsed.faces.iter().enumerate() {
        assert_eq!(face.face_index, index as u32);
        assert_eq!(face.format, FontFormat::TrueType);
        assert_eq!(face.source.face_index(), index as u32);
        assert_eq!(face.revision.face_discriminator, Some(index as u32));
    }
    assert_eq!(
        parsed.faces[0].metadata.family_name.as_deref(),
        parsed.faces[1].metadata.family_name.as_deref()
    );

    dir.close().expect("cleanup tempdir");
}

#[test]
fn rejects_non_font_content_with_font_extension() {
    let error = parse_font_data(
        std::path::Path::new("renamed.ttf"),
        b"this is plain text, not a font",
        29,
        None,
    )
    .expect_err("plain text must not parse");
    assert!(matches!(error, FontError::UnknownFormat { .. }));
}

#[test]
fn recognizes_woff_as_known_unsupported() {
    let data = read_fixture("Inter-Regular.woff");
    let error = parse_font_data(
        std::path::Path::new("font.woff"),
        &data,
        data.len() as u64,
        None,
    )
    .expect_err("WOFF is not supported in phase 1");
    match error {
        FontError::UnsupportedFormat {
            format, planned, ..
        } => {
            assert_eq!(format, FontFormat::Woff);
            assert_eq!(planned, "Folio v2");
        }
        other => panic!("expected UnsupportedFormat, got {other:?}"),
    }
}

#[test]
fn recognizes_woff2_as_known_unsupported() {
    let data = read_fixture("Inter-Regular.woff2");
    let error = parse_font_data(
        std::path::Path::new("font.woff2"),
        &data,
        data.len() as u64,
        None,
    )
    .expect_err("WOFF2 is not supported in phase 1");
    match error {
        FontError::UnsupportedFormat {
            format, planned, ..
        } => {
            assert_eq!(format, FontFormat::Woff2);
            assert_eq!(planned, "Folio v2");
        }
        other => panic!("expected UnsupportedFormat, got {other:?}"),
    }
}

#[test]
fn format_comes_from_content_not_extension() {
    // A WOFF renamed to .ttf must still be recognized as WOFF.
    let data = read_fixture("Inter-Regular.woff");
    let error = parse_font_data(
        std::path::Path::new("fake.ttf"),
        &data,
        data.len() as u64,
        None,
    )
    .expect_err("WOFF content must win over the extension");
    assert!(matches!(
        error,
        FontError::UnsupportedFormat {
            format: FontFormat::Woff,
            ..
        }
    ));
}

#[test]
fn empty_file_is_reported_as_empty() {
    let error = parse_font_data(std::path::Path::new("empty.ttf"), &[], 0, None)
        .expect_err("empty file must not parse");
    assert!(matches!(error, FontError::EmptyFile { .. }));
}

#[test]
fn localized_names_keep_language_tags() {
    let parsed = parse_font_file(fixture("Lato-Regular.ttf")).expect("Lato should parse");
    let family_names: Vec<_> = parsed.faces[0]
        .metadata
        .localized_names
        .iter()
        .filter(|name| name.kind == folio_core::NameKind::Family)
        .collect();
    assert!(family_names.iter().any(|name| name.language.is_some()));
    assert!(family_names.iter().all(|name| name.value == "Lato"));
}
