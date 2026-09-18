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
