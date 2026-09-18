//! The in-memory font catalog.

use serde::Serialize;

use crate::face::FontFace;
use crate::family::FontFamily;
use crate::ids::FontFamilyId;

/// A complete catalog produced by a scan.
///
/// Every successfully parsed face is retained, including faces classified
/// as `Internal` or `SystemLike`. Classification never removes data.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Catalog {
    /// Families, sorted by display name and identifier.
    pub families: Vec<FontFamily>,
}

impl Catalog {
    /// Iterates over every face of every family.
    pub fn faces(&self) -> impl Iterator<Item = &FontFace> {
        self.families.iter().flat_map(|family| family.faces.iter())
    }

    /// Total number of catalog faces.
    pub fn face_count(&self) -> usize {
        self.families.iter().map(|family| family.faces.len()).sum()
    }

    /// Total number of families.
    pub fn family_count(&self) -> usize {
        self.families.len()
    }

    /// Looks up a family by identifier.
    pub fn find_family(&self, id: FontFamilyId) -> Option<&FontFamily> {
        self.families.iter().find(|family| family.id == id)
    }
}
