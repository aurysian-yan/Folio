//! Scan entry points and the shared scan pipeline.
//!
//! Directory scans and explicit file scans differ only in how candidate
//! paths are collected. Parsing, identity, revision, grouping and
//! diagnostics all run through the same pipeline in this module.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Serialize;
use walkdir::WalkDir;

use crate::catalog::Catalog;
use crate::error::{FontError, ScanError};
use crate::face::{FaceProblemKind, ParsedFace};
use crate::family::{build_families, normalize_sources};
use crate::format::FontFormat;
use crate::ids::FontFaceId;
use crate::parser::parse_font_file;
use crate::source::FontSource;

/// File extensions treated as font candidates during directory scans.
///
/// Extensions are only used for candidate detection. Whether a file
/// actually is a font is always decided from its content.
pub const CANDIDATE_EXTENSIONS: &[&str] = &["ttf", "otf", "ttc", "otc", "woff", "woff2"];

/// Options controlling how sources are discovered.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ScanOptions {
    /// Whether directory scans descend into subdirectories.
    pub recursive: bool,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self { recursive: true }
    }
}

/// What to scan.
#[derive(Clone, Copy, Debug)]
pub enum ScanInput<'a> {
    /// A directory (optionally recursive).
    Directory(&'a Path),
    /// An explicit list of font file paths.
    Files(&'a [PathBuf]),
}

/// Severity of a [`ScanIssue`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IssueSeverity {
    /// The scan continued, but something deserves attention.
    Warning,
    /// A file could not be used.
    Error,
}

/// Category of a [`ScanIssue`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IssueKind {
    /// A file or directory could not be read.
    FileRead,
    /// A recognized format (WOFF/WOFF2) that this version cannot parse.
    KnownUnsupportedFormat,
    /// The file is not a valid font.
    MalformedFont,
    /// The face parsed, but metadata is missing or inconsistent.
    MetadataProblem,
    /// A font collection member could not be loaded.
    CollectionProblem,
}

/// A structured diagnostic produced during a scan.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ScanIssue {
    /// Issue severity.
    pub severity: IssueSeverity,
    /// Issue category.
    pub kind: IssueKind,
    /// File the issue belongs to.
    #[serde(serialize_with = "crate::source::serialize_path")]
    pub path: PathBuf,
    /// Collection member index when applicable.
    pub face_index: Option<u32>,
    /// Recognized font format, for `KnownUnsupportedFormat` issues.
    pub format: Option<FontFormat>,
    /// Human readable description.
    pub message: String,
}

impl ScanIssue {
    fn new(
        severity: IssueSeverity,
        kind: IssueKind,
        path: &Path,
        face_index: Option<u32>,
        message: String,
    ) -> Self {
        Self {
            severity,
            kind,
            path: path.to_path_buf(),
            face_index,
            format: None,
            message,
        }
    }

    fn error(kind: IssueKind, path: &Path, face_index: Option<u32>, message: String) -> Self {
        Self::new(IssueSeverity::Error, kind, path, face_index, message)
    }

    fn warning(kind: IssueKind, path: &Path, face_index: Option<u32>, message: String) -> Self {
        Self::new(IssueSeverity::Warning, kind, path, face_index, message)
    }

    fn known_unsupported(path: &Path, format: FontFormat) -> Self {
        let planned = format.planned_support().unwrap_or("a future version");
        Self {
            severity: IssueSeverity::Warning,
            kind: IssueKind::KnownUnsupportedFormat,
            path: path.to_path_buf(),
            face_index: None,
            format: Some(format),
            message: format!(
                "{} is recognized as a font format but is not supported in this version (planned for {planned})",
                format.label()
            ),
        }
    }
}

/// Aggregate statistics of a scan.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct ScanStats {
    /// 目录中遇到的普通文件数；显式扫描为去重后的输入数，包含无效路径。
    pub files_seen: u64,
    /// Files considered font candidates.
    pub candidate_font_files: u64,
    /// Candidate files that produced at least one supported face.
    pub supported_font_files: u64,
    /// Recognized but unsupported files (WOFF/WOFF2).
    pub unsupported_known_font_files: u64,
    /// Faces successfully parsed.
    pub faces_parsed: u64,
    /// Families created after grouping.
    pub families_created: u64,
    /// Files that could not be used.
    pub failed_files: u64,
}

/// The complete outcome of a scan.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ScanResult {
    /// Parsed catalog.
    pub catalog: Catalog,
    /// Structured diagnostics, deterministically sorted.
    pub issues: Vec<ScanIssue>,
    /// Aggregate statistics.
    pub stats: ScanStats,
}

/// Scans a directory or an explicit list of files.
pub fn scan(input: ScanInput<'_>, options: &ScanOptions) -> Result<ScanResult, ScanError> {
    tracing::debug!(?input, recursive = options.recursive, "starting scan");
    let mut stats = ScanStats::default();
    let (candidates, mut issues) = collect_candidates(input, options, &mut stats)?;

    let mut parsed_faces: Vec<ParsedFace> = Vec::new();
    for path in &candidates {
        process_candidate(path, &mut parsed_faces, &mut issues, &mut stats);
    }

    let catalog = build_catalog(parsed_faces);
    stats.families_created = catalog.family_count() as u64;

    issues.sort_by(|a, b| {
        a.path
            .cmp(&b.path)
            .then_with(|| a.face_index.cmp(&b.face_index))
            .then_with(|| a.severity.cmp(&b.severity))
            .then_with(|| a.kind.cmp(&b.kind))
            .then_with(|| a.message.cmp(&b.message))
    });

    tracing::debug!(
        files = stats.files_seen,
        faces = stats.faces_parsed,
        families = stats.families_created,
        issues = issues.len(),
        "scan finished"
    );

    Ok(ScanResult {
        catalog,
        issues,
        stats,
    })
}

/// Scans a directory.
pub fn scan_directory(
    root: impl AsRef<Path>,
    options: &ScanOptions,
) -> Result<ScanResult, ScanError> {
    scan(ScanInput::Directory(root.as_ref()), options)
}

/// Scans an explicit list of font files.
///
/// Every provided path is treated as a candidate regardless of its file
/// extension, which is what a future "Open With Folio" integration needs.
pub fn scan_files(paths: &[PathBuf], options: &ScanOptions) -> Result<ScanResult, ScanError> {
    scan(ScanInput::Files(paths), options)
}

fn collect_candidates(
    input: ScanInput<'_>,
    options: &ScanOptions,
    stats: &mut ScanStats,
) -> Result<(Vec<PathBuf>, Vec<ScanIssue>), ScanError> {
    match input {
        ScanInput::Directory(root) => collect_directory(root, options, stats),
        ScanInput::Files(paths) => {
            let unique = normalize_paths(paths.to_vec());
            stats.files_seen = unique.len() as u64;
            stats.candidate_font_files = unique.len() as u64;
            Ok((unique, Vec::new()))
        }
    }
}

fn collect_directory(
    root: &Path,
    options: &ScanOptions,
    stats: &mut ScanStats,
) -> Result<(Vec<PathBuf>, Vec<ScanIssue>), ScanError> {
    let metadata = std::fs::metadata(root).map_err(|source| ScanError::RootUnreadable {
        path: root.to_path_buf(),
        source,
    })?;
    if !metadata.is_dir() {
        return Err(ScanError::RootNotDirectory {
            path: root.to_path_buf(),
        });
    }
    std::fs::read_dir(root).map_err(|source| ScanError::RootUnreadable {
        path: root.to_path_buf(),
        source,
    })?;

    let depth = if options.recursive { usize::MAX } else { 1 };
    let mut candidates = Vec::new();
    let mut issues = Vec::new();

    for entry in WalkDir::new(root).follow_links(false).max_depth(depth) {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                let path = error
                    .path()
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|| root.to_path_buf());
                issues.push(ScanIssue::error(
                    IssueKind::FileRead,
                    &path,
                    None,
                    error.to_string(),
                ));
                continue;
            }
        };
        if !entry.file_type().is_file() {
            continue;
        }
        stats.files_seen += 1;
        let path = entry.into_path();
        if is_candidate_path(&path) {
            candidates.push(path);
        }
    }

    let candidates = normalize_paths(candidates);
    stats.candidate_font_files = candidates.len() as u64;
    Ok((candidates, issues))
}

/// 已存在的路径归一化后去重；失败路径保留原值，交由读取阶段报告。
fn normalize_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut paths: Vec<_> = paths
        .into_iter()
        .map(|path| path.canonicalize().unwrap_or(path))
        .collect();
    paths.sort();
    paths.dedup();
    paths
}

fn is_candidate_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .and_then(FontFormat::from_extension)
        .is_some()
}

fn process_candidate(
    path: &Path,
    parsed_faces: &mut Vec<ParsedFace>,
    issues: &mut Vec<ScanIssue>,
    stats: &mut ScanStats,
) {
    tracing::debug!(path = %path.display(), "scanning candidate file");
    match parse_font_file(path) {
        Ok(parsed) => {
            if parsed.faces.is_empty() {
                stats.failed_files += 1;
                issues.push(ScanIssue::error(
                    IssueKind::MalformedFont,
                    path,
                    None,
                    "no faces could be parsed".to_owned(),
                ));
                return;
            }
            stats.supported_font_files += 1;
            stats.faces_parsed += parsed.faces.len() as u64;
            for problem in parsed.problems {
                let issue = match problem.kind {
                    FaceProblemKind::Collection => ScanIssue::error(
                        IssueKind::CollectionProblem,
                        path,
                        problem.face_index,
                        problem.message,
                    ),
                    FaceProblemKind::Metadata => ScanIssue::warning(
                        IssueKind::MetadataProblem,
                        path,
                        problem.face_index,
                        problem.message,
                    ),
                };
                issues.push(issue);
            }
            parsed_faces.extend(parsed.faces);
        }
        Err(FontError::UnsupportedFormat { format, .. }) => {
            stats.unsupported_known_font_files += 1;
            issues.push(ScanIssue::known_unsupported(path, format));
        }
        Err(FontError::EmptyFile { .. }) => {
            stats.failed_files += 1;
            issues.push(ScanIssue::error(
                IssueKind::MalformedFont,
                path,
                None,
                "file is empty".to_owned(),
            ));
        }
        Err(FontError::UnknownFormat { .. }) => {
            stats.failed_files += 1;
            issues.push(ScanIssue::error(
                IssueKind::MalformedFont,
                path,
                None,
                "content does not match any known font format".to_owned(),
            ));
        }
        Err(FontError::Malformed { source, .. }) => {
            stats.failed_files += 1;
            issues.push(ScanIssue::error(
                IssueKind::MalformedFont,
                path,
                None,
                source.to_string(),
            ));
        }
        Err(FontError::Io { source, .. }) => {
            stats.failed_files += 1;
            issues.push(ScanIssue::error(
                IssueKind::FileRead,
                path,
                None,
                source.to_string(),
            ));
        }
    }
}

fn build_catalog(parsed_faces: Vec<ParsedFace>) -> Catalog {
    let mut merged: BTreeMap<FontFaceId, (ParsedFace, Vec<FontSource>)> = BTreeMap::new();
    for face in parsed_faces {
        let id = face.id;
        match merged.get_mut(&id) {
            Some((_, sources)) => sources.push(face.source),
            None => {
                let source = face.source.clone();
                merged.insert(id, (face, vec![source]));
            }
        }
    }

    let faces = merged
        .into_values()
        .map(|(parsed, sources)| (parsed, normalize_sources(sources)))
        .collect();

    Catalog {
        families: build_families(faces),
    }
}
