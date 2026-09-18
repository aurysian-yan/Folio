//! Font format model and content based format sniffing.
//!
//! [`FontFormat`] describes the container/outline technology of a font
//! asset. It never implies anything about whether an operating system can
//! install or activate the font; see `docs/architecture.md` for the
//! Managed != Installable decision.
//!
//! File extensions are only used for candidate detection. The authoritative
//! format is always derived from the file's magic bytes.

use serde::Serialize;

/// Container format of a font asset.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FontFormat {
    /// Single sfnt font with TrueType outlines.
    TrueType,
    /// Single sfnt font with CFF/CFF2 outlines (`OTTO`).
    OpenType,
    /// `ttcf` collection whose members use TrueType outlines.
    TrueTypeCollection,
    /// `ttcf` collection whose members use CFF/CFF2 outlines.
    OpenTypeCollection,
    /// WOFF 1.0. Recognized, planned for Folio v2.
    Woff,
    /// WOFF 2.0. Recognized, planned for Folio v2.
    Woff2,
}

impl FontFormat {
    /// Formats that Folio can parse in the current version.
    pub const SUPPORTED: &'static [FontFormat] = &[
        FontFormat::TrueType,
        FontFormat::OpenType,
        FontFormat::TrueTypeCollection,
        FontFormat::OpenTypeCollection,
    ];

    /// Formats that Folio recognizes but cannot parse in the current version.
    pub const KNOWN_UNSUPPORTED: &'static [FontFormat] = &[FontFormat::Woff, FontFormat::Woff2];

    /// Returns true when Folio can parse this format in the current version.
    pub fn is_supported(self) -> bool {
        Self::SUPPORTED.contains(&self)
    }

    /// Returns true for collection formats (`.ttc` / `.otc`).
    pub fn is_collection(self) -> bool {
        matches!(
            self,
            FontFormat::TrueTypeCollection | FontFormat::OpenTypeCollection
        )
    }

    /// Planned support window for recognized-but-unsupported formats.
    pub fn planned_support(self) -> Option<&'static str> {
        match self {
            FontFormat::Woff | FontFormat::Woff2 => Some("Folio v2"),
            _ => None,
        }
    }

    /// Short human readable label used by the CLI.
    pub fn label(self) -> &'static str {
        match self {
            FontFormat::TrueType => "TTF",
            FontFormat::OpenType => "OTF",
            FontFormat::TrueTypeCollection => "TTC",
            FontFormat::OpenTypeCollection => "OTC",
            FontFormat::Woff => "WOFF",
            FontFormat::Woff2 => "WOFF2",
        }
    }

    /// Maps a file extension to a format hint.
    ///
    /// This is a hint for candidate detection only. The actual format of a
    /// file is determined by [`sniff_format`].
    pub fn from_extension(extension: &str) -> Option<Self> {
        match extension.to_ascii_lowercase().as_str() {
            "ttf" => Some(FontFormat::TrueType),
            "otf" => Some(FontFormat::OpenType),
            "ttc" => Some(FontFormat::TrueTypeCollection),
            "otc" => Some(FontFormat::OpenTypeCollection),
            "woff" => Some(FontFormat::Woff),
            "woff2" => Some(FontFormat::Woff2),
            _ => None,
        }
    }
}

impl std::fmt::Display for FontFormat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.label())
    }
}

/// Web font and sfnt magic numbers recognized by Folio.
const MAGIC_TTCF: &[u8; 4] = b"ttcf";
const MAGIC_WOFF: &[u8; 4] = b"wOFF";
const MAGIC_WOFF2: &[u8; 4] = b"wOF2";
const MAGIC_OTTO: &[u8; 4] = b"OTTO";
const MAGIC_TRUE: &[u8; 4] = b"true";

/// Result of inspecting the first bytes of a file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SniffedFormat {
    /// An sfnt font; the variant records its outline technology.
    Sfnt(SfntOutline),
    /// A `ttcf` collection. The outline technology is resolved per member.
    Collection,
    /// WOFF 1.0.
    Woff,
    /// WOFF 2.0.
    Woff2,
}

/// Outline technology of an sfnt font.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SfntOutline {
    /// TrueType outlines (`0x00010000` or `true`).
    TrueType,
    /// CFF/CFF2 outlines (`OTTO`).
    OpenType,
}

impl SfntOutline {
    pub(crate) fn format(self) -> FontFormat {
        match self {
            SfntOutline::TrueType => FontFormat::TrueType,
            SfntOutline::OpenType => FontFormat::OpenType,
        }
    }
}

/// Identifies a known font container from its magic bytes.
///
/// Returns `None` for anything that is not a recognized font container,
/// which is how files such as images renamed to `.ttf` are rejected.
pub(crate) fn sniff_format(data: &[u8]) -> Option<SniffedFormat> {
    let magic: [u8; 4] = data.get(..4)?.try_into().ok()?;
    match &magic {
        MAGIC_TTCF => Some(SniffedFormat::Collection),
        MAGIC_WOFF => Some(SniffedFormat::Woff),
        MAGIC_WOFF2 => Some(SniffedFormat::Woff2),
        MAGIC_OTTO => Some(SniffedFormat::Sfnt(SfntOutline::OpenType)),
        MAGIC_TRUE => Some(SniffedFormat::Sfnt(SfntOutline::TrueType)),
        _ => {
            if magic == [0x00, 0x01, 0x00, 0x00] {
                Some(SniffedFormat::Sfnt(SfntOutline::TrueType))
            } else {
                None
            }
        }
    }
}
