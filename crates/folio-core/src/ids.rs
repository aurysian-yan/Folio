//! Deterministic, domain-separated identifiers.
//!
//! All identifiers in Folio are 128-bit BLAKE3 digests over
//! domain-separated, length-prefixed byte sequences. The exact input layout
//! is part of the public contract and is documented in
//! `docs/architecture.md`:
//!
//! ```text
//! FontFamilyId    = BLAKE3("folio-family\0"    || key)
//! FontIdentityId  = BLAKE3("folio-identity\0"  || identity_key)
//! FontRevisionId  = BLAKE3("folio-revision\0"  || identity_id || content_fingerprint || discriminator)
//! FontFaceId      = BLAKE3("folio-face\0"      || revision_id)
//! ```
//!
//! Every variable-length part is prefixed with its length in little-endian
//! `u64` form, so distinct inputs can never produce ambiguous encodings.
//!
//! Identifiers intentionally do not depend on file paths, file names,
//! modification times or filesystem enumeration order.

use std::fmt;

use serde::ser::Serializer;
use serde::Serialize;

use crate::fingerprint::ContentFingerprint;

const FAMILY_DOMAIN: &[u8] = b"folio-family\0";
const FACE_DOMAIN: &[u8] = b"folio-face\0";
const IDENTITY_DOMAIN: &[u8] = b"folio-identity\0";
const REVISION_DOMAIN: &[u8] = b"folio-revision\0";

/// 128-bit digest backing every public identifier type.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct IdDigest([u8; 16]);

impl IdDigest {
    /// Hashes a domain separated, length prefixed sequence of byte strings.
    fn hash(domain: &[u8], parts: &[&[u8]]) -> Self {
        let mut hasher = blake3::Hasher::new();
        hasher.update(domain);
        for part in parts {
            hasher.update(&(part.len() as u64).to_le_bytes());
            hasher.update(part);
        }
        let mut digest = [0u8; 16];
        hasher.finalize_xof().fill(&mut digest);
        Self(digest)
    }

    pub(crate) fn as_bytes(&self) -> &[u8; 16] {
        &self.0
    }

    fn to_hex(self) -> String {
        use std::fmt::Write as _;

        let mut out = String::with_capacity(32);
        for byte in self.0 {
            let _ = write!(out, "{byte:02x}");
        }
        out
    }
}

macro_rules! define_id {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(IdDigest);

        impl $name {
            /// Raw digest bytes. Not part of the stable user-facing format.
            pub fn as_bytes(&self) -> &[u8; 16] {
                self.0.as_bytes()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0.to_hex())
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, concat!(stringify!($name), "({})"), self.0.to_hex())
            }
        }

        impl Serialize for $name {
            fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.serialize_str(&self.0.to_hex())
            }
        }
    };
}

define_id! {
    /// Stable identifier of a [`crate::FontFamily`].
    ///
    /// Derived from the family grouping key, never from paths or files.
    FontFamilyId
}

define_id! {
    /// Stable identifier of a logical font face (identity).
    ///
    /// Two exports of the same logical face share this identifier.
    FontIdentityId
}

define_id! {
    /// Stable identifier of one concrete binary revision of a face.
    ///
    /// Moving or copying a file does not change it; changing the font
    /// binary does.
    FontRevisionId
}

define_id! {
    /// Stable identifier of a catalog face entry.
    ///
    /// A face entry is one materialized revision of an identity, so this is
    /// a domain-separated function of the revision identifier.
    FontFaceId
}

impl FontFamilyId {
    pub(crate) fn from_family_key(key: &str) -> Self {
        Self(IdDigest::hash(FAMILY_DOMAIN, &[key.as_bytes()]))
    }
}

impl FontIdentityId {
    pub(crate) fn from_identity_key(key: &str) -> Self {
        Self(IdDigest::hash(IDENTITY_DOMAIN, &[key.as_bytes()]))
    }
}

impl FontRevisionId {
    pub(crate) fn from_parts(
        identity_id: FontIdentityId,
        fingerprint: &ContentFingerprint,
        face_discriminator: Option<u32>,
    ) -> Self {
        let mut discriminator = [0u8; 5];
        if let Some(index) = face_discriminator {
            discriminator[0] = 1;
            discriminator[1..].copy_from_slice(&index.to_le_bytes());
        }
        Self(IdDigest::hash(
            REVISION_DOMAIN,
            &[
                identity_id.as_bytes(),
                fingerprint.as_bytes(),
                &discriminator,
            ],
        ))
    }
}

impl FontFaceId {
    pub(crate) fn from_revision(revision_id: FontRevisionId) -> Self {
        Self(IdDigest::hash(FACE_DOMAIN, &[revision_id.as_bytes()]))
    }
}
