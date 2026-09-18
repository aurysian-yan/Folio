//! Logical font identity.
//!
//! A [`FontIdentity`] answers "which logical face is this?" and is derived
//! from internal font metadata only. Re-exporting `MyFont Regular` with a
//! new version keeps the identity and changes only the revision.
//!
//! Strategy (documented in `docs/architecture.md`):
//!
//! 1. PostScript name (name ID 6)
//! 2. Typographic family + subfamily (name IDs 16/17)
//! 3. Legacy family + subfamily (name IDs 1/2)
//! 4. Full name (name ID 4)
//! 5. Content based fallback for fonts without usable names
//!
//! Paths, file names, modification times and content hashes are never used
//! unless the font exposes no usable name at all, in which case a marker
//! records that the content-based fallback was taken.

use serde::Serialize;

use crate::fingerprint::ContentFingerprint;
use crate::ids::FontIdentityId;

/// Which metadata source produced an identity.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IdentityKind {
    /// Identity was taken from the PostScript name.
    PostScriptName,
    /// Identity was taken from typographic family/subfamily names.
    TypographicNames,
    /// Identity was taken from legacy family/subfamily names.
    LegacyNames,
    /// Identity was taken from the full font name.
    FullName,
    /// The font had no usable names; identity falls back to content.
    ContentFallback,
}

/// A logical font face.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FontIdentity {
    /// Stable identifier derived from the identity key.
    pub id: FontIdentityId,
    /// Which metadata produced the identity.
    pub kind: IdentityKind,
    /// Best available human readable name for this identity.
    pub canonical_name: Option<String>,
}

impl FontIdentity {
    fn new(kind: IdentityKind, key: String, canonical_name: Option<String>) -> Self {
        Self {
            id: FontIdentityId::from_identity_key(&key),
            kind,
            canonical_name,
        }
    }
}

/// Trims a name and collapses internal whitespace runs to single spaces.
pub(crate) fn normalize_name(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }
    let mut out = String::with_capacity(value.len());
    let mut last_was_space = false;
    for ch in value.chars() {
        if ch.is_whitespace() {
            if !last_was_space {
                out.push(' ');
                last_was_space = true;
            }
        } else {
            out.push(ch);
            last_was_space = false;
        }
    }
    Some(out)
}

/// Metadata inputs used to derive an identity.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct IdentityNames<'a> {
    pub postscript_name: Option<&'a str>,
    pub typographic_family: Option<&'a str>,
    pub typographic_subfamily: Option<&'a str>,
    pub legacy_family: Option<&'a str>,
    pub legacy_subfamily: Option<&'a str>,
    pub full_name: Option<&'a str>,
}

/// Computes the identity of a face.
pub(crate) fn compute_identity(
    names: IdentityNames<'_>,
    fingerprint: &ContentFingerprint,
    face_index: u32,
) -> FontIdentity {
    if let Some(ps_name) = normalize_name(names.postscript_name) {
        let key = format!("ps\u{0}{ps_name}");
        return FontIdentity::new(IdentityKind::PostScriptName, key, Some(ps_name));
    }

    if let (Some(family), Some(subfamily)) = (
        normalize_name(names.typographic_family),
        normalize_name(names.typographic_subfamily),
    ) {
        let key = format!("typo\u{0}{family}\u{0}{subfamily}");
        let canonical = format!("{family} {subfamily}");
        return FontIdentity::new(IdentityKind::TypographicNames, key, Some(canonical));
    }

    if let (Some(family), Some(subfamily)) = (
        normalize_name(names.legacy_family),
        normalize_name(names.legacy_subfamily),
    ) {
        let key = format!("legacy\u{0}{family}\u{0}{subfamily}");
        let canonical = format!("{family} {subfamily}");
        return FontIdentity::new(IdentityKind::LegacyNames, key, Some(canonical));
    }

    if let Some(full_name) = normalize_name(names.full_name) {
        let key = format!("full\u{0}{full_name}");
        return FontIdentity::new(IdentityKind::FullName, key, Some(full_name));
    }

    let key = format!("content\u{0}{}\u{0}{face_index}", fingerprint.to_hex());
    FontIdentity::new(IdentityKind::ContentFallback, key, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fingerprint(byte: u8) -> ContentFingerprint {
        ContentFingerprint::from_bytes(&[byte; 16])
    }

    #[test]
    fn postscript_name_wins() {
        let identity = compute_identity(
            IdentityNames {
                postscript_name: Some("MyFont-Regular"),
                typographic_family: Some("MyFont"),
                typographic_subfamily: Some("Regular"),
                ..Default::default()
            },
            &fingerprint(1),
            0,
        );
        assert_eq!(identity.kind, IdentityKind::PostScriptName);
        assert_eq!(identity.canonical_name.as_deref(), Some("MyFont-Regular"));
    }

    #[test]
    fn identity_ignores_fingerprint_when_names_exist() {
        let names = IdentityNames {
            postscript_name: Some("MyFont-Regular"),
            ..Default::default()
        };
        let a = compute_identity(names, &fingerprint(1), 0);
        let b = compute_identity(names, &fingerprint(2), 0);
        assert_eq!(a.id, b.id);
    }

    #[test]
    fn whitespace_is_normalized() {
        let a = compute_identity(
            IdentityNames {
                postscript_name: Some("  MyFont-Regular  "),
                ..Default::default()
            },
            &fingerprint(1),
            0,
        );
        let b = compute_identity(
            IdentityNames {
                postscript_name: Some("MyFont-Regular"),
                ..Default::default()
            },
            &fingerprint(2),
            0,
        );
        assert_eq!(a.id, b.id);
    }

    #[test]
    fn typographic_pair_beats_legacy_pair() {
        let identity = compute_identity(
            IdentityNames {
                typographic_family: Some("MyFont"),
                typographic_subfamily: Some("Regular"),
                legacy_family: Some("MyFont Regular"),
                legacy_subfamily: Some("Regular"),
                ..Default::default()
            },
            &fingerprint(1),
            0,
        );
        assert_eq!(identity.kind, IdentityKind::TypographicNames);
    }

    #[test]
    fn content_fallback_is_face_specific() {
        let a = compute_identity(IdentityNames::default(), &fingerprint(1), 0);
        let b = compute_identity(IdentityNames::default(), &fingerprint(1), 1);
        assert_eq!(a.kind, IdentityKind::ContentFallback);
        assert_ne!(a.id, b.id);
    }

    #[test]
    fn domain_separation_produces_distinct_ids() {
        let identity = compute_identity(
            IdentityNames {
                postscript_name: Some("MyFont-Regular"),
                ..Default::default()
            },
            &fingerprint(1),
            0,
        );
        let revision = crate::revision::compute_revision(&identity, &fingerprint(1), None);
        assert_ne!(identity.id.as_bytes(), revision.id.as_bytes());
    }
}
