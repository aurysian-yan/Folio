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

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub struct SmartFolderId([u8; 16]);
impl SmartFolderId {
    pub fn from_bytes(bytes: [u8; 16]) -> Self {
        Self(bytes)
    }
    pub fn as_bytes(&self) -> &[u8; 16] {
        &self.0
    }
}
impl std::fmt::Display for SmartFolderId {
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
    pub icon: CollectionIcon,
    pub color: CollectionColor,
    pub created_at_ns: i64,
    pub updated_at_ns: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SmartFolder {
    pub id: SmartFolderId,
    pub name: String,
    pub icon: CollectionIcon,
    pub color: CollectionColor,
    pub query_json: String,
    pub created_at_ns: i64,
    pub updated_at_ns: i64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub enum CollectionIcon {
    #[default]
    Folder,
    Books,
    Type,
    Star,
    Heart,
    Bookmark,
    Tag,
    Briefcase,
    Sparkles,
    SlidersHorizontal,
    Signature,
    Archive,
    Book,
    Paperclip,
    Package,
    Swatches,
    Gift,
    Stack,
    NumberCircle0,
    NumberCircle1,
    NumberCircle2,
    NumberCircle3,
    NumberCircle4,
    NumberCircle5,
    NumberCircle6,
    NumberCircle7,
    NumberCircle8,
    NumberCircle9,
    NumberSquare0,
    NumberSquare1,
    NumberSquare2,
    NumberSquare3,
    NumberSquare4,
    NumberSquare5,
    NumberSquare6,
    NumberSquare7,
    NumberSquare8,
    NumberSquare9,
}

impl CollectionIcon {
    pub fn key(self) -> &'static str {
        match self {
            Self::Folder => "folder",
            Self::Books => "books",
            Self::Type => "type",
            Self::Star => "star",
            Self::Heart => "heart",
            Self::Bookmark => "bookmark",
            Self::Tag => "tag",
            Self::Briefcase => "briefcase",
            Self::Sparkles => "sparkles",
            Self::SlidersHorizontal => "sliders-horizontal",
            Self::Signature => "signature",
            Self::Archive => "archive",
            Self::Book => "book",
            Self::Paperclip => "paperclip",
            Self::Package => "package",
            Self::Swatches => "swatches",
            Self::Gift => "gift",
            Self::Stack => "stack",
            Self::NumberCircle0 => "number-circle-0",
            Self::NumberCircle1 => "number-circle-1",
            Self::NumberCircle2 => "number-circle-2",
            Self::NumberCircle3 => "number-circle-3",
            Self::NumberCircle4 => "number-circle-4",
            Self::NumberCircle5 => "number-circle-5",
            Self::NumberCircle6 => "number-circle-6",
            Self::NumberCircle7 => "number-circle-7",
            Self::NumberCircle8 => "number-circle-8",
            Self::NumberCircle9 => "number-circle-9",
            Self::NumberSquare0 => "number-square-0",
            Self::NumberSquare1 => "number-square-1",
            Self::NumberSquare2 => "number-square-2",
            Self::NumberSquare3 => "number-square-3",
            Self::NumberSquare4 => "number-square-4",
            Self::NumberSquare5 => "number-square-5",
            Self::NumberSquare6 => "number-square-6",
            Self::NumberSquare7 => "number-square-7",
            Self::NumberSquare8 => "number-square-8",
            Self::NumberSquare9 => "number-square-9",
        }
    }

    pub fn from_key(key: &str) -> Option<Self> {
        match key {
            "folder" => Some(Self::Folder),
            "books" => Some(Self::Books),
            "type" => Some(Self::Type),
            "star" => Some(Self::Star),
            "heart" => Some(Self::Heart),
            "bookmark" => Some(Self::Bookmark),
            "tag" => Some(Self::Tag),
            "briefcase" => Some(Self::Briefcase),
            "sparkles" => Some(Self::Sparkles),
            "sliders-horizontal" => Some(Self::SlidersHorizontal),
            "signature" => Some(Self::Signature),
            "archive" => Some(Self::Archive),
            "book" => Some(Self::Book),
            "paperclip" => Some(Self::Paperclip),
            "package" => Some(Self::Package),
            "swatches" => Some(Self::Swatches),
            "gift" => Some(Self::Gift),
            "stack" => Some(Self::Stack),
            "number-circle-0" => Some(Self::NumberCircle0),
            "number-circle-1" => Some(Self::NumberCircle1),
            "number-circle-2" => Some(Self::NumberCircle2),
            "number-circle-3" => Some(Self::NumberCircle3),
            "number-circle-4" => Some(Self::NumberCircle4),
            "number-circle-5" => Some(Self::NumberCircle5),
            "number-circle-6" => Some(Self::NumberCircle6),
            "number-circle-7" => Some(Self::NumberCircle7),
            "number-circle-8" => Some(Self::NumberCircle8),
            "number-circle-9" => Some(Self::NumberCircle9),
            "number-square-0" => Some(Self::NumberSquare0),
            "number-square-1" => Some(Self::NumberSquare1),
            "number-square-2" => Some(Self::NumberSquare2),
            "number-square-3" => Some(Self::NumberSquare3),
            "number-square-4" => Some(Self::NumberSquare4),
            "number-square-5" => Some(Self::NumberSquare5),
            "number-square-6" => Some(Self::NumberSquare6),
            "number-square-7" => Some(Self::NumberSquare7),
            "number-square-8" => Some(Self::NumberSquare8),
            "number-square-9" => Some(Self::NumberSquare9),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub enum CollectionColor {
    Red,
    Orange,
    Yellow,
    Lime,
    Green,
    Cyan,
    Blue,
    Purple,
    #[default]
    Gray,
}

impl CollectionColor {
    pub fn key(self) -> &'static str {
        match self {
            Self::Red => "red",
            Self::Orange => "orange",
            Self::Yellow => "yellow",
            Self::Lime => "lime",
            Self::Green => "green",
            Self::Cyan => "cyan",
            Self::Blue => "blue",
            Self::Purple => "purple",
            Self::Gray => "gray",
        }
    }

    pub fn from_key(key: &str) -> Option<Self> {
        match key {
            "red" => Some(Self::Red),
            "orange" => Some(Self::Orange),
            "yellow" => Some(Self::Yellow),
            "lime" => Some(Self::Lime),
            "green" => Some(Self::Green),
            "cyan" => Some(Self::Cyan),
            "blue" => Some(Self::Blue),
            "purple" => Some(Self::Purple),
            "gray" => Some(Self::Gray),
            _ => None,
        }
    }
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
