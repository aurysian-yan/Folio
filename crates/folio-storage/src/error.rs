//! 存储层类型化错误。
//!
//! 致命存储失败（无法打开数据库、迁移失败、数据库由更高版本写入）与
//! 非致命刷新问题（单个字体不可读）严格区分：坏字体不会阻止数据库打开。

use std::path::PathBuf;

use thiserror::Error;

use crate::ids::LibraryRootId;
use crate::path_codec::PathCodecError;

/// 致命的存储或缓存错误。
#[derive(Debug, Error)]
pub enum StorageError {
    #[error("collection name is empty")]
    InvalidCollectionName,
    #[error("collection name already exists")]
    CollectionNameConflict,
    #[error("unknown collection icon stored in database: {0}")]
    CorruptCollectionIcon(String),
    #[error("unknown collection color stored in database: {0}")]
    CorruptCollectionColor(String),
    #[error("collection not found: {id}")]
    CollectionNotFound { id: folio_core::CollectionId },
    #[error("smart folder name is empty")]
    InvalidSmartFolderName,
    #[error("smart folder name already exists")]
    SmartFolderNameConflict,
    #[error("invalid smart folder query JSON: {0}")]
    SmartFolderQueryJson(#[from] serde_json::Error),
    #[error("smart folder not found: {id}")]
    SmartFolderNotFound { id: folio_core::SmartFolderId },
    #[error("system clock cannot be represented as nanoseconds")]
    InvalidTimestamp,
    #[error("random identifier generation failed: {0}")]
    RandomId(getrandom::Error),
    #[error("incompatible cache payload: found {found:?}, supported {supported}")]
    CacheIncompatible { found: Option<u32>, supported: u32 },

    /// 数据库版本号必须为非负整数。
    #[error("invalid negative database schema version: {0}")]
    InvalidSchemaVersion(i32),

    /// 根路径不能转换为稳定的绝对路径。
    #[error("invalid library root path: {0}")]
    InvalidRootPath(#[source] std::io::Error),

    /// 数据库文件无法打开。
    #[error("failed to open database `{path}`: {source}")]
    DatabaseOpen {
        /// 数据库路径。
        path: PathBuf,
        /// 底层 SQLite 错误。
        #[source]
        source: rusqlite::Error,
    },

    /// 一般 SQLite 错误。
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    /// schema 迁移失败并已回滚。
    #[error("database migration from schema {from} to {to} failed: {source}")]
    Migration {
        /// 迁移起始版本。
        from: i32,
        /// 迁移目标版本。
        to: i32,
        /// 底层 SQLite 错误。
        #[source]
        source: rusqlite::Error,
    },

    /// 数据库由更新版本的 Folio 写入，禁止改动。
    #[error("database schema version {found} is newer than supported version {supported}")]
    DatabaseTooNew {
        /// 数据库中发现的版本。
        found: i32,
        /// 当前构建支持的最高版本。
        supported: i32,
    },

    /// 存储路径无法编码或解码。
    #[error("path codec error: {0}")]
    PathCodec(#[from] PathCodecError),

    /// 目录缓存载荷损坏。
    #[error("corrupt catalog cache at {context}: {message}")]
    CorruptCache {
        /// 出错的行或操作。
        context: String,
        /// 可读说明。
        message: String,
    },

    /// 存储的标识字节长度不正确。
    #[error("invalid stored identifier at {context}: expected {expected} bytes, found {found}")]
    InvalidStoredId {
        /// 出错的行或操作。
        context: String,
        /// 期望字节长度。
        expected: usize,
        /// 实际字节长度。
        found: usize,
    },

    /// 缓存载荷无法解码。
    #[error("invalid cache payload at {context}: {message}")]
    InvalidCachePayload {
        /// 出错的行或操作。
        context: String,
        /// 可读说明。
        message: String,
    },

    /// 写事务失败并已回滚。
    #[error("transaction failed: {source}")]
    Transaction {
        /// 底层 SQLite 错误。
        #[source]
        source: rusqlite::Error,
    },

    /// `add_root` 命中已存在根目录；正常路径以结果类型返回，不使用该错误。
    #[error("library root already exists: {id}")]
    RootAlreadyExists {
        /// 已存在根目录的标识。
        id: LibraryRootId,
    },

    /// 请求的库根目录不存在。
    #[error("library root not found: {id}")]
    RootNotFound {
        /// 未找到的标识。
        id: LibraryRootId,
    },
}
