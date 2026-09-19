//! 增量与全量目录刷新。
//!
//! 每个候选文件的决策树：
//!
//! 1. **元数据快路径**（仅增量）：size 与高精度 `mtime` 命中可信缓存行，
//!    直接复用解析状态，不读文件、不 hash、不解析。
//! 2. **内容快路径**：元数据变化，读取并 hash；若与缓存哈希一致（只是
//!    `touch` 而非改内容），仅更新文件系统元数据并复用解析状态。
//! 3. **重新解析**：内容变化或无可信行，嗅探、解析并替换缓存行。
//!
//! 遍历不完整（某个目录无法读取）或根目录暂时不可用时，绝不删除过期行。
//! 每个根目录的变更在文件系统扫描之外用单个事务提交，提交失败时旧缓存
//! 保持完整。

use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};

use serde::ser::Serializer;
use serde::Serialize;
use walkdir::WalkDir;

use folio_core::{
    parse_font_data, rebuild_catalog, Catalog, FaceProblem, FaceProblemKind, FontError, FontFormat,
    ParsedFace,
};

use crate::cache::{self, CachedSourceRow, SourceRowWrite, SourceStatus};
use crate::cache_payload::{encode_payload, CACHE_PAYLOAD_VERSION};
use crate::error::StorageError;
use crate::ids::LibraryRootId;
use crate::path_codec::{decode_path, encode_path, EncodedPath};
use crate::root::{nanos_to_system_time, system_time_to_nanos, LibraryRoot};

/// 刷新如何处理可重建目录缓存。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RefreshMode {
    /// 使用元数据与内容缓存，避免重复工作。
    Incremental,
    /// 忽略缓存解析状态，重新解析每个候选。
    Rebuild,
}

/// 非致命刷新问题的严重级别。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RefreshIssueSeverity {
    /// 刷新继续，但需要关注。
    Warning,
    /// 某个文件或根目录无法使用。
    Error,
}

/// 非致命刷新问题的类别。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RefreshIssueKind {
    /// 库根目录当前缺失或不可读。
    RootUnavailable,
    /// 目录遍历不完整，已抑制删除。
    TraversalIncomplete,
    /// 文件无法读取。
    FileRead,
    /// 文件在读取过程中持续变化。
    UnstableFile,
    /// 已识别但当前版本无法解析的格式。
    KnownUnsupportedFormat,
    /// 不是有效字体。
    MalformedFont,
    /// 面已解析但元数据不完整。
    MetadataProblem,
    /// 集合成员无法加载。
    CollectionProblem,
    /// 缓存行无效并已被作废。
    CacheCorrupt,
    /// 旧版本载荷需要重建，不表示数据库损坏。
    CacheIncompatible,
}

/// 刷新过程中观测到的非致命问题。
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RefreshIssue {
    /// 问题严重级别。
    pub severity: RefreshIssueSeverity,
    /// 问题类别。
    pub kind: RefreshIssueKind,
    /// 所属根目录（已知时）。
    pub root_id: Option<LibraryRootId>,
    /// 所属文件，序列化时使用有损路径。
    #[serde(serialize_with = "serialize_optional_path")]
    pub path: Option<PathBuf>,
    /// 适用的集合成员索引。
    pub face_index: Option<u32>,
    /// `KnownUnsupportedFormat` 问题对应的已识别格式。
    pub format: Option<FontFormat>,
    /// 可读描述。
    pub message: String,
}

fn serialize_optional_path<S: Serializer>(
    path: &Option<PathBuf>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    match path {
        Some(path) => serializer.serialize_some(&path.to_string_lossy()),
        None => serializer.serialize_none(),
    }
}

impl RefreshIssue {
    fn new(
        severity: RefreshIssueSeverity,
        kind: RefreshIssueKind,
        root_id: LibraryRootId,
        path: Option<PathBuf>,
        face_index: Option<u32>,
        message: String,
    ) -> Self {
        Self {
            severity,
            kind,
            root_id: Some(root_id),
            path,
            face_index,
            format: None,
            message,
        }
    }

    fn warning(
        kind: RefreshIssueKind,
        root: &LibraryRoot,
        path: Option<PathBuf>,
        message: String,
    ) -> Self {
        Self::new(
            RefreshIssueSeverity::Warning,
            kind,
            root.id,
            path,
            None,
            message,
        )
    }

    fn error(
        kind: RefreshIssueKind,
        root: &LibraryRoot,
        path: Option<PathBuf>,
        message: String,
    ) -> Self {
        Self::new(
            RefreshIssueSeverity::Error,
            kind,
            root.id,
            path,
            None,
            message,
        )
    }

    fn order(a: &Self, b: &Self) -> std::cmp::Ordering {
        a.root_id
            .cmp(&b.root_id)
            .then_with(|| a.path.cmp(&b.path))
            .then_with(|| a.face_index.cmp(&b.face_index))
            .then_with(|| a.kind.cmp(&b.kind))
            .then_with(|| a.message.cmp(&b.message))
    }
}

/// 证明实际采用了哪些快路径的结构化统计。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct RefreshStats {
    /// 尝试处理的根目录数。
    pub roots_scanned: u64,
    /// 因缺失或不可读而跳过的根目录数。
    pub roots_unavailable: u64,
    /// 遍历遇到目录级错误的根目录数。
    pub roots_incomplete: u64,
    /// 在可用根目录下发现的候选字体文件数。
    pub candidate_files: u64,
    /// 经 size+mtime 快路径复用、未读取的文件数。
    pub metadata_cache_hits: u64,
    /// 字节被读取并 hash 的文件数。
    pub files_hashed: u64,
    /// 重新 hash 后内容哈希未变（未重新解析）的文件数。
    pub content_cache_hits: u64,
    /// 实际解析的文件数（含首次与变更文件）。
    pub files_reparsed: u64,
    /// 无可解码旧行且已成功读取的文件数，包含行结构损坏后的重建。
    pub files_added: u64,
    /// 与可解码旧行相比，内容哈希变化的文件数；单纯重解析不计。
    pub files_changed: u64,
    /// 完整遍历后删除的缓存行数。
    pub files_removed: u64,
    /// 观测到的已识别但不支持的文件数。
    pub known_unsupported: u64,
    /// 观测到的损坏字体文件数。
    pub malformed_files: u64,
    /// 无法读取或解析的文件数。
    pub failed_files: u64,
    /// 读取过程中持续变化的文件数。
    pub unstable_files: u64,
    /// 因损坏而被作废的缓存行数。
    pub cache_corrupt_rows: u64,
    /// 本次刷新解析产生的面数。
    pub faces_parsed: u64,
}

/// 一次刷新的结果。
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RefreshResult {
    /// 在本次选定根目录范围内统一合并、分组的目录。
    pub catalog: Catalog,
    /// 按确定顺序排列的非致命问题。
    pub issues: Vec<RefreshIssue>,
    /// 结构化刷新统计。
    pub stats: RefreshStats,
    /// 生成本结果的模式。
    pub mode: RefreshMode,
}

const MAX_READ_ATTEMPTS: u32 = 3;

struct CandidateFile {
    path: PathBuf,
    size: u64,
    mtime_ns: Option<i64>,
}

struct Enumeration {
    files: Vec<CandidateFile>,
    incomplete: bool,
    issues: Vec<(PathBuf, String)>,
}

/// 刷新给定根目录并返回全局重建的目录。
pub(crate) fn refresh_roots(
    conn: &mut rusqlite::Connection,
    roots: &[LibraryRoot],
    mode: RefreshMode,
) -> Result<RefreshResult, StorageError> {
    let mut stats = RefreshStats::default();
    let mut issues = Vec::new();
    let mut all_faces = Vec::new();

    for root in roots {
        let (faces, root_issues) = refresh_one_root(conn, root, mode, &mut stats)?;
        all_faces.extend(faces);
        issues.extend(root_issues);
    }

    let catalog = rebuild_catalog(all_faces);
    issues.sort_by(RefreshIssue::order);

    tracing::debug!(
        roots = stats.roots_scanned,
        candidates = stats.candidate_files,
        metadata_hits = stats.metadata_cache_hits,
        hashed = stats.files_hashed,
        reparsed = stats.files_reparsed,
        "library refresh finished"
    );

    Ok(RefreshResult {
        catalog,
        issues,
        stats,
        mode,
    })
}

fn refresh_one_root(
    conn: &mut rusqlite::Connection,
    root: &LibraryRoot,
    mode: RefreshMode,
    stats: &mut RefreshStats,
) -> Result<(Vec<ParsedFace>, Vec<RefreshIssue>), StorageError> {
    stats.roots_scanned += 1;
    let cache::RootCacheRows {
        valid: existing_rows,
        invalid: invalid_rows,
    } = cache::load_rows_for_refresh(conn, root.id)?;
    stats.cache_corrupt_rows += invalid_rows.len() as u64;
    let mut invalidated: Vec<i64> = invalid_rows.iter().map(|(id, _)| *id).collect();
    let corrupt_issues: Vec<_> = invalid_rows
        .into_iter()
        .map(|(id, message)| {
            RefreshIssue::warning(
                RefreshIssueKind::CacheCorrupt,
                root,
                None,
                format!("cache row {id} invalidated: {message}"),
            )
        })
        .collect();

    let mut existing_rows = existing_rows;
    let incompatible: std::collections::BTreeSet<_> = existing_rows
        .iter()
        .filter(|row| row.status == SourceStatus::Parsed && row.payload_version == Some(1))
        .map(|row| row.id)
        .collect();
    existing_rows.retain(|row| !incompatible.contains(&row.id));
    let mut corrupt_issues = corrupt_issues;
    for id in &incompatible {
        corrupt_issues.push(RefreshIssue::warning(
            RefreshIssueKind::CacheIncompatible,
            root,
            None,
            format!("cache row {id} uses payload v1 and requires reparse"),
        ));
    }
    let enumeration = match enumerate_root(root) {
        Ok(enumeration) => enumeration,
        Err(error) => {
            stats.roots_unavailable += 1;
            let mut issues = vec![RefreshIssue::error(
                RefreshIssueKind::RootUnavailable,
                root,
                Some(root.path.clone()),
                format!("library root is unavailable; cached entries are kept: {error}"),
            )];
            issues.extend(corrupt_issues);
            let already_invalid = invalidated.len();
            let faces = retained_faces(existing_rows, &mut invalidated);
            if !invalidated.is_empty() {
                stats.cache_corrupt_rows += (invalidated.len() - already_invalid) as u64;
                for id in &invalidated[already_invalid..] {
                    issues.push(RefreshIssue::warning(
                        RefreshIssueKind::CacheCorrupt,
                        root,
                        None,
                        format!("corrupt cache row {id} was invalidated"),
                    ));
                }
                commit_changes(conn, &[], &invalidated)?;
            }
            return Ok((faces, issues));
        }
    };

    invalidated.extend(incompatible);

    if enumeration.incomplete {
        stats.roots_incomplete += 1;
    }
    stats.candidate_files += enumeration.files.len() as u64;

    let mut issues: Vec<RefreshIssue> = enumeration
        .issues
        .iter()
        .map(|(path, message)| {
            RefreshIssue::error(
                RefreshIssueKind::TraversalIncomplete,
                root,
                Some(path.clone()),
                format!("directory traversal was incomplete; deletions are suppressed: {message}"),
            )
        })
        .collect();

    issues.extend(corrupt_issues);
    let mut existing: HashMap<Vec<u8>, CachedSourceRow> = existing_rows
        .into_iter()
        .map(|row| (row.path_key(), row))
        .collect();

    let mut writes: Vec<SourceRowWrite> = Vec::new();
    let mut deletes = invalidated;
    let mut faces: Vec<ParsedFace> = Vec::new();

    for candidate in &enumeration.files {
        let encoded = encode_path(&candidate.path);
        let prior = existing.remove(&encoded.bytes);
        process_candidate(
            root,
            candidate,
            encoded,
            prior,
            mode,
            stats,
            &mut issues,
            &mut writes,
            &mut faces,
            read_stable,
        )?;
    }

    if !enumeration.incomplete {
        for row in existing.into_values() {
            deletes.push(row.id);
            stats.files_removed += 1;
        }
    } else {
        // 遍历不完整：未见过的缓存行保留，并继续向返回目录贡献面。
        let retained: Vec<CachedSourceRow> = existing.into_values().collect();
        let mut invalidated = Vec::new();
        faces.extend(retained_faces(retained, &mut invalidated));
        if !invalidated.is_empty() {
            stats.cache_corrupt_rows += invalidated.len() as u64;
            for id in &invalidated {
                issues.push(RefreshIssue::warning(
                    RefreshIssueKind::CacheCorrupt,
                    root,
                    None,
                    format!("corrupt cache row {id} was invalidated"),
                ));
            }
            deletes.extend(invalidated);
        }
    }

    commit_changes(conn, &writes, &deletes)?;

    Ok((faces, issues))
}

/// 原子地应用暂存的缓存变更。
///
/// 所有写入与删除要么全部提交，要么全部不提交；失败时旧缓存保持不变。
/// 文件系统扫描与解析在本函数之前完成，因此读取字体期间不持有写事务。
pub(crate) fn commit_changes(
    conn: &mut rusqlite::Connection,
    writes: &[SourceRowWrite],
    deletes: &[i64],
) -> Result<(), StorageError> {
    let tx = conn
        .transaction()
        .map_err(|source| StorageError::Transaction { source })?;
    for id in deletes {
        cache::delete_row(&tx, *id)?;
    }
    for write in writes {
        cache::upsert_row(&tx, write)?;
    }
    tx.commit()
        .map_err(|source| StorageError::Transaction { source })
}

#[allow(clippy::too_many_arguments)]
fn process_candidate(
    root: &LibraryRoot,
    candidate: &CandidateFile,
    encoded: EncodedPath,
    prior: Option<CachedSourceRow>,
    mode: RefreshMode,
    stats: &mut RefreshStats,
    issues: &mut Vec<RefreshIssue>,
    writes: &mut Vec<SourceRowWrite>,
    faces: &mut Vec<ParsedFace>,
    read: impl FnOnce(&Path) -> ReadOutcome,
) -> Result<(), StorageError> {
    let mut invalid_payload = false;
    if mode == RefreshMode::Incremental {
        if let Some(row) = &prior {
            if metadata_matches(row, candidate) {
                match try_reuse(row, root, issues, stats) {
                    Reuse::Reused(reused_faces) => {
                        stats.metadata_cache_hits += 1;
                        faces.extend(reused_faces);
                        return Ok(());
                    }
                    Reuse::Invalidate => {
                        invalid_payload = true;
                        report_corrupt(root, candidate, stats, issues);
                    }
                }
            }
        }
    }

    let (data, size, mtime_ns) = match read(&candidate.path) {
        ReadOutcome::Stable {
            data,
            size,
            mtime_ns,
        } => (data, size, mtime_ns),
        ReadOutcome::Unstable => {
            stats.unstable_files += 1;
            stats.failed_files += 1;
            issues.push(RefreshIssue::warning(
                RefreshIssueKind::UnstableFile,
                root,
                Some(candidate.path.clone()),
                "file kept changing while it was read; previous cache is stale and excluded from this result".to_owned(),
            ));
            invalidate_metadata(&prior, writes);
            return Ok(());
        }
        ReadOutcome::Failed(error) => {
            stats.failed_files += 1;
            issues.push(RefreshIssue::error(
                RefreshIssueKind::FileRead,
                root,
                Some(candidate.path.clone()),
                format!("{error}; previous cache is stale and excluded from this result"),
            ));
            invalidate_metadata(&prior, writes);
            return Ok(());
        }
    };

    stats.files_hashed += 1;
    let hash = *blake3::hash(&data).as_bytes();

    if mode == RefreshMode::Incremental && !invalid_payload {
        if let Some(row) = &prior {
            if row.content_hash == Some(hash) {
                let mut updated = row.clone();
                updated.file_size = size;
                updated.mtime_ns = mtime_ns;
                match try_reuse(&updated, root, issues, stats) {
                    Reuse::Reused(reused_faces) => {
                        stats.content_cache_hits += 1;
                        writes.push(SourceRowWrite::refreshed_metadata_from(row, size, mtime_ns));
                        faces.extend(reused_faces);
                        return Ok(());
                    }
                    Reuse::Invalidate => {
                        report_corrupt(root, candidate, stats, issues);
                    }
                }
            }
        }
    }

    stats.files_reparsed += 1;
    match &prior {
        Some(row) if row.content_hash != Some(hash) => stats.files_changed += 1,
        None => stats.files_added += 1,
        _ => {}
    }

    let write = classify_file(
        root, candidate, encoded, &data, size, mtime_ns, hash, stats, issues, faces,
    )?;
    writes.push(write);
    Ok(())
}

/// 失败读取保留旧快照，但撤销元数据快路径资格。
fn invalidate_metadata(prior: &Option<CachedSourceRow>, writes: &mut Vec<SourceRowWrite>) {
    if let Some(row) = prior {
        writes.push(SourceRowWrite::refreshed_metadata_from(
            row,
            row.file_size,
            None,
        ));
    }
}

#[allow(clippy::too_many_arguments)]
fn classify_file(
    root: &LibraryRoot,
    candidate: &CandidateFile,
    encoded: EncodedPath,
    data: &[u8],
    size: u64,
    mtime_ns: Option<i64>,
    hash: [u8; 32],
    stats: &mut RefreshStats,
    issues: &mut Vec<RefreshIssue>,
    faces: &mut Vec<ParsedFace>,
) -> Result<SourceRowWrite, StorageError> {
    let base = || SourceRowWrite {
        root_id: root.id,
        platform: encoded.platform,
        path_bytes: encoded.bytes.clone(),
        display_path: encoded.display.clone(),
        file_size: size,
        mtime_ns,
        content_hash: Some(hash),
        status: SourceStatus::Parsed,
        format: None,
        payload_version: Some(CACHE_PAYLOAD_VERSION),
        payload: None,
        error_message: None,
    };

    match parse_font_data(
        &candidate.path,
        data,
        size,
        mtime_ns.and_then(nanos_to_system_time),
    ) {
        Ok(parsed) => {
            stats.faces_parsed += parsed.faces.len() as u64;
            for problem in &parsed.problems {
                issues.push(problem_issue(root, &candidate.path, problem));
            }
            faces.extend(parsed.faces.clone());
            let mut write = base();
            write.format = Some(parsed.format);
            write.payload = Some(encode_payload(&parsed)?);
            Ok(write)
        }
        Err(FontError::UnsupportedFormat { format, .. }) => {
            stats.known_unsupported += 1;
            issues.push(known_unsupported_issue(root, &candidate.path, format));
            let mut write = base();
            write.status = SourceStatus::KnownUnsupported;
            write.format = Some(format);
            write.payload_version = None;
            Ok(write)
        }
        Err(error) => {
            stats.malformed_files += 1;
            stats.failed_files += 1;
            let message = describe_font_error(&error);
            issues.push(RefreshIssue::error(
                RefreshIssueKind::MalformedFont,
                root,
                Some(candidate.path.clone()),
                message.clone(),
            ));
            let mut write = base();
            write.status = SourceStatus::Malformed;
            write.payload_version = None;
            write.error_message = Some(message);
            Ok(write)
        }
    }
}

enum Reuse {
    Reused(Vec<ParsedFace>),
    Invalidate,
}

fn try_reuse(
    row: &CachedSourceRow,
    root: &LibraryRoot,
    issues: &mut Vec<RefreshIssue>,
    stats: &mut RefreshStats,
) -> Reuse {
    let path = row_path(row);
    match row.status {
        SourceStatus::Parsed => {
            let payload = match cache::parsed_payload(row) {
                Ok(payload) => payload,
                Err(_) => return Reuse::Invalidate,
            };
            let mut faces = Vec::with_capacity(payload.faces.len());
            for face in &payload.faces {
                let source = match cache::source_for_row(row, face.face_index) {
                    Ok(source) => source,
                    Err(_) => return Reuse::Invalidate,
                };
                faces.push(face.to_parsed_face(source));
            }
            for problem in &payload.problems {
                issues.push(problem_issue(root, &path, &problem.to_problem()));
            }
            Reuse::Reused(faces)
        }
        SourceStatus::KnownUnsupported => {
            let format = row.format.unwrap_or(FontFormat::Woff);
            stats.known_unsupported += 1;
            issues.push(known_unsupported_issue(root, &path, format));
            Reuse::Reused(Vec::new())
        }
        SourceStatus::Malformed => {
            stats.malformed_files += 1;
            stats.failed_files += 1;
            let message = row
                .error_message
                .clone()
                .unwrap_or_else(|| "stored malformed font result".to_owned());
            issues.push(RefreshIssue::error(
                RefreshIssueKind::MalformedFont,
                root,
                Some(path),
                message,
            ));
            Reuse::Reused(Vec::new())
        }
    }
}

fn report_corrupt(
    root: &LibraryRoot,
    candidate: &CandidateFile,
    stats: &mut RefreshStats,
    issues: &mut Vec<RefreshIssue>,
) {
    stats.cache_corrupt_rows += 1;
    issues.push(RefreshIssue::warning(
        RefreshIssueKind::CacheCorrupt,
        root,
        Some(candidate.path.clone()),
        "cached parse state was invalid and is being rebuilt".to_owned(),
    ));
}

/// 从本次刷新未访问的缓存行重建面（根目录不可用或遍历不完整）。
/// 损坏行通过 `invalidated` 返回，供调用方删除并重建；其余行原样保留。
fn retained_faces(rows: Vec<CachedSourceRow>, invalidated: &mut Vec<i64>) -> Vec<ParsedFace> {
    let mut faces = Vec::new();
    for row in rows {
        if row.status != SourceStatus::Parsed {
            continue;
        }
        let payload = match cache::parsed_payload(&row) {
            Ok(payload) => payload,
            Err(_) => {
                invalidated.push(row.id);
                continue;
            }
        };
        let mut local = Vec::with_capacity(payload.faces.len());
        let mut valid = true;
        for face in &payload.faces {
            match cache::source_for_row(&row, face.face_index) {
                Ok(source) => local.push(face.to_parsed_face(source)),
                Err(_) => {
                    valid = false;
                    break;
                }
            }
        }
        if valid {
            faces.extend(local);
        } else {
            invalidated.push(row.id);
        }
    }
    faces
}

fn metadata_matches(row: &CachedSourceRow, candidate: &CandidateFile) -> bool {
    row.file_size == candidate.size && row.mtime_ns.is_some() && row.mtime_ns == candidate.mtime_ns
}

fn row_path(row: &CachedSourceRow) -> PathBuf {
    decode_path(row.platform, &row.path_bytes, &row.display_path)
        .map(|decoded| decoded.path)
        .unwrap_or_else(|_| PathBuf::from(&row.display_path))
}

fn known_unsupported_issue(root: &LibraryRoot, path: &Path, format: FontFormat) -> RefreshIssue {
    let planned = format.planned_support().unwrap_or("a future version");
    let mut issue = RefreshIssue::warning(
        RefreshIssueKind::KnownUnsupportedFormat,
        root,
        Some(path.to_path_buf()),
        format!(
            "{} is recognized as a font format but is not supported in this version (planned for {planned})",
            format.label()
        ),
    );
    issue.format = Some(format);
    issue
}

fn problem_issue(root: &LibraryRoot, path: &Path, problem: &FaceProblem) -> RefreshIssue {
    match problem.kind {
        FaceProblemKind::Collection => RefreshIssue::new(
            RefreshIssueSeverity::Error,
            RefreshIssueKind::CollectionProblem,
            root.id,
            Some(path.to_path_buf()),
            problem.face_index,
            problem.message.clone(),
        ),
        FaceProblemKind::Metadata => RefreshIssue::new(
            RefreshIssueSeverity::Warning,
            RefreshIssueKind::MetadataProblem,
            root.id,
            Some(path.to_path_buf()),
            problem.face_index,
            problem.message.clone(),
        ),
    }
}

fn describe_font_error(error: &FontError) -> String {
    match error {
        FontError::EmptyFile { .. } => "file is empty".to_owned(),
        FontError::UnknownFormat { .. } => {
            "content does not match any known font format".to_owned()
        }
        FontError::Malformed { source, .. } => source.to_string(),
        FontError::Io { source, .. } => source.to_string(),
        FontError::UnsupportedFormat { format, .. } => {
            format!("unsupported format {}", format.label())
        }
    }
}

fn enumerate_root(root: &LibraryRoot) -> io::Result<Enumeration> {
    enumerate_root_with(root, |path| path.canonicalize())
}

fn enumerate_root_with(
    root: &LibraryRoot,
    canonicalize: impl Fn(&Path) -> io::Result<PathBuf>,
) -> io::Result<Enumeration> {
    let metadata = std::fs::metadata(&root.path)?;
    if !metadata.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "library root is not a directory",
        ));
    }
    std::fs::read_dir(&root.path)?;

    let depth = if root.recursive { usize::MAX } else { 1 };
    let mut files = Vec::new();
    let mut incomplete = false;
    let mut issues = Vec::new();

    for entry in WalkDir::new(&root.path)
        .follow_links(false)
        .max_depth(depth)
    {
        match entry {
            Ok(entry) => {
                if !entry.file_type().is_file() {
                    continue;
                }
                let raw = entry.into_path();
                if !is_candidate_path(&raw) {
                    continue;
                }
                // 与 core 的显式扫描一致：已存在路径先规范化，保证缓存与实时扫描同源。
                let path = match canonicalize(&raw) {
                    Ok(path) => path,
                    Err(error) => {
                        incomplete = true;
                        issues.push((raw, format!("canonicalization failed: {error}")));
                        continue;
                    }
                };
                match std::fs::metadata(&path) {
                    Ok(metadata) => files.push(CandidateFile {
                        path,
                        size: metadata.len(),
                        mtime_ns: metadata.modified().ok().and_then(system_time_to_nanos),
                    }),
                    Err(error) => {
                        incomplete = true;
                        issues.push((path, error.to_string()));
                    }
                }
            }
            Err(error) => {
                incomplete = true;
                let path = error
                    .path()
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|| root.path.clone());
                issues.push((path, error.to_string()));
            }
        }
    }

    files.sort_by(|a, b| a.path.cmp(&b.path));
    files.dedup_by(|a, b| a.path == b.path);
    Ok(Enumeration {
        files,
        incomplete,
        issues,
    })
}

fn is_candidate_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .and_then(FontFormat::from_extension)
        .is_some()
}

enum ReadOutcome {
    Stable {
        data: Vec<u8>,
        size: u64,
        mtime_ns: Option<i64>,
    },
    Unstable,
    Failed(io::Error),
}

fn read_stable(path: &Path) -> ReadOutcome {
    read_stable_with(path, |path| std::fs::read(path))
}

fn read_stable_with(
    path: &Path,
    mut read: impl FnMut(&Path) -> io::Result<Vec<u8>>,
) -> ReadOutcome {
    for _ in 0..MAX_READ_ATTEMPTS {
        let before = match std::fs::metadata(path) {
            Ok(metadata) => metadata,
            Err(error) => return ReadOutcome::Failed(error),
        };
        if !before.is_file() {
            return ReadOutcome::Failed(io::Error::new(
                io::ErrorKind::InvalidInput,
                "source is not a regular file",
            ));
        }
        let data = match read(path) {
            Ok(data) => data,
            Err(error) => return ReadOutcome::Failed(error),
        };
        let after = match std::fs::metadata(path) {
            Ok(metadata) => metadata,
            Err(error) => return ReadOutcome::Failed(error),
        };
        let before_state = (before.len(), before.modified().ok());
        let after_state = (after.len(), after.modified().ok());
        if before_state.1.is_some()
            && before_state == after_state
            && after.is_file()
            && data.len() as u64 == after.len()
        {
            return ReadOutcome::Stable {
                data,
                size: after.len(),
                mtime_ns: after_state.1.and_then(system_time_to_nanos),
            };
        }
    }
    ReadOutcome::Unstable
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_read_retries_and_rejects_short_or_changing_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("font.ttf");
        std::fs::write(&path, b"123").unwrap();
        let mut attempts = 0;
        let result = read_stable_with(&path, |path| {
            attempts += 1;
            let old = std::fs::read(path)?;
            let mut next = old.clone();
            next.push(0);
            std::fs::write(path, next)?;
            Ok(old)
        });
        assert!(matches!(result, ReadOutcome::Unstable));
        assert_eq!(attempts, 3);
        assert!(matches!(
            read_stable_with(&path, |_| Ok(vec![])),
            ReadOutcome::Unstable
        ));
        let mut attempts = 0;
        let result = read_stable_with(&path, |path| {
            attempts += 1;
            if attempts == 1 {
                std::fs::write(path, b"changed length")?;
            }
            std::fs::read(path)
        });
        assert!(matches!(result, ReadOutcome::Stable { .. }));
        assert_eq!(attempts, 2);
    }

    #[test]
    fn failed_or_unstable_read_excludes_old_face_and_revokes_metadata_trust() {
        for unstable in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("font.ttf");
            std::fs::copy(
                Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/fonts/Lato-Regular.ttf"),
                &path,
            )
            .unwrap();
            let path = path.canonicalize().unwrap();
            let mut conn = rusqlite::Connection::open_in_memory().unwrap();
            crate::schema::migrate(&mut conn).unwrap();
            let root = match crate::root::add_root(&conn, dir.path(), true).unwrap() {
                crate::AddRootOutcome::Created(root) => root,
                _ => unreachable!(),
            };
            refresh_roots(
                &mut conn,
                std::slice::from_ref(&root),
                RefreshMode::Incremental,
            )
            .unwrap();
            let cache::RootCacheRows {
                valid: mut rows, ..
            } = cache::load_rows_for_refresh(&conn, root.id).unwrap();
            let prior = rows.pop().unwrap();
            let candidate = CandidateFile {
                path: path.clone(),
                size: prior.file_size,
                mtime_ns: prior.mtime_ns,
            };
            let mut stats = RefreshStats::default();
            let mut issues = Vec::new();
            let mut writes = Vec::new();
            let mut faces = Vec::new();
            process_candidate(
                &root,
                &candidate,
                encode_path(&path),
                Some(prior.clone()),
                RefreshMode::Rebuild,
                &mut stats,
                &mut issues,
                &mut writes,
                &mut faces,
                |_| {
                    if unstable {
                        ReadOutcome::Unstable
                    } else {
                        ReadOutcome::Failed(io::Error::new(
                            io::ErrorKind::PermissionDenied,
                            "denied",
                        ))
                    }
                },
            )
            .unwrap();
            assert!(faces.is_empty());
            assert_eq!(stats.failed_files, 1);
            assert_eq!(stats.unstable_files, u64::from(unstable));
            assert_eq!(
                issues[0].kind,
                if unstable {
                    RefreshIssueKind::UnstableFile
                } else {
                    RefreshIssueKind::FileRead
                }
            );
            commit_changes(&mut conn, &writes, &[]).unwrap();
            let cache::RootCacheRows { valid: rows, .. } =
                cache::load_rows_for_refresh(&conn, root.id).unwrap();
            assert_eq!(rows[0].mtime_ns, None);
            assert_eq!(rows[0].content_hash, prior.content_hash);
            assert_eq!(rows[0].payload, prior.payload);
            let recovered = refresh_roots(&mut conn, &[root], RefreshMode::Incremental).unwrap();
            assert_eq!(recovered.stats.metadata_cache_hits, 0);
            assert_eq!(recovered.stats.files_hashed, 1);
            assert_eq!(recovered.stats.content_cache_hits, 1);
            assert_eq!(recovered.catalog.face_count(), 1);
        }
    }

    #[test]
    fn canonicalization_failure_is_incomplete_and_not_a_candidate_alias() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("font.ttf"), b"font").unwrap();
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::schema::migrate(&mut conn).unwrap();
        let root = match crate::root::add_root(&conn, dir.path(), true).unwrap() {
            crate::AddRootOutcome::Created(root) => root,
            _ => unreachable!(),
        };
        let enumeration = enumerate_root_with(&root, |_| {
            Err(io::Error::new(io::ErrorKind::PermissionDenied, "denied"))
        })
        .unwrap();
        assert!(enumeration.incomplete);
        assert!(enumeration.files.is_empty());
        assert_eq!(enumeration.issues.len(), 1);
    }
}
