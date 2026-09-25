//! SQLite schema 与迁移。
//!
//! 数据库是设备本地状态，不是同步格式。版本用 `PRAGMA user_version` 记录；
//! 每一步迁移都在同一事务内完成并提升版本，失败时旧 schema 完全保留。
//! 更高版本的数据库会被拒绝，不降级、不覆盖。
//!
//! 存储两类数据：
//!
//! * **用户持久数据**（`library_roots`）：重建或清空缓存都不会删除。
//! * **可重建目录缓存**（`source_files`）：可由真实字体文件重建，可安全清空。

use rusqlite::{Connection, Transaction};

use crate::error::StorageError;

/// 当前构建支持的最高 schema 版本。
pub const CURRENT_SCHEMA_VERSION: i32 = 9;

/// 将新打开的连接迁移到 [`CURRENT_SCHEMA_VERSION`]。
pub fn migrate(conn: &mut Connection) -> Result<(), StorageError> {
    let mut version = read_user_version(conn)?;
    if version < 0 {
        return Err(StorageError::InvalidSchemaVersion(version));
    }
    if version > CURRENT_SCHEMA_VERSION {
        return Err(StorageError::DatabaseTooNew {
            found: version,
            supported: CURRENT_SCHEMA_VERSION,
        });
    }

    while version < CURRENT_SCHEMA_VERSION {
        let to = version + 1;
        let tx = conn.transaction()?;
        apply_step(&tx, to).map_err(|source| StorageError::Migration {
            from: version,
            to,
            source,
        })?;
        tx.pragma_update(None, "user_version", to)?;
        tx.commit()?;
        version = to;
    }

    Ok(())
}

/// 读取 `PRAGMA user_version`；全新数据库为 `0`。
pub fn read_user_version(conn: &Connection) -> Result<i32, StorageError> {
    Ok(conn.query_row("PRAGMA user_version", [], |row| row.get(0))?)
}

fn apply_step(tx: &Transaction<'_>, target: i32) -> Result<(), rusqlite::Error> {
    match target {
        1 => migrate_to_v1(tx),
        2 => migrate_to_v2(tx),
        3 => migrate_to_v3(tx),
        4 => migrate_to_v4(tx),
        5 => migrate_to_v5(tx),
        6 => migrate_to_v6(tx),
        7 => migrate_to_v7(tx),
        8 => migrate_to_v8(tx),
        9 => migrate_to_v9(tx),
        _ => Ok(()),
    }
}

fn migrate_to_v1(tx: &Transaction<'_>) -> Result<(), rusqlite::Error> {
    tx.execute_batch(
        r#"
        CREATE TABLE library_roots (
            id            BLOB    PRIMARY KEY NOT NULL,
            path_platform TEXT    NOT NULL,
            path_bytes    BLOB    NOT NULL,
            display_path  TEXT    NOT NULL,
            recursive     INTEGER NOT NULL,
            created_at_ns INTEGER NOT NULL
        );

        CREATE UNIQUE INDEX library_roots_path
            ON library_roots (path_platform, path_bytes);

        CREATE TABLE source_files (
            id              INTEGER PRIMARY KEY,
            root_id         BLOB    NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,
            path_platform   TEXT    NOT NULL,
            path_bytes      BLOB    NOT NULL,
            display_path    TEXT    NOT NULL,
            file_size       INTEGER NOT NULL,
            mtime_ns        INTEGER,
            content_hash    BLOB,
            status          TEXT    NOT NULL,
            format          TEXT,
            payload_version INTEGER,
            payload         BLOB,
            error_message   TEXT
        );

        CREATE UNIQUE INDEX source_files_root_path
            ON source_files (root_id, path_platform, path_bytes);
        "#,
    )
}

fn migrate_to_v2(tx: &Transaction<'_>) -> Result<(), rusqlite::Error> {
    tx.execute_batch(
        r#"
        CREATE TABLE collections (
            id BLOB PRIMARY KEY NOT NULL CHECK(length(id) = 16),
            name TEXT NOT NULL,
            normalized_name TEXT NOT NULL UNIQUE,
            created_at_ns INTEGER NOT NULL CHECK(created_at_ns >= 0),
            updated_at_ns INTEGER NOT NULL CHECK(updated_at_ns >= created_at_ns)
        );
        CREATE TABLE collection_members (
            collection_id BLOB NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
            identity_id BLOB NOT NULL CHECK(length(identity_id) = 16),
            PRIMARY KEY(collection_id, identity_id)
        );
        CREATE TABLE favorites (
            identity_id BLOB PRIMARY KEY NOT NULL CHECK(length(identity_id) = 16)
        );
        CREATE TABLE recent_fonts (
            identity_id BLOB PRIMARY KEY NOT NULL CHECK(length(identity_id) = 16),
            last_accessed_at_ns INTEGER NOT NULL CHECK(last_accessed_at_ns >= 0)
        );
        CREATE INDEX recent_fonts_order ON recent_fonts(last_accessed_at_ns DESC, identity_id);
    "#,
    )
}

fn migrate_to_v3(tx: &Transaction<'_>) -> Result<(), rusqlite::Error> {
    tx.execute_batch(
        "ALTER TABLE library_roots ADD COLUMN kind TEXT NOT NULL DEFAULT 'directory' \
         CHECK(kind IN ('directory', 'file')); \
         CREATE INDEX source_files_path ON source_files(path_platform, path_bytes);",
    )
}

fn migrate_to_v4(tx: &Transaction<'_>) -> Result<(), rusqlite::Error> {
    tx.execute_batch(
        "ALTER TABLE collections ADD COLUMN icon TEXT NOT NULL DEFAULT 'folder' \
         CHECK(icon IN ('folder', 'books', 'type', 'star', 'heart', 'bookmark', 'tag', 'briefcase', 'sparkles'));",
    )
}

fn migrate_to_v5(tx: &Transaction<'_>) -> Result<(), rusqlite::Error> {
    tx.execute_batch(
        r#"
        CREATE TABLE collections_new (
            id BLOB PRIMARY KEY NOT NULL CHECK(length(id) = 16),
            name TEXT NOT NULL,
            normalized_name TEXT NOT NULL UNIQUE,
            created_at_ns INTEGER NOT NULL CHECK(created_at_ns >= 0),
            updated_at_ns INTEGER NOT NULL CHECK(updated_at_ns >= created_at_ns),
            icon TEXT NOT NULL CHECK(icon IN (
                'folder', 'books', 'type', 'star', 'heart', 'bookmark', 'tag', 'briefcase', 'sparkles',
                'sliders-horizontal', 'signature', 'archive', 'book', 'paperclip', 'package', 'swatches', 'gift', 'stack',
                'number-circle-0', 'number-circle-1', 'number-circle-2', 'number-circle-3', 'number-circle-4',
                'number-circle-5', 'number-circle-6', 'number-circle-7', 'number-circle-8', 'number-circle-9',
                'number-square-0', 'number-square-1', 'number-square-2', 'number-square-3', 'number-square-4',
                'number-square-5', 'number-square-6', 'number-square-7', 'number-square-8', 'number-square-9'
            )),
            color TEXT NOT NULL DEFAULT 'gray' CHECK(color IN (
                'red', 'orange', 'yellow', 'lime', 'green', 'cyan', 'blue', 'purple', 'gray'
            ))
        );
        INSERT INTO collections_new (id, name, normalized_name, created_at_ns, updated_at_ns, icon, color)
            SELECT id, name, normalized_name, created_at_ns, updated_at_ns, icon, 'gray' FROM collections;

        CREATE TABLE collection_members_new (
            collection_id BLOB NOT NULL REFERENCES collections_new(id) ON DELETE CASCADE,
            identity_id BLOB NOT NULL CHECK(length(identity_id) = 16),
            PRIMARY KEY(collection_id, identity_id)
        );
        INSERT INTO collection_members_new (collection_id, identity_id)
            SELECT collection_id, identity_id FROM collection_members;

        DROP TABLE collection_members;
        DROP TABLE collections;
        ALTER TABLE collections_new RENAME TO collections;
        ALTER TABLE collection_members_new RENAME TO collection_members;
        "#,
    )
}

fn migrate_to_v6(tx: &Transaction<'_>) -> Result<(), rusqlite::Error> {
    tx.execute_batch(
        r#"
        CREATE TABLE sync_metadata (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );
        CREATE TABLE sync_events (
            id TEXT PRIMARY KEY NOT NULL,
            device_id TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            payload TEXT NOT NULL,
            published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0, 1)),
            UNIQUE(device_id, sequence)
        );
        CREATE TABLE sync_assets (
            fingerprint TEXT PRIMARY KEY NOT NULL,
            filename TEXT NOT NULL,
            extension TEXT NOT NULL,
            local_path TEXT,
            remote_payload TEXT NOT NULL,
            cloud_only INTEGER NOT NULL DEFAULT 0 CHECK(cloud_only IN (0, 1)),
            deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0, 1))
        );
        CREATE TABLE sync_remote_cursors (
            device_id TEXT PRIMARY KEY NOT NULL,
            last_sequence INTEGER NOT NULL DEFAULT 0 CHECK(last_sequence >= 0)
        );
        CREATE TABLE sync_conflicts (
            id TEXT PRIMARY KEY NOT NULL,
            kind TEXT NOT NULL,
            payload TEXT NOT NULL,
            resolved INTEGER NOT NULL DEFAULT 0 CHECK(resolved IN (0, 1))
        );
        "#,
    )
}

fn migrate_to_v7(tx: &Transaction<'_>) -> Result<(), rusqlite::Error> {
    tx.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS sync_metadata (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_events (
            id TEXT PRIMARY KEY NOT NULL,
            device_id TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            payload TEXT NOT NULL,
            published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0, 1)),
            UNIQUE(device_id, sequence)
        );
        CREATE TABLE IF NOT EXISTS sync_assets (
            fingerprint TEXT PRIMARY KEY NOT NULL,
            filename TEXT NOT NULL,
            extension TEXT NOT NULL,
            local_path TEXT,
            remote_payload TEXT NOT NULL,
            cloud_only INTEGER NOT NULL DEFAULT 0 CHECK(cloud_only IN (0, 1)),
            deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0, 1))
        );
        CREATE TABLE IF NOT EXISTS sync_remote_cursors (
            device_id TEXT PRIMARY KEY NOT NULL,
            last_sequence INTEGER NOT NULL DEFAULT 0 CHECK(last_sequence >= 0)
        );
        CREATE TABLE IF NOT EXISTS sync_conflicts (
            id TEXT PRIMARY KEY NOT NULL,
            kind TEXT NOT NULL,
            payload TEXT NOT NULL,
            resolved INTEGER NOT NULL DEFAULT 0 CHECK(resolved IN (0, 1))
        );
        "#,
    )
}

fn migrate_to_v8(tx: &Transaction<'_>) -> Result<(), rusqlite::Error> {
    tx.execute_batch(
        r#"
        CREATE TABLE smart_folders (
            id BLOB PRIMARY KEY NOT NULL CHECK(length(id) = 16),
            name TEXT NOT NULL,
            normalized_name TEXT NOT NULL UNIQUE,
            query_json TEXT NOT NULL,
            created_at_ns INTEGER NOT NULL CHECK(created_at_ns >= 0),
            updated_at_ns INTEGER NOT NULL CHECK(updated_at_ns >= created_at_ns)
        );
        "#,
    )
}

fn migrate_to_v9(tx: &Transaction<'_>) -> Result<(), rusqlite::Error> {
    tx.execute_batch(
        r#"
        ALTER TABLE smart_folders ADD COLUMN icon TEXT NOT NULL DEFAULT 'folder';
        ALTER TABLE smart_folders ADD COLUMN color TEXT NOT NULL DEFAULT 'gray';
        "#,
    )
}
