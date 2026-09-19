//! Folio 本地字体库的持久化与增量存储。
//!
//! 本 crate 位于 [`folio_core`] 之上，是唯一接触 SQLite 的地方；核心保持
//! 纯字体领域逻辑。
//!
//! ```text
//! 库根目录 Library Roots
//!       |
//! 文件系统状态
//!       |
//! SQLite 缓存  <---- 增量决策 ----> 按需 hash / parse
//!       |
//! 全局目录重建
//! ```
//!
//! 两类数据严格分离：
//!
//! * **用户持久数据** — [`LibraryRoot`]。清空或重建缓存都不会删除它。
//! * **可重建目录缓存** — 每个文件的解析状态，可由真实字体文件重建，
//!   可用 [`FolioDatabase::clear_catalog_cache`] 清空。
//!
//! 数据库是设备本地状态，不是同步格式。
//!
//! # 示例
//!
//! ```no_run
//! use folio_storage::{FolioDatabase, RefreshMode};
//!
//! # fn main() -> Result<(), folio_storage::StorageError> {
//! let mut db = FolioDatabase::open("/tmp/folio.sqlite")?;
//! db.add_root("/Library/Fonts", true)?;
//! let first = db.refresh(RefreshMode::Incremental)?;
//! let second = db.refresh(RefreshMode::Incremental)?;
//! assert_eq!(second.stats.files_reparsed, 0);
//! # Ok(())
//! # }
//! ```

#![forbid(unsafe_code)]

mod cache;
mod cache_payload;
mod db;
mod error;
mod ids;
mod path_codec;
mod refresh;
mod root;
mod schema;

pub use db::FolioDatabase;
pub use error::StorageError;
pub use ids::LibraryRootId;
pub use path_codec::{DecodedPath, EncodedPath, PathCodecError, PathPlatform};
pub use refresh::{
    RefreshIssue, RefreshIssueKind, RefreshIssueSeverity, RefreshMode, RefreshResult, RefreshStats,
};
pub use root::{AddRootOutcome, LibraryRoot};

/// 序列化解析缓存载荷的版本号。
pub const CACHE_PAYLOAD_VERSION: u32 = cache_payload::CACHE_PAYLOAD_VERSION;

/// 支持的最高 SQLite schema 版本。
pub const CURRENT_SCHEMA_VERSION: i32 = schema::CURRENT_SCHEMA_VERSION;

mod state;
pub use folio_core::{
    Collection, CollectionId, CollectionMembers, LibraryStateSnapshot, RecentFont,
};
