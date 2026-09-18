//! Content fingerprints of font binaries.
//!
//! A [`ContentFingerprint`] answers "which bytes is this?" and deliberately
//! contains no path, file name or modification time. Copying a font file
//! therefore preserves its fingerprint, while editing the bytes always
//! changes it.

use std::fmt;

use serde::ser::Serializer;
use serde::Serialize;

/// BLAKE3 hash of a complete font file's bytes.
///
/// Phase 1 always hashes the full file. Metadata caches and hash shortcuts
/// are explicitly out of scope.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ContentFingerprint([u8; 32]);

impl ContentFingerprint {
    /// Computes the fingerprint of an in-memory font binary.
    pub fn from_bytes(data: &[u8]) -> Self {
        Self(*blake3::hash(data).as_bytes())
    }

    /// Lowercase hexadecimal representation of the BLAKE3 digest.
    pub fn to_hex(&self) -> String {
        use std::fmt::Write as _;

        let mut out = String::with_capacity(64);
        for byte in self.0 {
            let _ = write!(out, "{byte:02x}");
        }
        out
    }

    pub(crate) fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl fmt::Display for ContentFingerprint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_hex())
    }
}

impl fmt::Debug for ContentFingerprint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ContentFingerprint({})", self.to_hex())
    }
}

impl Serialize for ContentFingerprint {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_hex())
    }
}
