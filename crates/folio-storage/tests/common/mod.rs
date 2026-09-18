//! folio-storage 集成测试的共用辅助函数。

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use folio_storage::{FolioDatabase, LibraryRoot, RefreshMode, RefreshResult};

/// 仓库字体 fixture 所在目录。
pub fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/fonts")
}

/// 单个 fixture 的绝对路径。
pub fn fixture(name: &str) -> PathBuf {
    fixtures_dir().join(name)
}

/// 读取 fixture 到内存。
pub fn read_fixture(name: &str) -> Vec<u8> {
    std::fs::read(fixture(name)).expect("fixture should exist")
}

/// 按给定相对名称写入字节。
pub fn write_in(dir: &Path, name: &str, data: &[u8]) -> PathBuf {
    let path = dir.join(name);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("create parent");
    }
    std::fs::write(&path, data).expect("write temp file");
    path
}

/// 将 fixture 复制到目录下的新相对名称。
pub fn copy_fixture(dir: &Path, fixture_name: &str, target_name: &str) -> PathBuf {
    write_in(dir, target_name, &read_fixture(fixture_name))
}

/// 写入 Fontations 测试集合 fixture。
pub fn write_collection(dir: &Path, name: &str) -> PathBuf {
    write_in(dir, name, font_test_data::ttc::TTC)
}

/// 在 `dir` 内打开数据库。
pub fn open_db(dir: &Path) -> FolioDatabase {
    FolioDatabase::open(dir.join("folio.sqlite")).expect("open database")
}

/// 添加根目录并执行一次增量刷新。
pub fn add_root(db: &mut FolioDatabase, dir: &Path) -> LibraryRoot {
    db.add_root(dir, true).expect("add root");
    let roots = db.list_roots().expect("list roots");
    roots
        .into_iter()
        .find(|root| root.path == dir)
        .expect("root present")
}

/// 增量刷新全部根目录。
pub fn refresh(db: &mut FolioDatabase) -> RefreshResult {
    db.refresh(RefreshMode::Incremental).expect("refresh")
}

/// 将文件修改时间向后推移一小时。
pub fn bump_mtime(path: &Path) {
    let file = std::fs::File::options()
        .write(true)
        .open(path)
        .expect("open for mtime");
    let time = SystemTime::now() + Duration::from_secs(3600);
    file.set_modified(time).expect("set modified");
}

/// 替换字体二进制中等长的 PostScript 名称。
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

/// 修改 head.fontRevision，重算表校验和及整个 sfnt 校验和，保持文件长度。
pub fn valid_revision(data: &[u8]) -> Vec<u8> {
    fn checksum(data: &[u8]) -> u32 {
        data.chunks(4).fold(0u32, |sum, chunk| {
            let mut word = [0; 4];
            word[..chunk.len()].copy_from_slice(chunk);
            sum.wrapping_add(u32::from_be_bytes(word))
        })
    }
    let mut out = data.to_vec();
    let count = u16::from_be_bytes(out[4..6].try_into().unwrap()) as usize;
    let record = (0..count)
        .map(|i| 12 + i * 16)
        .find(|i| &out[*i..*i + 4] == b"head")
        .unwrap();
    let offset = u32::from_be_bytes(out[record + 8..record + 12].try_into().unwrap()) as usize;
    let length = u32::from_be_bytes(out[record + 12..record + 16].try_into().unwrap()) as usize;
    let revision = u32::from_be_bytes(out[offset + 4..offset + 8].try_into().unwrap()) + 1;
    out[offset + 4..offset + 8].copy_from_slice(&revision.to_be_bytes());
    out[offset + 8..offset + 12].fill(0);
    let head_sum = checksum(&out[offset..offset + length]);
    out[record + 4..record + 8].copy_from_slice(&head_sum.to_be_bytes());
    let adjustment = 0xB1B0_AFBAu32.wrapping_sub(checksum(&out));
    out[offset + 8..offset + 12].copy_from_slice(&adjustment.to_be_bytes());
    assert_eq!(checksum(&out), 0xB1B0_AFBA);
    for i in 0..count {
        let r = 12 + i * 16;
        let start = u32::from_be_bytes(out[r + 8..r + 12].try_into().unwrap()) as usize;
        let len = u32::from_be_bytes(out[r + 12..r + 16].try_into().unwrap()) as usize;
        let mut table = out[start..start + len].to_vec();
        if &out[r..r + 4] == b"head" {
            table[8..12].fill(0);
        }
        assert_eq!(
            checksum(&table),
            u32::from_be_bytes(out[r + 4..r + 8].try_into().unwrap())
        );
    }
    out
}
