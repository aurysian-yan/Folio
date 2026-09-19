//! 持久库状态的共享 DTO，不依赖数据库或平台实现。

use crate::{Catalog, FontFaceId, FontIdentityId};
use serde::Serialize;
use std::collections::BTreeSet;
use unicode_normalization::UnicodeNormalization;

/// NFC、Unicode 小写与空白折叠；保留重音、标点与兼容字符差异。
pub fn normalize_search(value: &str) -> String {
    value
        .nfc()
        .flat_map(char::to_lowercase)
        .collect::<String>()
        .nfc()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub struct CollectionId([u8; 16]);
impl CollectionId {
    pub fn from_bytes(bytes: [u8; 16]) -> Self {
        Self(bytes)
    }
    pub fn as_bytes(&self) -> &[u8; 16] {
        &self.0
    }
}
impl std::fmt::Display for CollectionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        for b in self.0 {
            write!(f, "{b:02x}")?;
        }
        Ok(())
    }
}

/// 与存储层 LibraryRootId 字节一一对应的查询键。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub struct LibraryRootKey(pub [u8; 16]);

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Collection {
    pub id: CollectionId,
    pub name: String,
    pub created_at_ns: i64,
    pub updated_at_ns: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CollectionMembers {
    pub collection_id: CollectionId,
    pub identities: Vec<FontIdentityId>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
/// UTC Unix 纳秒；重复访问保留最新时间，不统计访问次数。
pub struct RecentFont {
    pub identity_id: FontIdentityId,
    pub last_accessed_at_ns: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RootMembership {
    pub root_id: LibraryRootKey,
    pub face_ids: Vec<FontFaceId>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct LibraryStateSnapshot {
    pub collections: Vec<CollectionMembers>,
    pub favorites: Vec<FontIdentityId>,
    pub recent: Vec<RecentFont>,
    pub roots: Vec<RootMembership>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct IdentityResolution {
    pub identity_id: FontIdentityId,
    pub resolved: bool,
}

/// 解析状态只针对传入目录；离线缓存仍在目录中时属于已解析的陈旧快照。
pub fn resolve_identities(
    identities: &[FontIdentityId],
    catalog: &Catalog,
) -> Vec<IdentityResolution> {
    let present: BTreeSet<_> = catalog.faces().map(|f| f.identity_id).collect();
    identities
        .iter()
        .copied()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(|identity_id| IdentityResolution {
            identity_id,
            resolved: present.contains(&identity_id),
        })
        .collect()
}
