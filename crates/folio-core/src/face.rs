//! Faces: parsed metadata plus catalog identity.
//!
//! Two levels are distinguished:
//!
//! * [`ParsedFace`] is the direct output of the parser, tied to exactly one
//!   source and one file.
//! * [`FontFace`] is a catalog entry: it merges all sources that share the
//!   same identity and revision and carries the assigned family.

use std::path::PathBuf;

use serde::Serialize;

use crate::attributes::{
    FontStyle, FontVersion, FontWeight, FontWidth, NamedInstance, VariableAxis,
};
use crate::classification::FontClassification;
use crate::fingerprint::ContentFingerprint;
use crate::format::FontFormat;
use crate::identity::FontIdentity;
use crate::ids::{FontFaceId, FontFamilyId, FontIdentityId, FontRevisionId};
use crate::names::LocalizedName;
use crate::revision::FontRevision;
use crate::source::FontSource;

/// All metadata Folio extracts from a single face.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct FaceMetadata {
    /// Preferred family name (typographic family, else legacy family).
    pub family_name: Option<String>,
    /// Preferred subfamily name (typographic subfamily, else legacy subfamily).
    pub subfamily_name: Option<String>,
    /// Full font name (name ID 4).
    pub full_name: Option<String>,
    /// PostScript name (name ID 6).
    pub postscript_name: Option<String>,
    /// Typographic family name (name ID 16).
    pub typographic_family_name: Option<String>,
    /// Typographic subfamily name (name ID 17).
    pub typographic_subfamily_name: Option<String>,
    /// Legacy family name (name ID 1).
    pub legacy_family_name: Option<String>,
    /// Legacy subfamily name (name ID 2).
    pub legacy_subfamily_name: Option<String>,
    /// Every tracked localized name, deterministically sorted.
    pub localized_names: Vec<LocalizedName>,
    /// Weight class, when declared.
    pub weight: Option<FontWeight>,
    /// Width class, when declared.
    pub width: Option<FontWidth>,
    /// Style / slant.
    pub style: FontStyle,
    /// Declared font version.
    pub font_version: FontVersion,
    /// Units per em from the `head` table.
    pub units_per_em: Option<u16>,
    /// Whether the face declares variation axes.
    pub is_variable: bool,
    /// Declared variation axes, in `fvar` order.
    pub variable_axes: Vec<VariableAxis>,
    /// Named variation instances, in `fvar` order.
    pub named_instances: Vec<NamedInstance>,
}

/// A face as produced by the parser.
///
/// Each parsed face belongs to exactly one source. The catalog merges
/// parsed faces that share a [`FontFaceId`].
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ParsedFace {
    /// Catalog face identifier derived from identity, content and face
    /// discriminator.
    pub id: FontFaceId,
    /// Index of the face inside its file (`0` for single fonts).
    pub face_index: u32,
    /// Container format of the face.
    pub format: FontFormat,
    /// Logical identity of the face.
    pub identity: FontIdentity,
    /// Concrete binary revision of the face.
    pub revision: FontRevision,
    /// Extracted metadata.
    pub metadata: FaceMetadata,
    /// Where the face was read from.
    pub source: FontSource,
}

/// Kind of a per-face problem found while parsing a file.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FaceProblemKind {
    /// A collection member could not be loaded.
    Collection,
    /// A face parsed but its metadata is incomplete.
    Metadata,
}

/// A problem that does not invalidate the whole file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FaceProblem {
    /// Collection member index when applicable.
    pub face_index: Option<u32>,
    /// Problem category.
    pub kind: FaceProblemKind,
    /// Human readable description.
    pub message: String,
}

/// Result of parsing one font file.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ParsedFontFile {
    /// Path the file was read from.
    pub path: PathBuf,
    /// File level format.
    pub format: FontFormat,
    /// BLAKE3 fingerprint of the complete file.
    pub fingerprint: ContentFingerprint,
    /// Successfully parsed faces, in collection order.
    pub faces: Vec<ParsedFace>,
    /// Per-face problems; a non-empty list does not fail the file.
    pub problems: Vec<FaceProblem>,
}

/// A catalog face: one materialized revision of a logical identity.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct FontFace {
    /// Stable face identifier.
    pub id: FontFaceId,
    /// Identity this face belongs to.
    pub identity_id: FontIdentityId,
    /// Revision this face materializes.
    pub revision_id: FontRevisionId,
    /// Family this face was grouped into.
    pub family_id: FontFamilyId,
    /// Container format.
    pub format: FontFormat,
    /// Conservative system/internal classification.
    pub classification: FontClassification,
    /// Extracted metadata.
    #[serde(flatten)]
    pub metadata: FaceMetadata,
    /// All known sources of this exact revision, sorted and deduplicated.
    pub sources: Vec<FontSource>,
}

impl FontFace {
    /// The name to display for this face inside its family.
    pub fn display_subfamily(&self) -> String {
        if let Some(subfamily) = &self.metadata.subfamily_name {
            return subfamily.clone();
        }
        match self.metadata.style {
            FontStyle::Italic => "Italic".to_owned(),
            FontStyle::Oblique { .. } => "Oblique".to_owned(),
            FontStyle::Normal => "Regular".to_owned(),
        }
    }
}
