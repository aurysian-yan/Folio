//! 库根目录：用户持久状态。
//!
//! [`LibraryRoot`] 是用户主动加入 Folio 的目录，**不是**字体来源：根目录是
//! 容器，来源是其下发现的具体 `文件 + face_index`。根目录在清空/重建缓存后
//! 仍然保留。

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, Row};

use crate::error::StorageError;
use crate::ids::LibraryRootId;
use crate::path_codec::{decode_path, encode_path, PathPlatform};

/// 持久化的库根目录。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LibraryRoot {
    /// 由路径派生的持久标识。
    pub id: LibraryRootId,
    /// 尽力重建的路径；`path_is_lossless` 为 true 时精确一致。
    pub path: PathBuf,
    /// 供 UI 与诊断使用的有损字符串。
    pub display_path: String,
    /// 目录遍历是否递归子目录。
    pub recursive: bool,
    /// 加入时间。
    pub created_at: SystemTime,
    /// `path` 在本机是否可精确往返。
    pub path_is_lossless: bool,
}

impl LibraryRoot {
    /// 根路径的平台无损字节。
    pub fn path_bytes(&self) -> Vec<u8> {
        encode_path(&self.path).bytes
    }
}

/// 添加库根目录的结果。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AddRootOutcome {
    /// 新建了根目录记录。
    Created(LibraryRoot),
    /// 同一路径已存在，未做任何改动。
    Existing(LibraryRoot),
}

/// 插入库根目录；同一路径已存在时返回已有记录。
pub fn add_root(
    conn: &Connection,
    path: &Path,
    recursive: bool,
) -> Result<AddRootOutcome, StorageError> {
    let path: PathBuf = std::path::absolute(path)
        .map_err(StorageError::InvalidRootPath)?
        .components()
        .collect();
    let encoded = encode_path(&path);
    decode_path(encoded.platform, &encoded.bytes, &encoded.display)?;
    let id = LibraryRootId::for_encoded(&encoded);
    let created_at = system_time_to_nanos(SystemTime::now()).unwrap_or(0);

    let changed = conn.execute(
        "INSERT INTO library_roots \
         (id, path_platform, path_bytes, display_path, recursive, created_at_ns) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(path_platform, path_bytes) DO NOTHING",
        rusqlite::params![
            id.as_bytes().as_slice(),
            encoded.platform.as_str(),
            encoded.bytes,
            encoded.display,
            recursive,
            created_at,
        ],
    )?;

    let root = get_root(conn, id)?.ok_or(StorageError::RootNotFound { id })?;
    if changed == 0 {
        Ok(AddRootOutcome::Existing(root))
    } else {
        Ok(AddRootOutcome::Created(root))
    }
}

/// 按确定顺序列出全部库根目录。
pub fn list_roots(conn: &Connection) -> Result<Vec<LibraryRoot>, StorageError> {
    let mut statement = conn.prepare(
        "SELECT id, path_platform, path_bytes, display_path, recursive, created_at_ns \
         FROM library_roots ORDER BY display_path, id",
    )?;
    let mut rows = statement.query([])?;
    let mut roots = Vec::new();
    while let Some(row) = rows.next()? {
        roots.push(read_root(row)?);
    }
    Ok(roots)
}

/// 按标识查询库根目录。
pub fn get_root(conn: &Connection, id: LibraryRootId) -> Result<Option<LibraryRoot>, StorageError> {
    let mut statement = conn.prepare(
        "SELECT id, path_platform, path_bytes, display_path, recursive, created_at_ns \
         FROM library_roots WHERE id = ?1",
    )?;
    let mut rows = statement.query(rusqlite::params![id.as_bytes().as_slice()])?;
    match rows.next()? {
        Some(row) => Ok(Some(read_root(row)?)),
        None => Ok(None),
    }
}

/// 删除库根目录及其缓存归属。
///
/// 仍被其他根目录覆盖的字体会保留在全局目录中。
pub fn remove_root(conn: &Connection, id: LibraryRootId) -> Result<bool, StorageError> {
    let changed = conn.execute(
        "DELETE FROM library_roots WHERE id = ?1",
        rusqlite::params![id.as_bytes().as_slice()],
    )?;
    Ok(changed > 0)
}

/// 更新已有根目录的递归标记。
pub fn set_root_recursive(
    conn: &Connection,
    id: LibraryRootId,
    recursive: bool,
) -> Result<bool, StorageError> {
    let changed = conn.execute(
        "UPDATE library_roots SET recursive = ?2 WHERE id = ?1",
        rusqlite::params![id.as_bytes().as_slice(), recursive],
    )?;
    Ok(changed > 0)
}

fn read_root(row: &Row<'_>) -> Result<LibraryRoot, StorageError> {
    let id_bytes: Vec<u8> = row.get("id")?;
    let platform: String = row.get("path_platform")?;
    let path_bytes: Vec<u8> = row.get("path_bytes")?;
    let display_path: String = row.get("display_path")?;
    let recursive = match row.get::<_, i64>("recursive")? {
        0 => false,
        1 => true,
        _ => {
            return Err(StorageError::CorruptCache {
                context: "library_roots.recursive".to_owned(),
                message: "expected boolean 0 or 1; durable row kept".to_owned(),
            })
        }
    };
    let created_at_ns: i64 = row.get("created_at_ns")?;

    let id = decode_root_id(&id_bytes, "library_roots.id")?;
    let (path, path_is_lossless) = decode_stored_path(&platform, &path_bytes, &display_path)?;
    if !path.is_absolute() {
        return Err(StorageError::InvalidRootPath(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "stored root must be absolute; durable row kept",
        )));
    }

    Ok(LibraryRoot {
        id,
        path,
        display_path,
        recursive,
        created_at: nanos_to_system_time(created_at_ns).unwrap_or(UNIX_EPOCH),
        path_is_lossless,
    })
}

pub(crate) fn decode_root_id(bytes: &[u8], context: &str) -> Result<LibraryRootId, StorageError> {
    let array = id_bytes::<16>(bytes, context)?;
    Ok(LibraryRootId::from_bytes(array))
}

pub(crate) fn id_bytes<const N: usize>(
    bytes: &[u8],
    context: &str,
) -> Result<[u8; N], StorageError> {
    bytes.try_into().map_err(|_| StorageError::InvalidStoredId {
        context: context.to_owned(),
        expected: N,
        found: bytes.len(),
    })
}

fn decode_stored_path(
    platform: &str,
    bytes: &[u8],
    display: &str,
) -> Result<(PathBuf, bool), StorageError> {
    let platform = PathPlatform::parse(platform)?;
    let decoded = decode_path(platform, bytes, display)?;
    Ok((decoded.path, decoded.lossless))
}

pub(crate) fn system_time_to_nanos(time: SystemTime) -> Option<i64> {
    let duration = time.duration_since(UNIX_EPOCH).ok()?;
    i64::try_from(duration.as_nanos()).ok()
}

pub(crate) fn nanos_to_system_time(nanos: i64) -> Option<SystemTime> {
    let nanos = u64::try_from(nanos).ok()?;
    UNIX_EPOCH.checked_add(Duration::from_nanos(nanos))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps_keep_nanoseconds_and_reject_unrepresentable_values() {
        let nanos = 1_234_567_890_123_456_789i64;
        assert_eq!(
            system_time_to_nanos(nanos_to_system_time(nanos).unwrap()),
            Some(nanos)
        );
        assert_eq!(
            system_time_to_nanos(UNIX_EPOCH - Duration::from_nanos(1)),
            None
        );
        assert_eq!(nanos_to_system_time(-1), None);
        if let Some(time) = UNIX_EPOCH.checked_add(Duration::from_nanos(i64::MAX as u64 + 1)) {
            assert_eq!(system_time_to_nanos(time), None);
        }
        assert_eq!(
            system_time_to_nanos(nanos_to_system_time(i64::MAX).unwrap()),
            Some(i64::MAX)
        );
    }
}
