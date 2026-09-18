//! Shared helpers for folio-core integration tests.
//!
//! All fixtures are legally redistributable; see `fixtures/fonts/README.md`.

#![allow(dead_code)]

use std::path::{Path, PathBuf};

/// Directory containing the repository font fixtures.
pub fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/fonts")
}

/// Absolute path of a single fixture.
pub fn fixture(name: &str) -> PathBuf {
    fixtures_dir().join(name)
}

/// Reads a fixture into memory.
pub fn read_fixture(name: &str) -> Vec<u8> {
    std::fs::read(fixture(name)).expect("fixture should exist")
}

/// Writes bytes into a temporary directory under the given file name.
pub fn write_in(dir: &Path, name: &str, data: &[u8]) -> PathBuf {
    let path = dir.join(name);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("create parent");
    }
    std::fs::write(&path, data).expect("write temp file");
    path
}

/// Copies a fixture into a directory under a new name.
pub fn copy_fixture(dir: &Path, fixture_name: &str, target_name: &str) -> PathBuf {
    write_in(dir, target_name, &read_fixture(fixture_name))
}

/// Replaces a same-length PostScript name inside a font binary.
///
/// Used to build synthetic classification fixtures without shipping
/// modified third-party fonts. The replacement must have the same byte
/// length in ASCII and UTF-16BE form as `Lato-Regular` so all table
/// offsets stay valid.
pub fn patch_lato_postscript_name(data: &[u8], replacement: &str) -> Vec<u8> {
    const ORIGINAL: &str = "Lato-Regular";
    assert_eq!(
        replacement.chars().count(),
        ORIGINAL.chars().count(),
        "replacement must keep the byte length"
    );
    let ascii_from = ORIGINAL.as_bytes();
    let ascii_to = replacement.as_bytes();
    let utf16_from: Vec<u8> = ORIGINAL.encode_utf16().flat_map(u16::to_be_bytes).collect();
    let utf16_to: Vec<u8> = replacement
        .encode_utf16()
        .flat_map(u16::to_be_bytes)
        .collect();

    let patched = replace_all(data, ascii_from, ascii_to);
    replace_all(&patched, &utf16_from, &utf16_to)
}

fn replace_all(data: &[u8], from: &[u8], to: &[u8]) -> Vec<u8> {
    assert_eq!(from.len(), to.len());
    let mut out = data.to_vec();
    let mut offset = 0;
    while offset + from.len() <= out.len() {
        if &out[offset..offset + from.len()] == from {
            out[offset..offset + to.len()].copy_from_slice(to);
            offset += to.len();
        } else {
            offset += 1;
        }
    }
    out
}

/// A tiny valid PNG (1x1) used as a non-font file in isolation tests.
pub const TINY_PNG: &[u8] = &[
    0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
];

/// 读取测试字体中的大端整数。
pub fn u16_at(data: &[u8], offset: usize) -> u16 {
    u16::from_be_bytes(data[offset..offset + 2].try_into().unwrap())
}

pub fn u32_at(data: &[u8], offset: usize) -> u32 {
    u32::from_be_bytes(data[offset..offset + 4].try_into().unwrap())
}

/// 按 OpenType 规则累加四字节校验和。
pub fn checksum(data: &[u8]) -> u32 {
    data.chunks(4).fold(0u32, |sum, chunk| {
        let mut word = [0; 4];
        word[..chunk.len()].copy_from_slice(chunk);
        sum.wrapping_add(u32::from_be_bytes(word))
    })
}

/// 重建单个 sfnt 的表目录和校验和；不生成或修改轮廓。
pub fn replace_table(data: &[u8], tag: &[u8; 4], replacement: Option<&[u8]>) -> Vec<u8> {
    let mut tables = std::collections::BTreeMap::new();
    for i in 0..u16_at(data, 4) as usize {
        let record = 12 + i * 16;
        let key: [u8; 4] = data[record..record + 4].try_into().unwrap();
        let start = u32_at(data, record + 8) as usize;
        let len = u32_at(data, record + 12) as usize;
        tables.insert(key, data[start..start + len].to_vec());
    }
    match replacement {
        Some(bytes) => {
            tables.insert(*tag, bytes.to_vec());
        }
        None => {
            tables.remove(tag);
        }
    }
    let count = tables.len();
    let mut out = vec![0; 12 + count * 16];
    out[..4].copy_from_slice(&data[..4]);
    out[4..6].copy_from_slice(&(count as u16).to_be_bytes());
    let power = count.ilog2() as u16;
    let search = 16u16 * (1 << power);
    out[6..8].copy_from_slice(&search.to_be_bytes());
    out[8..10].copy_from_slice(&power.to_be_bytes());
    out[10..12].copy_from_slice(&(16 * count as u16 - search).to_be_bytes());
    let mut head = None;
    for (i, (tag, mut table)) in tables.into_iter().enumerate() {
        let record = 12 + i * 16;
        let offset = out.len();
        if &tag == b"head" {
            table[8..12].fill(0);
            head = Some(offset);
        }
        out[record..record + 4].copy_from_slice(&tag);
        out[record + 4..record + 8].copy_from_slice(&checksum(&table).to_be_bytes());
        out[record + 8..record + 12].copy_from_slice(&(offset as u32).to_be_bytes());
        out[record + 12..record + 16].copy_from_slice(&(table.len() as u32).to_be_bytes());
        out.extend_from_slice(&table);
        out.resize(out.len().next_multiple_of(4), 0);
    }
    if let Some(offset) = head {
        let adjustment = 0xB1B0_AFBAu32.wrapping_sub(checksum(&out));
        out[offset + 8..offset + 12].copy_from_slice(&adjustment.to_be_bytes());
    }
    out
}

/// 构造 name 表；记录为平台、编码、语言、名称 ID 与字符串。
pub fn name_table(records: &[(u16, u16, u16, u16, &str)], tags: &[&str]) -> Vec<u8> {
    let mut records = records.to_vec();
    records.sort_by_key(|r| (r.0, r.1, r.2, r.3));
    let version = u16::from(!tags.is_empty());
    let storage = 6 + records.len() * 12 + if version == 1 { 2 + tags.len() * 4 } else { 0 };
    let mut out = Vec::new();
    for value in [version, records.len() as u16, storage as u16] {
        out.extend_from_slice(&value.to_be_bytes());
    }
    let mut strings = Vec::new();
    for (platform, encoding, language, id, value) in records {
        let bytes: Vec<u8> = if platform == 1 && encoding == 0 {
            assert!(value.is_ascii());
            value.as_bytes().to_vec()
        } else {
            value.encode_utf16().flat_map(u16::to_be_bytes).collect()
        };
        for value in [
            platform,
            encoding,
            language,
            id,
            bytes.len() as u16,
            strings.len() as u16,
        ] {
            out.extend_from_slice(&value.to_be_bytes());
        }
        strings.extend(bytes);
    }
    if version == 1 {
        out.extend_from_slice(&(tags.len() as u16).to_be_bytes());
        for tag in tags {
            let bytes: Vec<u8> = tag.encode_utf16().flat_map(u16::to_be_bytes).collect();
            out.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
            out.extend_from_slice(&(strings.len() as u16).to_be_bytes());
            strings.extend(bytes);
        }
    }
    out.extend(strings);
    out
}

pub fn with_names(records: &[(u16, u16, u16, u16, &str)], tags: &[&str]) -> Vec<u8> {
    replace_table(
        &read_fixture("Lato-Regular.ttf"),
        b"name",
        Some(&name_table(records, tags)),
    )
}

/// 将现有合法字体打包成集合，并将表偏移改为相对集合起点。
pub fn collection(fonts: &[Vec<u8>]) -> Vec<u8> {
    let mut out = b"ttcf\0\x01\0\0".to_vec();
    out.extend_from_slice(&(fonts.len() as u32).to_be_bytes());
    out.resize(12 + fonts.len() * 4, 0);
    for (index, font) in fonts.iter().enumerate() {
        let base = out.len();
        out[12 + index * 4..16 + index * 4].copy_from_slice(&(base as u32).to_be_bytes());
        let mut member = font.clone();
        for i in 0..u16_at(font, 4) as usize {
            let record = 12 + i * 16;
            let offset = u32_at(font, record + 8);
            if &font[record..record + 4] == b"head" {
                member[offset as usize + 8..offset as usize + 12].fill(0);
            }
            member[record + 8..record + 12].copy_from_slice(&(offset + base as u32).to_be_bytes());
        }
        out.extend(member);
        out.resize(out.len().next_multiple_of(4), 0);
    }
    out
}
