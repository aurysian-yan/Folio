//! 设置页使用的本地存储统计。

use std::fs;
use std::io;
use std::path::Path;

use rusqlite::Connection;

use crate::StorageError;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct StorageUsage {
    pub database_bytes: u64,
    pub volume_total_bytes: u64,
    pub volume_free_bytes: u64,
    pub catalog_cache_entries: u64,
    pub catalog_cache_estimated_bytes: u64,
}

impl StorageUsage {
    pub(crate) fn read(conn: &Connection, path: &Path) -> Result<Self, StorageError> {
        let (entries, estimated): (i64, i64) = conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(
                LENGTH(path_bytes) + LENGTH(display_path) + COALESCE(LENGTH(payload), 0)
                + COALESCE(LENGTH(error_message), 0)
            ), 0) FROM source_files",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let mut database_bytes = file_bytes(path)?;
        for suffix in ["-wal", "-shm"] {
            let mut sidecar = path.as_os_str().to_os_string();
            sidecar.push(suffix);
            database_bytes = database_bytes.saturating_add(file_bytes(Path::new(&sidecar))?);
        }
        Ok(Self {
            database_bytes,
            volume_total_bytes: fs2::total_space(path)?,
            volume_free_bytes: fs2::free_space(path)?,
            catalog_cache_entries: entries as u64,
            catalog_cache_estimated_bytes: estimated as u64,
        })
    }
}

fn file_bytes(path: &Path) -> Result<u64, io::Error> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(metadata.len()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(error),
    }
}

/// 统计应用自己管理的目录，不跟随符号链接。
pub fn directory_bytes(path: &Path) -> Result<u64, io::Error> {
    if !path.exists() {
        return Ok(0);
    }
    let mut total = 0_u64;
    for entry in walkdir::WalkDir::new(path).follow_links(false) {
        let entry = entry.map_err(io::Error::other)?;
        if entry.file_type().is_file() {
            total = total.saturating_add(entry.metadata().map_err(io::Error::other)?.len());
        }
    }
    Ok(total)
}
