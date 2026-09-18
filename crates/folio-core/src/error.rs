//! Error types for Folio's font core.
//!
//! Errors keep their semantic kind and, where possible, the underlying
//! source error. Errors are only used for operations that can genuinely
//! fail as a whole; per-file and per-face problems inside a scan are
//! reported as [`crate::ScanIssue`] values instead.

use std::fmt;
use std::path::PathBuf;

use thiserror::Error;

use crate::format::FontFormat;

/// Opaque parser failure.
///
/// The underlying parser type is intentionally private so that the parser
/// implementation can change without breaking Folio's public API.
#[derive(Debug)]
pub struct ParserError {
    source: read_fonts::ReadError,
}

impl ParserError {
    pub(crate) fn new(source: read_fonts::ReadError) -> Self {
        Self { source }
    }
}

impl fmt::Display for ParserError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.source.fmt(f)
    }
}

impl std::error::Error for ParserError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.source)
    }
}

/// Failure while parsing a single font file.
#[derive(Debug, Error)]
pub enum FontError {
    /// The file could not be read from disk.
    #[error("failed to read `{path}`: {source}")]
    Io {
        /// Path that could not be read.
        path: PathBuf,
        /// Underlying I/O error.
        #[source]
        source: std::io::Error,
    },

    /// The file exists but contains no data.
    #[error("`{path}` is empty")]
    EmptyFile {
        /// Path of the empty file.
        path: PathBuf,
    },

    /// The file content does not match any known font signature and is not
    /// associated with a known font extension.
    #[error("`{path}` is not a recognized font format")]
    UnknownFormat {
        /// Path of the unrecognized file.
        path: PathBuf,
    },

    /// The format is recognized but deliberately not supported in this
    /// version of Folio.
    #[error("`{path}` is {format}, which is recognized but not supported in this version")]
    UnsupportedFormat {
        /// Path of the unsupported file.
        path: PathBuf,
        /// Recognized format.
        format: FontFormat,
        /// Human readable note about when support is planned.
        planned: &'static str,
    },

    /// The file looks like a font but could not be parsed.
    #[error("`{path}` is malformed: {source}")]
    Malformed {
        /// Path of the malformed file.
        path: PathBuf,
        /// Parser error describing the first failure.
        #[source]
        source: ParserError,
    },
}

/// Top-level failure of a scan operation.
///
/// Only whole-scan problems are represented here. Problems with individual
/// files are reported through [`crate::ScanIssue`].
#[derive(Debug, Error)]
pub enum ScanError {
    /// The scan root does not exist or cannot be read.
    #[error("scan root `{path}` is not readable: {source}")]
    RootUnreadable {
        /// Root path that could not be read.
        path: PathBuf,
        /// Underlying I/O error.
        #[source]
        source: std::io::Error,
    },

    /// The scan root is not a directory.
    #[error("scan root `{path}` is not a directory")]
    RootNotDirectory {
        /// Root path that is not a directory.
        path: PathBuf,
    },
}
