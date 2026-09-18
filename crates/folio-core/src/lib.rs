//! Folio font catalog core.
//!
//! Phase 1 (`Rust Font Core Foundation`) discovers, parses and organizes
//! font assets independently of any UI or operating system font
//! registration mechanism.
//!
//! The core pipeline is:
//!
//! ```text
//! Font assets -> candidate detection -> parser -> FontFace
//!   -> FontIdentity -> FontRevision -> ContentFingerprint
//!   -> family grouping -> Catalog -> ScanResult (issues + stats)
//! ```
//!
//! Everything is synchronous and blocking. No filesystem watchers,
//! databases, network or platform font APIs are involved.
//!
//! # Example
//!
//! ```no_run
//! use folio_core::{scan_directory, ScanOptions};
//!
//! let result = scan_directory("/Library/Fonts", &ScanOptions::default())?;
//! println!("{} families", result.catalog.family_count());
//! # Ok::<(), folio_core::ScanError>(())
//! ```

#![forbid(unsafe_code)]

mod attributes;
mod catalog;
mod classification;
mod error;
mod face;
mod family;
mod fingerprint;
mod format;
mod identity;
mod ids;
mod names;
mod parser;
mod revision;
mod scan;
mod source;

pub use attributes::{
    AxisCoordinate, FontStyle, FontVersion, FontWeight, FontWidth, NamedInstance, VariableAxis,
};
pub use catalog::Catalog;
pub use classification::{classify_names, FontClassification};
pub use error::{FontError, ParserError, ScanError};
pub use face::{FaceMetadata, FaceProblem, FaceProblemKind, FontFace, ParsedFace, ParsedFontFile};
pub use family::FontFamily;
pub use fingerprint::ContentFingerprint;
pub use format::FontFormat;
pub use identity::{FontIdentity, IdentityKind};
pub use ids::{FontFaceId, FontFamilyId, FontIdentityId, FontRevisionId};
pub use names::{LocalizedName, NameKind, NameLocale};
pub use parser::{parse_font_data, parse_font_file};
pub use revision::FontRevision;
pub use scan::{
    rebuild_catalog, scan, scan_directory, scan_files, IssueKind, IssueSeverity, ScanInput,
    ScanIssue, ScanOptions, ScanResult, ScanStats, CANDIDATE_EXTENSIONS,
};
pub use source::FontSource;
