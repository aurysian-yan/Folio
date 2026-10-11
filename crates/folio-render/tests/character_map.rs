#[path = "../../folio-core/tests/common/mod.rs"]
mod common;

use base64::{engine::general_purpose::STANDARD, Engine};
use folio_core::{scan_directory, FontFace, ScanOptions};
use folio_render::{
    CharacterMapService, GlyphImage, OpenCharacterMap, QueryCharacterMap, RenderCharacterMapError,
    RenderRequest,
};
use read_fonts::{FontRef, TableProvider};
use skrifa::MetadataProvider;
use std::collections::BTreeMap;

fn setup(data: &[u8]) -> (tempfile::TempDir, FontFace, CharacterMapService, String) {
    // 上游位图样本没有 cmap，为其实际字形补充测试编码。
    let reference = FontRef::new(data).unwrap();
    let complete = if reference.cmap().is_err() {
        let count = reference.maxp().unwrap().num_glyphs() as u32;
        let mut cmap = vec![0, 0, 0, 1, 0, 3, 0, 10, 0, 0, 0, 12];
        cmap.extend(12u16.to_be_bytes());
        cmap.extend(0u16.to_be_bytes());
        cmap.extend(28u32.to_be_bytes());
        cmap.extend(0u32.to_be_bytes());
        cmap.extend(1u32.to_be_bytes());
        cmap.extend(0xe001u32.to_be_bytes());
        cmap.extend((0xe000 + count - 1).to_be_bytes());
        cmap.extend(1u32.to_be_bytes());
        common::replace_table(data, b"cmap", Some(&cmap))
    } else {
        data.to_vec()
    };
    let data = complete.as_slice();
    let dir = tempfile::tempdir().unwrap();
    common::write_in(dir.path(), "sample.ttf", data);
    let catalog = scan_directory(dir.path(), &ScanOptions::default())
        .unwrap()
        .catalog;
    let face = catalog.faces().next().unwrap().clone();
    let service = CharacterMapService::default();
    let handle = service
        .open(&face, &selection(&face))
        .unwrap_or_else(|error| panic!("sample {} bytes: {error}", data.len()))
        .handle;
    (dir, face, service, handle)
}

fn selection(face: &FontFace) -> OpenCharacterMap {
    OpenCharacterMap {
        face_id: face.id.to_string(),
        revision_id: face.revision_id.to_string(),
        source_path: face.sources[0].path().to_string_lossy().into_owned(),
    }
}
fn query(handle: &str, text: &str) -> QueryCharacterMap {
    QueryCharacterMap {
        handle: handle.into(),
        text: text.into(),
        script: None,
        offset: 0,
        limit: 256,
    }
}
fn request(handle: &str, glyph_ids: Vec<u32>) -> RenderRequest {
    RenderRequest {
        handle: handle.into(),
        glyph_ids,
        axes: BTreeMap::new(),
        size: 128,
        foreground: [20, 100, 200, 255],
    }
}
fn pixels(image: &GlyphImage) -> image::RgbaImage {
    let url = image.data_url.as_ref().unwrap();
    let data = STANDARD.decode(url.split_once(',').unwrap().1).unwrap();
    image::load_from_memory(&data).unwrap().to_rgba8()
}

#[test]
fn ordinary_cff_and_blank_glyphs_use_exact_mapping_and_transparency() {
    for name in ["Lato-Regular.ttf", "SourceSerif4-Regular.otf"] {
        let (_dir, _face, service, handle) = setup(&common::read_fixture(name));
        let a = service.query(&query(&handle, "A")).unwrap().entries[0].glyph_id;
        let space = service.query(&query(&handle, " ")).unwrap().entries[0].glyph_id;
        let images = service.render(&request(&handle, vec![a, space])).unwrap();
        assert_eq!(images[0].status, "ready");
        assert_eq!(images[1].status, "empty");
        let pixels = pixels(&images[0]);
        assert!(pixels.pixels().any(|pixel| pixel[3] == 0));
        assert!(pixels
            .pixels()
            .any(|pixel| pixel[3] == 255 && pixel[0] == 20 && pixel[1] == 100 && pixel[2] == 200));
    }
}

#[test]
fn variable_axes_change_pixels_and_invalid_axes_are_rejected() {
    let (_dir, _face, service, handle) = setup(&common::read_fixture("Inter-Variable.ttf"));
    let glyph = service.query(&query(&handle, "A")).unwrap().entries[0].glyph_id;
    let mut input = request(&handle, vec![glyph]);
    input.axes.insert("wght".into(), 100.0);
    let light = service.render(&input).unwrap();
    input.axes.insert("wght".into(), 900.0);
    let heavy = service.render(&input).unwrap();
    assert_ne!(light[0].data_url, heavy[0].data_url);
    input.axes.insert("wght".into(), 10000.0);
    assert_eq!(
        service.render(&input).unwrap_err(),
        RenderCharacterMapError::InvalidAxes
    );
}

#[test]
fn color_and_embedded_bitmap_samples_have_visible_pixels() {
    for data in [
        font_test_data::COLRV0V1,
        font_test_data::COLRV0V1_VARIABLE,
        font_test_data::COLR_GRADIENT_RECT,
        font_test_data::CBDT,
        font_test_data::NOTO_HANDWRITING_SBIX,
    ] {
        let (_dir, _face, service, handle) = setup(data);
        let page = service.query(&query(&handle, "")).unwrap();
        let glyphs: Vec<_> = page.entries.iter().map(|entry| entry.glyph_id).collect();
        assert!(!glyphs.is_empty());
        let images = service.render(&request(&handle, glyphs)).unwrap();
        assert!(
            images.iter().any(|image| image.status == "ready"),
            "sample has no visible glyphs: {:?}",
            images
                .iter()
                .map(|image| (&image.status, image.glyph_id))
                .collect::<Vec<_>>()
        );
        assert!(images
            .iter()
            .filter(|image| image.status == "ready")
            .all(|image| pixels(image).pixels().any(|pixel| pixel[3] > 0)));
    }
}

#[test]
fn snapshots_reject_replacement_deletion_unknown_source_and_closed_handles() {
    let (dir, face, service, handle) = setup(&common::read_fixture("Lato-Regular.ttf"));
    let mut wrong = selection(&face);
    wrong.source_path = dir.path().join("other.ttf").to_string_lossy().into_owned();
    assert_eq!(
        service.open(&face, &wrong).unwrap_err(),
        RenderCharacterMapError::SourceUnavailable
    );
    common::write_in(
        dir.path(),
        "sample.ttf",
        &common::read_fixture("Lato-Bold.ttf"),
    );
    assert_eq!(
        service.query(&query(&handle, "A")).unwrap_err(),
        RenderCharacterMapError::StaleSource
    );
    assert_eq!(
        service.open(&face, &selection(&face)).unwrap_err(),
        RenderCharacterMapError::StaleSource
    );
    std::fs::remove_file(face.sources[0].path()).unwrap();
    assert_eq!(
        service.query(&query(&handle, "A")).unwrap_err(),
        RenderCharacterMapError::SourceUnavailable
    );
    service.close(&handle);
    service.close(&handle);
    assert_eq!(
        service.query(&query(&handle, "A")).unwrap_err(),
        RenderCharacterMapError::SessionClosed
    );
}

#[test]
fn json_contract_defaults_and_render_limits_are_enforced() {
    let (_dir, _face, service, handle) = setup(&common::read_fixture("Lato-Regular.ttf"));
    let input: QueryCharacterMap = serde_json::from_value(serde_json::json!({
        "handle": handle,
    }))
    .unwrap();
    assert_eq!(input.limit, 256);
    let page = service.query(&input).unwrap();
    assert_eq!(page.entries.len(), 256);
    let json = serde_json::to_value(&page).unwrap();
    assert!(json["entries"][0].get("glyphId").is_some());
    assert!(json["entries"][0].get("glyph_id").is_none());
    let glyph = page.entries[0].glyph_id;
    for size in [0, 15, 1025, u32::MAX] {
        let mut input = request(&handle, vec![glyph]);
        input.size = size;
        assert_eq!(
            service.render(&input).unwrap_err(),
            RenderCharacterMapError::InvalidQuery
        );
    }
    for glyphs in [vec![glyph; 257], vec![u32::MAX]] {
        assert_eq!(
            service.render(&request(&handle, glyphs)).unwrap_err(),
            RenderCharacterMapError::InvalidQuery
        );
    }
    let mut input = request(&handle, vec![glyph]);
    input.axes.insert("wght".into(), 500.0);
    assert_eq!(
        service.render(&input).unwrap_err(),
        RenderCharacterMapError::InvalidAxes
    );
    assert_eq!(
        service.render(&request(&handle, vec![glyph])).unwrap()[0].glyph_id,
        glyph
    );
}

#[test]
fn closing_one_snapshot_preserves_others_and_releases_session_capacity() {
    let (_dir, face, service, first) = setup(&common::read_fixture("Lato-Regular.ttf"));
    let mut handles = vec![first];
    for _ in 1..8 {
        handles.push(service.open(&face, &selection(&face)).unwrap().handle);
    }
    assert_eq!(
        service.open(&face, &selection(&face)).unwrap_err(),
        RenderCharacterMapError::SessionClosed
    );
    service.close(&handles[0]);
    assert_eq!(
        service.render(&request(&handles[0], vec![])).unwrap_err(),
        RenderCharacterMapError::SessionClosed
    );
    assert!(!service
        .query(&query(&handles[1], "A"))
        .unwrap()
        .entries
        .is_empty());
    let replacement = service.open(&face, &selection(&face)).unwrap().handle;
    assert!(!handles.contains(&replacement));
    for handle in handles.into_iter().chain([replacement]) {
        service.close(&handle);
    }
}

fn svg_font(documents: &[(u16, &str)]) -> Vec<u8> {
    let font = common::read_fixture("Lato-Regular.ttf");
    let mut table = vec![0, 0, 0, 0, 0, 10, 0, 0, 0, 0];
    table.extend((documents.len() as u16).to_be_bytes());
    let mut offset = 2 + documents.len() as u32 * 12;
    for (glyph, document) in documents {
        table.extend(glyph.to_be_bytes());
        table.extend(glyph.to_be_bytes());
        table.extend(offset.to_be_bytes());
        table.extend((document.len() as u32).to_be_bytes());
        offset += document.len() as u32;
    }
    for (_, document) in documents {
        table.extend(document.as_bytes());
    }
    common::replace_table(&font, b"SVG ", Some(&table))
}

#[test]
fn svg_retains_color_and_alpha_and_isolates_a_corrupt_glyph() {
    let base = common::read_fixture("Lato-Regular.ttf");
    let font = FontRef::new(&base).unwrap();
    let a = font.charmap().map('A').unwrap().to_u32();
    let b = font.charmap().map('B').unwrap().to_u32();
    let c = font.charmap().map('C').unwrap().to_u32();
    let document = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000"><g id="glyph{a}"><rect x="100" y="-1200" width="900" height="900" fill="red" fill-opacity="0.5"/></g></svg>"#
    );
    let data = svg_font(&[(a as u16, &document), (b as u16, "<invalid")]);
    let (_dir, _face, service, handle) = setup(&data);
    let images = service.render(&request(&handle, vec![a, b, c])).unwrap();
    assert_eq!(images[0].status, "ready");
    assert_eq!(images[1].status, "error");
    assert_eq!(images[2].status, "ready");
    assert!(pixels(&images[0])
        .pixels()
        .any(|pixel| pixel[0] > 250 && pixel[1] == 0 && (126..=129).contains(&pixel[3])));
    assert!(pixels(&images[0]).pixels().any(|pixel| pixel[3] == 0));
}

#[test]
fn svg_external_resources_are_not_loaded() {
    let dir = tempfile::tempdir().unwrap();
    let external = dir.path().join("external.png");
    image::RgbaImage::from_pixel(200, 200, image::Rgba([255, 0, 0, 255]))
        .save(&external)
        .unwrap();
    let base = common::read_fixture("Lato-Regular.ttf");
    let glyph = FontRef::new(&base)
        .unwrap()
        .charmap()
        .map('A')
        .unwrap()
        .to_u32();
    let document = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000"><g id="glyph{glyph}"><image href="{}" x="0" y="-1000" width="1000" height="1000"/></g></svg>"#,
        external.display()
    );
    let data = svg_font(&[(glyph as u16, &document)]);
    let (_dir, _face, service, handle) = setup(&data);
    let images = service.render(&request(&handle, vec![glyph])).unwrap();
    assert_ne!(images[0].status, "ready");
}

#[test]
fn color_gradient_contains_distinct_colors_and_transparency() {
    let (_dir, _face, service, handle) = setup(font_test_data::COLR_GRADIENT_RECT);
    let glyphs = service
        .query(&query(&handle, ""))
        .unwrap()
        .entries
        .into_iter()
        .map(|entry| entry.glyph_id)
        .collect();
    let mut input = request(&handle, glyphs);
    input.size = 512;
    let images = service.render(&input).unwrap();
    let image = images.iter().find(|image| image.status == "ready").unwrap();
    let pixels = pixels(image);
    assert!(pixels.pixels().any(|pixel| pixel[3] == 0));
    let colors: std::collections::BTreeSet<_> = pixels
        .pixels()
        .filter(|pixel| pixel[3] > 128)
        .map(|pixel| [pixel[0], pixel[1], pixel[2]])
        .collect();
    assert!(
        colors.len() > 10,
        "gradient colors: {colors:?}; glyph {}, status {}",
        image.glyph_id,
        image.status
    );
}

#[test]
fn monochrome_ebdt_and_bgra_cbdt_are_decoded_with_alpha() {
    let base = common::read_fixture("Lato-Regular.ttf");
    let glyph = FontRef::new(&base)
        .unwrap()
        .charmap()
        .map('A')
        .unwrap()
        .to_u32() as u16;
    for depth in [1u8, 32] {
        let mut bitmap = vec![0, 2, 0, 0, 8, 8, 0, 8, 8];
        if depth == 1 {
            bitmap.extend([0x7e; 8]);
        } else {
            for _ in 0..64 {
                bitmap.extend([0, 0, 128, 128]);
            }
        }
        let mut location = vec![0, 2, 0, 0, 0, 0, 0, 1];
        location.extend(56u32.to_be_bytes());
        location.extend(24u32.to_be_bytes());
        location.extend(1u32.to_be_bytes());
        location.extend(0u32.to_be_bytes());
        location.extend([0; 24]);
        location.extend(glyph.to_be_bytes());
        location.extend(glyph.to_be_bytes());
        location.extend([16, 16, depth, 1]);
        location.extend(glyph.to_be_bytes());
        location.extend(glyph.to_be_bytes());
        location.extend(8u32.to_be_bytes());
        location.extend(1u16.to_be_bytes());
        location.extend(1u16.to_be_bytes());
        location.extend(4u32.to_be_bytes());
        location.extend(0u32.to_be_bytes());
        location.extend(((bitmap.len() - 4) as u32).to_be_bytes());
        let data = common::replace_table(
            &base,
            if depth == 1 { b"EBDT" } else { b"CBDT" },
            Some(&bitmap),
        );
        let data = common::replace_table(
            &data,
            if depth == 1 { b"EBLC" } else { b"CBLC" },
            Some(&location),
        );
        let (_dir, _face, service, handle) = setup(&data);
        let images = service
            .render(&request(&handle, vec![glyph as u32]))
            .unwrap();
        assert_eq!(images[0].status, "ready");
        let pixels = pixels(&images[0]);
        if depth == 32 {
            assert!(pixels
                .pixels()
                .any(|pixel| pixel[0] > 250 && pixel[1] == 0 && (120..=140).contains(&pixel[3])));
        } else {
            assert!(pixels
                .pixels()
                .any(|pixel| pixel[0] == 20 && pixel[1] == 100 && pixel[3] == 255));
        }
    }
}

#[test]
fn svg_palette_variables_use_first_palette_and_keep_alpha() {
    let base = common::read_fixture("Lato-Regular.ttf");
    let glyph = FontRef::new(&base)
        .unwrap()
        .charmap()
        .map('A')
        .unwrap()
        .to_u32();
    let document = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000"><g id="glyph{glyph}"><rect x="100" y="-1200" width="900" height="900" fill="var(--color0, currentColor)"/></g></svg>"#
    );
    let data = svg_font(&[(glyph as u16, &document)]);
    let palette = [0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 14, 0, 0, 200, 100, 50, 128];
    let data = common::replace_table(&data, b"CPAL", Some(&palette));
    let (_dir, _face, service, handle) = setup(&data);
    let images = service.render(&request(&handle, vec![glyph])).unwrap();
    assert_eq!(images[0].status, "ready");
    assert!(pixels(&images[0])
        .pixels()
        .any(|pixel| (49..=51).contains(&pixel[0])
            && (99..=101).contains(&pixel[1])
            && (199..=201).contains(&pixel[2])
            && pixel[3] == 128));
}

#[test]
fn collection_renderer_uses_nonzero_cff_member() {
    let original = common::read_fixture("SourceSerif4-Regular.otf");
    let collection =
        common::collection(&[common::read_fixture("Lato-Regular.ttf"), original.clone()]);
    let dir = tempfile::tempdir().unwrap();
    common::write_in(dir.path(), "sample.otc", &collection);
    let catalog = scan_directory(dir.path(), &ScanOptions::default())
        .unwrap()
        .catalog;
    let face = catalog
        .faces()
        .find(|face| face.sources[0].face_index() == 1)
        .unwrap();
    let service = CharacterMapService::default();
    let info = service.open(face, &selection(face)).unwrap();
    assert_eq!(info.face_index, 1);
    let glyph = service.query(&query(&info.handle, "A")).unwrap().entries[0].glyph_id;
    let actual = service.render(&request(&info.handle, vec![glyph])).unwrap();
    let (_dir, _face, service, handle) = setup(&original);
    let expected = service.render(&request(&handle, vec![glyph])).unwrap();
    assert_eq!(actual[0].data_url, expected[0].data_url);
}

#[test]
fn sbix_png_jpeg_tiff_and_duplicate_glyphs_are_decoded() {
    let base = common::read_fixture("Lato-Regular.ttf");
    let font = FontRef::new(&base).unwrap();
    let a = font.charmap().map('A').unwrap().to_u32();
    let b = font.charmap().map('B').unwrap().to_u32();
    let count = font.maxp().unwrap().num_glyphs() as u32;
    for (format, tag) in [
        (image::ImageFormat::Png, b"png "),
        (image::ImageFormat::Jpeg, b"jpg "),
        (image::ImageFormat::Tiff, b"tiff"),
    ] {
        let mut encoded = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            32,
            32,
            image::Rgb([200, 50, 100]),
        ))
        .write_to(&mut encoded, format)
        .unwrap();
        let mut strike = vec![0, 128, 0, 72];
        let mut offset = 4 + (count + 1) * 4;
        let mut contents = Vec::new();
        for glyph in 0..=count {
            strike.extend(offset.to_be_bytes());
            let mut record = vec![0, 0, 0, 0];
            if glyph == a {
                record.extend(tag);
                record.extend(encoded.get_ref());
            } else if glyph == b {
                record.extend(b"dupe");
                record.extend((a as u16).to_be_bytes());
            } else {
                continue;
            }
            offset += record.len() as u32;
            contents.extend(record);
        }
        strike.extend(contents);
        let mut sbix = vec![0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 12];
        sbix.extend(strike);
        let data = common::replace_table(&base, b"sbix", Some(&sbix));
        let (_dir, _face, service, handle) = setup(&data);
        let images = service.render(&request(&handle, vec![a, b])).unwrap();
        assert!(images.iter().all(|image| image.status == "ready"));
        assert!(images.iter().all(|image| pixels(image)
            .pixels()
            .any(|pixel| pixel[0] > 150 && pixel[1] < 80 && pixel[3] == 255)));
    }
}

#[test]
fn composite_ebdt_decodes_components_and_rejects_cycles_per_glyph() {
    let base = common::read_fixture("Lato-Regular.ttf");
    let font = FontRef::new(&base).unwrap();
    let a = font.charmap().map('A').unwrap().to_u32() as u16;
    let b = font.charmap().map('B').unwrap().to_u32() as u16;
    for cyclic in [false, true] {
        let mut composite = vec![8, 16, 0, 8, 16, 0, 0, 2];
        composite.extend(if cyclic { a } else { b }.to_be_bytes());
        composite.extend([0, 0]);
        composite.extend(b.to_be_bytes());
        composite.extend([8, 0]);
        let mut child = vec![8, 8, 0, 8, 8];
        child.extend([0x7e; 8]);
        let mut data = vec![0, 2, 0, 0];
        data.extend(&composite);
        data.extend(&child);
        let mut location = vec![0, 2, 0, 0, 0, 0, 0, 1];
        location.extend(56u32.to_be_bytes());
        location.extend(48u32.to_be_bytes());
        location.extend(2u32.to_be_bytes());
        location.extend(0u32.to_be_bytes());
        location.extend([0; 24]);
        location.extend(a.min(b).to_be_bytes());
        location.extend(a.max(b).to_be_bytes());
        location.extend([16, 16, 1, 1]);
        for (glyph, offset) in [(a, 16u32), (b, 32u32)] {
            location.extend(glyph.to_be_bytes());
            location.extend(glyph.to_be_bytes());
            location.extend(offset.to_be_bytes());
        }
        for (format, start, length) in [
            (8u16, 4u32, composite.len()),
            (1, 4 + composite.len() as u32, child.len()),
        ] {
            location.extend(1u16.to_be_bytes());
            location.extend(format.to_be_bytes());
            location.extend(start.to_be_bytes());
            location.extend(0u32.to_be_bytes());
            location.extend((length as u32).to_be_bytes());
        }
        let data = common::replace_table(&base, b"EBDT", Some(&data));
        let data = common::replace_table(&data, b"EBLC", Some(&location));
        let (_dir, _face, service, handle) = setup(&data);
        let images = service
            .render(&request(&handle, vec![a as u32, b as u32]))
            .unwrap();
        assert_eq!(images[0].status, if cyclic { "error" } else { "ready" });
        assert_eq!(images[1].status, "ready");
    }
}
