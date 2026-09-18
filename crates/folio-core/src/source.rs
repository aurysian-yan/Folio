//! Where a face was found.
//!
//! [`FontSource`] is the only place in the domain model that knows about
//! file system locations. Identities, revisions and fingerprints never
//! contain paths, so moving a file does not change what it *is*.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::ser::Serializer;
use serde::Serialize;

/// Origin of a parsed face.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum FontSource {
    /// A face read from a local font file.
    LocalFile {
        /// Path of the font file.
        path: PathBuf,
        /// Index of the face inside the file. Always `0` for single fonts
        /// and the member index for collections.
        face_index: u32,
        /// Size of the file in bytes at scan time. Auxiliary metadata only;
        /// never used for identity.
        file_size: u64,
        /// Modification time at scan time. Auxiliary metadata only; never
        /// used for identity.
        modified: Option<SystemTime>,
    },
}

impl FontSource {
    /// Creates a local file source.
    pub fn local_file(
        path: impl Into<PathBuf>,
        face_index: u32,
        file_size: u64,
        modified: Option<SystemTime>,
    ) -> Self {
        FontSource::LocalFile {
            path: path.into(),
            face_index,
            file_size,
            modified,
        }
    }

    /// Path of the underlying file.
    pub fn path(&self) -> &Path {
        match self {
            FontSource::LocalFile { path, .. } => path,
        }
    }

    /// Index of the face inside its file.
    pub fn face_index(&self) -> u32 {
        match self {
            FontSource::LocalFile { face_index, .. } => *face_index,
        }
    }
}

impl Serialize for FontSource {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;

        let FontSource::LocalFile {
            path,
            face_index,
            file_size,
            modified,
        } = self;

        let mut state = serializer.serialize_struct("FontSource", 5)?;
        state.serialize_field("location", "local_file")?;
        state.serialize_field("path", &path.to_string_lossy())?;
        state.serialize_field("face_index", face_index)?;
        state.serialize_field("file_size", file_size)?;
        state.serialize_field("modified_unix_ms", &unix_millis(*modified))?;
        state.end()
    }
}

fn unix_millis(time: Option<SystemTime>) -> Option<i64> {
    let duration = time?.duration_since(UNIX_EPOCH).ok()?;
    Some(duration.as_millis() as i64)
}

/// Serializes a path lossily so non-UTF-8 file names never fail a scan.
pub(crate) fn serialize_path<S: Serializer>(path: &Path, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&path.to_string_lossy())
}
