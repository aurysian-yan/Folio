//! 可重建的目录缓存行。
//!
//! `source_files` 是库根目录下文件级的解析状态，属于纯缓存：每一行都能由
//! 字体文件重建，清空它们不会触碰 `library_roots`。

use rusqlite::{Connection, Row, Transaction};

use folio_core::{FontFormat, FontSource};

use crate::cache_payload::{
    decode_payload, CachedFilePayload, CACHE_PAYLOAD_VERSION, MAX_PAYLOAD_BYTES,
};
use crate::error::StorageError;
use crate::ids::LibraryRootId;
use crate::path_codec::PathPlatform;
use crate::root::id_bytes;

/// 单个来源文件存储的解析结果。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SourceStatus {
    /// 文件解析出至少一个面。
    Parsed,
    /// 已识别但不支持的格式（WOFF/WOFF2）。
    KnownUnsupported,
    /// 文件无法解析。
    Malformed,
}

impl SourceStatus {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            SourceStatus::Parsed => "parsed",
            SourceStatus::KnownUnsupported => "known_unsupported",
            SourceStatus::Malformed => "malformed",
        }
    }

    fn parse(value: &str) -> Result<Self, StorageError> {
        match value {
            "parsed" => Ok(SourceStatus::Parsed),
            "known_unsupported" => Ok(SourceStatus::KnownUnsupported),
            "malformed" => Ok(SourceStatus::Malformed),
            other => Err(StorageError::CorruptCache {
                context: "source_files.status".to_owned(),
                message: format!("unknown status `{other}`"),
            }),
        }
    }
}

/// 物化后的 `source_files` 行。
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CachedSourceRow {
    pub id: i64,
    pub root_id: LibraryRootId,
    pub platform: PathPlatform,
    pub path_bytes: Vec<u8>,
    pub display_path: String,
    pub file_size: u64,
    pub mtime_ns: Option<i64>,
    pub content_hash: Option<[u8; 32]>,
    pub status: SourceStatus,
    pub format: Option<FontFormat>,
    pub payload_version: Option<u32>,
    pub payload: Option<Vec<u8>>,
    pub error_message: Option<String>,
}

impl CachedSourceRow {
    /// 行在其根目录内的稳定键。
    pub(crate) fn path_key(&self) -> Vec<u8> {
        self.path_bytes.clone()
    }
}

/// 为单个来源文件写入的值。
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SourceRowWrite {
    pub root_id: LibraryRootId,
    pub platform: PathPlatform,
    pub path_bytes: Vec<u8>,
    pub display_path: String,
    pub file_size: u64,
    pub mtime_ns: Option<i64>,
    pub content_hash: Option<[u8; 32]>,
    pub status: SourceStatus,
    pub format: Option<FontFormat>,
    pub payload_version: Option<u32>,
    pub payload: Option<Vec<u8>>,
    pub error_message: Option<String>,
}

impl SourceRowWrite {
    /// 仅覆盖已有行的 `size`/`mtime`，保留状态与载荷；供内容哈希快路径使用。
    pub(crate) fn refreshed_metadata_from(
        row: &CachedSourceRow,
        size: u64,
        mtime_ns: Option<i64>,
    ) -> Self {
        Self {
            root_id: row.root_id,
            platform: row.platform,
            path_bytes: row.path_bytes.clone(),
            display_path: row.display_path.clone(),
            file_size: size,
            mtime_ns,
            content_hash: row.content_hash,
            status: row.status,
            format: row.format,
            payload_version: row.payload_version,
            payload: row.payload.clone(),
            error_message: row.error_message.clone(),
        }
    }
}

fn row_columns() -> String {
    format!(
        "id, root_id, path_platform, path_bytes, display_path, file_size, \
        mtime_ns, content_hash, status, format, payload_version, \
        CASE WHEN length(payload) <= {MAX_PAYLOAD_BYTES} THEN payload ELSE NULL END AS payload, \
        length(payload) AS payload_length, error_message"
    )
}

pub(crate) struct RootCacheRows {
    pub valid: Vec<CachedSourceRow>,
    pub invalid: Vec<(i64, String)>,
}

/// 刷新时隔离损坏行；由调用方在根事务中作废并报告。
pub(crate) fn load_rows_for_refresh(
    conn: &Connection,
    root_id: LibraryRootId,
) -> Result<RootCacheRows, StorageError> {
    let mut statement = conn.prepare(&format!(
        "SELECT {} FROM source_files WHERE root_id = ?1",
        row_columns()
    ))?;
    let mut rows = statement.query(rusqlite::params![root_id.as_bytes().as_slice()])?;
    let mut valid = Vec::new();
    let mut invalid = Vec::new();
    while let Some(row) = rows.next()? {
        match read_row(row) {
            Ok(row) => valid.push(row),
            Err(error) => invalid.push((row.get("id")?, error.to_string())),
        }
    }
    Ok(RootCacheRows { valid, invalid })
}

/// 按确定顺序读取所有根目录的全部缓存行。
pub(crate) fn load_all_rows(conn: &Connection) -> Result<Vec<CachedSourceRow>, StorageError> {
    let mut statement = conn.prepare(&format!(
        "SELECT {} FROM source_files ORDER BY root_id, path_bytes",
        row_columns()
    ))?;
    let mut rows = statement.query([])?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        out.push(read_row(row)?);
    }
    Ok(out)
}

fn read_row(row: &Row<'_>) -> Result<CachedSourceRow, StorageError> {
    let id: i64 = row.get("id")?;
    let root_id_bytes: Vec<u8> = row.get("root_id")?;
    let platform: String = row.get("path_platform")?;
    let path_bytes: Vec<u8> = row.get("path_bytes")?;
    let display_path: String = row.get("display_path")?;
    let file_size: i64 = row.get("file_size")?;
    let mtime_ns: Option<i64> = row.get("mtime_ns")?;
    let content_hash: Option<Vec<u8>> = row.get("content_hash")?;
    let status: String = row.get("status")?;
    let format: Option<String> = row.get("format")?;
    let payload_version: Option<i64> = row.get("payload_version")?;
    let payload_length: Option<i64> = row.get("payload_length")?;
    if payload_length.is_some_and(|length| length > MAX_PAYLOAD_BYTES as i64) {
        return Err(corrupt(
            &display_path,
            "payload exceeds 64 MiB metadata limit",
        ));
    }
    let payload: Option<Vec<u8>> = row.get("payload")?;
    let error_message: Option<String> = row.get("error_message")?;

    let content_hash = match content_hash {
        Some(bytes) => Some(id_bytes::<32>(&bytes, "source_files.content_hash")?),
        None => None,
    };

    let result = CachedSourceRow {
        id,
        root_id: LibraryRootId::from_bytes(id_bytes::<16>(&root_id_bytes, "source_files.root_id")?),
        platform: PathPlatform::parse(&platform)?,
        path_bytes,
        display_path: display_path.clone(),
        file_size: u64::try_from(file_size)
            .map_err(|_| corrupt(&display_path, "negative file size"))?,
        mtime_ns,
        content_hash,
        status: SourceStatus::parse(&status)?,
        format: format.as_deref().map(parse_format).transpose()?,
        payload_version: payload_version
            .map(u32::try_from)
            .transpose()
            .map_err(|_| corrupt(&display_path, "payload version out of range"))?,
        payload,
        error_message,
    };
    let decoded =
        crate::path_codec::decode_path(result.platform, &result.path_bytes, &result.display_path)?;
    if !decoded.path.is_absolute() || result.content_hash.is_none() {
        return Err(corrupt(
            &display_path,
            "invalid source path or missing content hash",
        ));
    }
    match result.status {
        SourceStatus::Parsed if result.format.is_none() => {
            return Err(corrupt(&display_path, "parsed row has no format"))
        }
        SourceStatus::KnownUnsupported
            if !matches!(result.format, Some(FontFormat::Woff | FontFormat::Woff2)) =>
        {
            return Err(corrupt(&display_path, "invalid unsupported format"))
        }
        SourceStatus::Malformed if result.error_message.is_none() => {
            return Err(corrupt(&display_path, "malformed row has no diagnostic"))
        }
        _ => {}
    }
    Ok(result)
}

fn corrupt(context: &str, message: &str) -> StorageError {
    StorageError::CorruptCache {
        context: context.to_owned(),
        message: message.to_owned(),
    }
}

/// 版本检查先于解码，并核对文件指纹与载荷的绑定。
pub(crate) fn parsed_payload(row: &CachedSourceRow) -> Result<CachedFilePayload, StorageError> {
    if row.payload_version != Some(CACHE_PAYLOAD_VERSION) {
        return Err(corrupt(&row.display_path, "incompatible payload version"));
    }
    let bytes = row
        .payload
        .as_deref()
        .ok_or_else(|| corrupt(&row.display_path, "missing parsed payload"))?;
    let payload = decode_payload(bytes, &row.display_path)
        .map_err(|error| corrupt(&row.display_path, &error.to_string()))?;
    if payload.faces.is_empty()
        || payload
            .faces
            .iter()
            .any(|face| Some(face.content_fingerprint) != row.content_hash)
    {
        return Err(corrupt(
            &row.display_path,
            "empty payload or mismatched content fingerprint",
        ));
    }
    Ok(payload)
}

/// 插入或替换一条来源行。
pub(crate) fn upsert_row(tx: &Transaction<'_>, write: &SourceRowWrite) -> Result<(), StorageError> {
    tx.execute(
        "INSERT INTO source_files \
         (root_id, path_platform, path_bytes, display_path, file_size, mtime_ns, content_hash, \
          status, format, payload_version, payload, error_message) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) \
         ON CONFLICT(root_id, path_platform, path_bytes) DO UPDATE SET \
          display_path = excluded.display_path, \
          file_size = excluded.file_size, \
          mtime_ns = excluded.mtime_ns, \
          content_hash = excluded.content_hash, \
          status = excluded.status, \
          format = excluded.format, \
          payload_version = excluded.payload_version, \
          payload = excluded.payload, \
          error_message = excluded.error_message",
        rusqlite::params![
            write.root_id.as_bytes().as_slice(),
            write.platform.as_str(),
            write.path_bytes,
            write.display_path,
            i64::try_from(write.file_size)
                .map_err(|_| corrupt(&write.display_path, "file size exceeds SQLite range"))?,
            write.mtime_ns,
            write.content_hash.map(|hash| hash.to_vec()),
            write.status.as_str(),
            write.format.map(format_str),
            write.payload_version.map(i64::from),
            write.payload,
            write.error_message,
        ],
    )?;
    Ok(())
}

/// 按内部行 id 删除一条来源行。
pub(crate) fn delete_row(tx: &Transaction<'_>, id: i64) -> Result<(), StorageError> {
    tx.execute("DELETE FROM source_files WHERE id = ?1", [id])?;
    Ok(())
}

/// 删除所有缓存行；用户持久数据（库根目录）不受影响。
pub(crate) fn clear_all(conn: &Connection) -> Result<u64, StorageError> {
    Ok(conn.execute("DELETE FROM source_files", [])? as u64)
}

/// 由缓存行重建某个面的来源。
pub(crate) fn source_for_row(
    row: &CachedSourceRow,
    face_index: u32,
) -> Result<FontSource, StorageError> {
    let decoded = crate::path_codec::decode_path(row.platform, &row.path_bytes, &row.display_path)?;
    Ok(FontSource::local_file(
        decoded.path,
        face_index,
        row.file_size,
        row.mtime_ns.and_then(crate::root::nanos_to_system_time),
    ))
}

fn format_str(format: FontFormat) -> &'static str {
    match format {
        FontFormat::TrueType => "truetype",
        FontFormat::OpenType => "opentype",
        FontFormat::Collection => "collection",
        FontFormat::Woff => "woff",
        FontFormat::Woff2 => "woff2",
    }
}

fn parse_format(value: &str) -> Result<FontFormat, StorageError> {
    match value {
        "truetype" => Ok(FontFormat::TrueType),
        "opentype" => Ok(FontFormat::OpenType),
        "collection" => Ok(FontFormat::Collection),
        "woff" => Ok(FontFormat::Woff),
        "woff2" => Ok(FontFormat::Woff2),
        other => Err(StorageError::CorruptCache {
            context: "source_files.format".to_owned(),
            message: format!("unknown format `{other}`"),
        }),
    }
}
