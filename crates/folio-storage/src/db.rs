//! 本地 Folio 字体库数据库。
//!
//! [`FolioDatabase`] 持有 SQLite 连接，提供小接口：库根目录增删查、缓存
//! 读取/清空、增量或重建刷新。数据库文件位置由平台层决定，本类型只接受
//! 一个路径。

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use folio_core::{rebuild_catalog, Catalog, ParsedFace};

use crate::cache::{self, SourceStatus};
use crate::error::StorageError;
use crate::ids::LibraryRootId;
use crate::refresh::{self, RefreshMode, RefreshResult};
use crate::root::{self, AddRootOutcome, LibraryRoot};
use crate::schema;

/// 持久化的本地字体库。
/// 连接可转移线程但不能并发共享；调用方应串行执行数据库操作。
#[derive(Debug)]
pub struct FolioDatabase {
    conn: Connection,
    path: PathBuf,
}

impl FolioDatabase {
    /// 打开（必要时创建）`path` 处的数据库并完成迁移。
    ///
    /// 平台相关的位置选择由调用方负责；本函数接受任意路径。
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StorageError> {
        let path = path.as_ref().to_path_buf();
        let mut conn = Connection::open(&path).map_err(|source| StorageError::DatabaseOpen {
            path: path.clone(),
            source,
        })?;
        conn.pragma_update(None, "foreign_keys", true)?;
        conn.busy_timeout(std::time::Duration::from_secs(2))?;
        schema::migrate(&mut conn)?;
        Ok(Self { conn, path })
    }

    /// 底层数据库文件路径。
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// 已打开数据库的当前 schema 版本。
    pub fn schema_version(&self) -> Result<i32, StorageError> {
        schema::read_user_version(&self.conn)
    }

    /// 添加库根目录；同一路径已存在时返回已有记录。
    pub fn add_root(
        &self,
        path: impl AsRef<Path>,
        recursive: bool,
    ) -> Result<AddRootOutcome, StorageError> {
        root::add_root(&self.conn, path.as_ref(), recursive)
    }

    /// 列出全部库根目录。
    pub fn list_roots(&self) -> Result<Vec<LibraryRoot>, StorageError> {
        root::list_roots(&self.conn)
    }

    /// 查询单个库根目录。
    pub fn get_root(&self, id: LibraryRootId) -> Result<Option<LibraryRoot>, StorageError> {
        root::get_root(&self.conn, id)
    }

    /// 删除库根目录及其缓存归属。
    pub fn remove_root(&self, id: LibraryRootId) -> Result<bool, StorageError> {
        root::remove_root(&self.conn, id)
    }

    /// 更新库根目录的递归标记。
    pub fn set_root_recursive(
        &self,
        id: LibraryRootId,
        recursive: bool,
    ) -> Result<bool, StorageError> {
        root::set_root_recursive(&self.conn, id, recursive)
    }

    /// 删除可重建目录缓存，不触碰库根目录。
    pub fn clear_catalog_cache(&self) -> Result<u64, StorageError> {
        cache::clear_all(&self.conn)
    }

    /// 不访问文件系统，仅从缓存重建目录。
    ///
    /// 结果可能相对磁盘过期，这是正常的。损坏的缓存行返回类型化的
    /// [`StorageError::CorruptCache`]，绝不静默缺数据；可调用
    /// [`FolioDatabase::clear_catalog_cache`] 或
    /// [`RefreshMode::Rebuild`] 刷新来修复。
    pub fn load_cached_catalog(&self) -> Result<Catalog, StorageError> {
        let rows = cache::load_all_rows(&self.conn)?;
        let mut faces: Vec<ParsedFace> = Vec::new();

        for row in rows {
            if row.status != SourceStatus::Parsed {
                continue;
            }
            let payload = cache::parsed_payload(&row)?;
            for cached_face in &payload.faces {
                let source = cache::source_for_row(&row, cached_face.face_index)?;
                faces.push(cached_face.to_parsed_face(source));
            }
        }

        Ok(rebuild_catalog(faces))
    }

    /// 刷新全部库根目录。
    pub fn refresh(&mut self, mode: RefreshMode) -> Result<RefreshResult, StorageError> {
        let roots = root::list_roots(&self.conn)?;
        refresh::refresh_roots(&mut self.conn, &roots, mode)
    }

    /// 按标识刷新单个库根目录，返回目录仅包含该根范围。
    /// 全库快照使用 `refresh`；仅需合并现有缓存时使用 `load_cached_catalog`。
    pub fn refresh_root(
        &mut self,
        id: LibraryRootId,
        mode: RefreshMode,
    ) -> Result<RefreshResult, StorageError> {
        let root = root::get_root(&self.conn, id)?.ok_or(StorageError::RootNotFound { id })?;
        refresh::refresh_roots(&mut self.conn, std::slice::from_ref(&root), mode)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cache::{self, SourceRowWrite, SourceStatus};
    use crate::path_codec::encode_path;

    fn row(root_id: LibraryRootId, path: &Path, size: u64) -> SourceRowWrite {
        let encoded = encode_path(path);
        SourceRowWrite {
            root_id,
            platform: encoded.platform,
            path_bytes: encoded.bytes,
            display_path: encoded.display,
            file_size: size,
            mtime_ns: Some(1),
            content_hash: Some([7u8; 32]),
            status: SourceStatus::Malformed,
            format: None,
            payload_version: None,
            payload: None,
            error_message: Some("stored".to_owned()),
        }
    }

    #[test]
    fn failed_commit_rolls_back_cache_changes() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut db = FolioDatabase::open(dir.path().join("folio.sqlite")).expect("open");
        let root = match db.add_root(dir.path(), true).expect("add root") {
            AddRootOutcome::Created(root) => root,
            AddRootOutcome::Existing(_) => panic!("root should be new"),
        };

        let good = row(root.id, Path::new("/tmp/font.ttf"), 10);
        let tx = db.conn.transaction().expect("tx");
        cache::upsert_row(&tx, &good).expect("insert");
        tx.commit().expect("commit");

        let mut updated = good.clone();
        updated.file_size = 999;
        let mut bad = row(
            LibraryRootId::from_bytes([9u8; 16]),
            Path::new("/tmp/other.ttf"),
            1,
        );
        bad.status = SourceStatus::Parsed;

        let error = crate::refresh::commit_changes(&mut db.conn, &[updated, bad], &[1])
            .expect_err("must fail");
        assert!(
            matches!(
                error,
                StorageError::Sqlite(_) | StorageError::Transaction { .. }
            ),
            "unexpected error: {error:?}"
        );

        let cache::RootCacheRows {
            valid: rows,
            invalid,
        } = cache::load_rows_for_refresh(&db.conn, root.id).expect("reload");
        assert!(invalid.is_empty());
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].file_size, 10, "failed commit must be rolled back");
        assert_eq!(rows[0].error_message.as_deref(), Some("stored"));
    }
    #[test]
    fn every_connection_has_foreign_keys_and_a_bounded_busy_timeout() {
        let dir = tempfile::tempdir().unwrap();
        for _ in 0..2 {
            let db = FolioDatabase::open(dir.path().join("folio.sqlite")).unwrap();
            assert_eq!(
                db.conn
                    .query_row::<i64, _, _>("PRAGMA foreign_keys", [], |r| r.get(0))
                    .unwrap(),
                1
            );
            assert_eq!(
                db.conn
                    .query_row::<i64, _, _>("PRAGMA busy_timeout", [], |r| r.get(0))
                    .unwrap(),
                2000
            );
            assert_eq!(
                db.conn
                    .query_row::<String, _, _>("PRAGMA journal_mode", [], |r| r.get(0))
                    .unwrap(),
                "delete"
            );
        }
    }
}
