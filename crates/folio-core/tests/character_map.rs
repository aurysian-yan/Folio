mod common;

use folio_core::{CharacterMapError, CharacterMapIndex};
use read_fonts::{FontRef, TableProvider};
use skrifa::MetadataProvider;

#[test]
fn pages_are_ordered_complete_and_preserve_unicode_values() {
    for name in [
        "Lato-Regular.ttf",
        "SourceSerif4-Regular.otf",
        "Inter-Variable.ttf",
    ] {
        let bytes = common::read_fixture(name);
        let index = CharacterMapIndex::from_data(&bytes, 0).unwrap();
        let mut entries = Vec::new();
        for offset in (0..index.len()).step_by(256) {
            entries.extend(index.query("", None, offset, 256).unwrap().entries);
        }
        assert_eq!(entries.len(), index.len() as usize);
        assert!(entries
            .windows(2)
            .all(|pair| pair[0].codepoint < pair[1].codepoint));
        let font = FontRef::new(&bytes).unwrap();
        for entry in &entries {
            assert_eq!(
                font.charmap().map(entry.codepoint).unwrap().to_u32(),
                entry.glyph_id
            );
        }
        let space = index.query(" ", None, 0, 256).unwrap();
        assert_eq!(space.entries[0].codepoint, 32);
        let combining = index.query("U+0301", None, 0, 256).unwrap();
        assert_eq!(combining.entries[0].codepoint, 0x301);
        let latin = index.query("", Some("Latin"), 0, 256).unwrap();
        assert!(latin.entries.iter().all(|entry| entry.script == "Latin"));
        assert_eq!(
            index.scripts.iter().map(|script| script.count).sum::<u32>(),
            index.len()
        );
    }
}

#[test]
fn reads_trimmed_and_full_repertoire_cmaps() {
    for data in [
        font_test_data::CMAP6,
        font_test_data::CMAP10,
        font_test_data::CMAP12_FONT1,
        font_test_data::CMAP4_SYMBOL_PUA,
    ] {
        // 上游裁剪样本只保留映射表；使用完整字体的 maxp 验证合法字形范围。
        let font = FontRef::new(data).unwrap();
        let cmap_data = font
            .table_data(read_fonts::types::Tag::new(b"cmap"))
            .unwrap();
        let complete = common::replace_table(
            &common::read_fixture("Lato-Regular.ttf"),
            b"cmap",
            Some(cmap_data.as_bytes()),
        );
        let index = CharacterMapIndex::from_data(&complete, 0).unwrap();
        assert!(!index.is_empty());
        let cmap = font.cmap().unwrap();
        for entry in index.query("", None, 0, 1024).unwrap().entries {
            assert_eq!(
                cmap.map_codepoint(entry.codepoint).unwrap().to_u32(),
                entry.glyph_id
            );
        }
    }
}

#[test]
fn collection_uses_requested_nonzero_member_and_rejects_out_of_range() {
    let ttc = common::collection(&[
        common::read_fixture("Lato-Regular.ttf"),
        common::read_fixture("SourceSerif4-Regular.otf"),
    ]);
    let member = CharacterMapIndex::from_data(&ttc, 1).unwrap();
    let original =
        CharacterMapIndex::from_data(&common::read_fixture("SourceSerif4-Regular.otf"), 0).unwrap();
    assert_eq!(member.len(), original.len());
    assert_eq!(
        member.query("", None, 0, 256).unwrap().entries,
        original.query("", None, 0, 256).unwrap().entries
    );
    assert!(matches!(
        CharacterMapIndex::from_data(&ttc, 2),
        Err(CharacterMapError::InvalidFont)
    ));
}

#[test]
fn non_bmp_private_use_and_aliases_are_not_collapsed() {
    // 使用格式 12 为同一合法字形登记不同 Unicode 码点。
    let mut subtable = Vec::new();
    subtable.extend(12u16.to_be_bytes());
    subtable.extend(0u16.to_be_bytes());
    subtable.extend(16u32.wrapping_add(4 * 12).to_be_bytes());
    subtable.extend(0u32.to_be_bytes());
    subtable.extend(4u32.to_be_bytes());
    for codepoint in [0x301u32, 0xe000, 0x1f600, 0x10ffff] {
        subtable.extend(codepoint.to_be_bytes());
        subtable.extend(codepoint.to_be_bytes());
        subtable.extend(1u32.to_be_bytes());
    }
    let mut cmap = vec![0, 0, 0, 1, 0, 3, 0, 10, 0, 0, 0, 12];
    cmap.extend(subtable);
    let data = common::replace_table(
        &common::read_fixture("Lato-Regular.ttf"),
        b"cmap",
        Some(&cmap),
    );
    let map = CharacterMapIndex::from_data(&data, 0).unwrap();
    assert_eq!(map.len(), 4);
    let all = map.query("", None, 0, 256).unwrap();
    assert!(all.entries.iter().all(|entry| entry.glyph_id == 1));
    assert_eq!(
        map.query("😀", None, 0, 256).unwrap().entries[0].codepoint,
        0x1f600
    );
}

#[test]
fn large_constant_mapping_paginates_without_losing_aliases() {
    let mut cmap = vec![0, 0, 0, 1, 0, 3, 0, 10, 0, 0, 0, 12];
    cmap.extend(13u16.to_be_bytes());
    cmap.extend(0u16.to_be_bytes());
    cmap.extend(28u32.to_be_bytes());
    cmap.extend(0u32.to_be_bytes());
    cmap.extend(1u32.to_be_bytes());
    cmap.extend(0x10000u32.to_be_bytes());
    cmap.extend(0x2ffffu32.to_be_bytes());
    cmap.extend(1u32.to_be_bytes());
    let font = common::replace_table(
        &common::read_fixture("Lato-Regular.ttf"),
        b"cmap",
        Some(&cmap),
    );
    let index = CharacterMapIndex::from_data(&font, 0).unwrap();
    assert_eq!(index.len(), 0x20000);
    let mut next = 0x10000;
    for offset in (0..index.len()).step_by(256) {
        for entry in index.query("", None, offset, 256).unwrap().entries {
            assert_eq!(entry.codepoint, next);
            assert_eq!(entry.glyph_id, 1);
            next += 1;
        }
    }
    assert_eq!(next, 0x30000);
    assert_eq!(
        index.query("U+2FFFF", None, 0, 256).unwrap().entries.len(),
        1
    );
}
