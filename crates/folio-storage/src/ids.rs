//! 用户持久数据的库根目录标识。
//!
//! `LibraryRootId` 与缓存内部的 SQLite row id 无关，是存储根路径的
//! 128 位、域分离 BLAKE3 摘要：
//!
//! ```text
//! LibraryRootId = BLAKE3("folio-library-root\0" || platform || path_bytes)
//! ```
//!
//! 标识确定，因此重复添加同一路径无需扫描即可发现，不会产生重复行。
//! 修改根路径等价于先删除再添加，得到新的标识。

use std::fmt;
use std::path::Path;

use serde::ser::Serializer;
use serde::Serialize;

use crate::path_codec::{encode_path, EncodedPath};

const LIBRARY_ROOT_DOMAIN: &[u8] = b"folio-library-root\0";

/// 持久化 [`crate::LibraryRoot`] 的稳定标识。
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct LibraryRootId([u8; 16]);

impl LibraryRootId {
    /// 从原始摘要字节重建标识。
    pub fn from_bytes(bytes: [u8; 16]) -> Self {
        Self(bytes)
    }

    /// 原始摘要字节，不属于对用户稳定的格式。
    pub fn as_bytes(&self) -> &[u8; 16] {
        &self.0
    }

    /// 按给定路径原始编码计算标识；根路径规范化以 add_root 返回值为准。
    pub fn for_path(path: &Path) -> Self {
        let encoded = encode_path(path);
        Self::for_encoded(&encoded)
    }

    /// 从已编码的路径字节计算标识。
    pub fn for_encoded(encoded: &EncodedPath) -> Self {
        let mut hasher = blake3::Hasher::new();
        hasher.update(LIBRARY_ROOT_DOMAIN);
        let platform = encoded.platform.as_str().as_bytes();
        hasher.update(&(platform.len() as u64).to_le_bytes());
        hasher.update(platform);
        hasher.update(&(encoded.bytes.len() as u64).to_le_bytes());
        hasher.update(&encoded.bytes);
        let mut digest = [0u8; 16];
        hasher.finalize_xof().fill(&mut digest);
        Self(digest)
    }

    fn to_hex(self) -> String {
        use std::fmt::Write as _;

        let mut out = String::with_capacity(32);
        for byte in self.0 {
            let _ = write!(out, "{byte:02x}");
        }
        out
    }
}

impl fmt::Display for LibraryRootId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_hex())
    }
}

impl fmt::Debug for LibraryRootId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "LibraryRootId({})", self.to_hex())
    }
}

impl Serialize for LibraryRootId {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_hex())
    }
}

impl From<LibraryRootId> for folio_core::LibraryRootKey {
    fn from(id: LibraryRootId) -> Self {
        Self(*id.as_bytes())
    }
}
