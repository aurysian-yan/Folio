//! Concrete binary revisions of a logical face.
//!
//! A [`FontRevision`] binds an identity to the exact bytes it was parsed
//! from. Two files with identical content produce the same revision even if
//! they live in different directories; re-exporting the font produces a new
//! revision while keeping the identity.
//!
//! The face discriminator separates faces of a collection, whose members
//! share a single file-level content fingerprint.

use serde::Serialize;

use crate::fingerprint::ContentFingerprint;
use crate::identity::FontIdentity;
use crate::ids::{FontIdentityId, FontRevisionId};

/// One concrete binary revision of a logical face.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FontRevision {
    /// Stable identifier of this revision.
    pub id: FontRevisionId,
    /// Identity this revision belongs to.
    pub identity_id: FontIdentityId,
    /// BLAKE3 fingerprint of the containing file.
    pub content_fingerprint: ContentFingerprint,
    /// Collection member index when the face came from a collection.
    pub face_discriminator: Option<u32>,
}

/// Computes the revision of a parsed face.
pub(crate) fn compute_revision(
    identity: &FontIdentity,
    fingerprint: &ContentFingerprint,
    face_discriminator: Option<u32>,
) -> FontRevision {
    FontRevision {
        id: FontRevisionId::from_parts(identity.id, fingerprint, face_discriminator),
        identity_id: identity.id,
        content_fingerprint: *fingerprint,
        face_discriminator,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::{compute_identity, IdentityNames};

    fn fingerprint(byte: u8) -> ContentFingerprint {
        ContentFingerprint::from_bytes(&[byte; 16])
    }

    fn identity() -> FontIdentity {
        compute_identity(
            IdentityNames {
                postscript_name: Some("MyFont-Regular"),
                ..Default::default()
            },
            &fingerprint(1),
            0,
        )
    }

    #[test]
    fn same_content_same_revision() {
        let identity = identity();
        let a = compute_revision(&identity, &fingerprint(1), None);
        let b = compute_revision(&identity, &fingerprint(1), None);
        assert_eq!(a.id, b.id);
    }

    #[test]
    fn changed_content_changes_revision() {
        let identity = identity();
        let a = compute_revision(&identity, &fingerprint(1), None);
        let b = compute_revision(&identity, &fingerprint(2), None);
        assert_ne!(a.id, b.id);
    }

    #[test]
    fn collection_members_differ() {
        let identity = identity();
        let a = compute_revision(&identity, &fingerprint(1), Some(0));
        let b = compute_revision(&identity, &fingerprint(1), Some(1));
        assert_ne!(a.id, b.id);
    }
}
