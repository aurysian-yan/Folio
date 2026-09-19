//! 带版本、Folio 自有的缓存载荷。
//!
//! 解析出的元数据存为显式 DTO，既不是第三方解析器对象的序列化，也不是
//! [`folio_core::Catalog`] 的整体序列化。载荷属于**可重建缓存**：版本未知
//! 或字节损坏时，只重新解析受影响文件，不会触碰库根目录。
//!
//! 标识与指纹以原始字节保存，与其持久表示一致。DTO 变更时提升
//! `CACHE_PAYLOAD_VERSION`；Serde 布局被明确视为**非**永久持久契约。

use bincode::Options;
use folio_core::{
    AxisCoordinate, ContentFingerprint, FaceMetadata, FaceProblem, FaceProblemKind, FontFaceId,
    FontFormat, FontIdentityId, FontRevisionId, FontSource, FontStyle, FontVersion, FontWeight,
    FontWidth, IdentityKind, LocalizedName, NameKind, NameLocale, NamedInstance, ParsedFace,
    ParsedFontFile, VariableAxis,
};
use serde::{Deserialize, Serialize};

use crate::error::StorageError;

/// 序列化解析文件载荷的版本号。
pub const CACHE_PAYLOAD_VERSION: u32 = 2;

/// 单个文件的元数据载荷上限；不包含字体轮廓和原始文件。
pub(crate) const MAX_PAYLOAD_BYTES: usize = 64 * 1024 * 1024;

/// 存储形式的已解析字体文件。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct CachedFilePayload {
    pub faces: Vec<CachedFace>,
    pub problems: Vec<CachedProblem>,
}

/// 存储形式的已解析面。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct CachedFace {
    pub id: [u8; 16],
    pub face_index: u32,
    pub format: CachedFormat,
    pub identity_id: [u8; 16],
    pub identity_kind: CachedIdentityKind,
    pub canonical_name: Option<String>,
    pub revision_id: [u8; 16],
    pub content_fingerprint: [u8; 32],
    pub face_discriminator: Option<u32>,
    pub metadata: CachedMetadata,
}

/// 存储形式的非致命解析问题。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct CachedProblem {
    pub face_index: Option<u32>,
    pub kind: CachedProblemKind,
    pub message: String,
}

/// [`FaceProblemKind`] 的存储形式。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum CachedProblemKind {
    Collection,
    Metadata,
}

/// [`FontFormat`] 的存储形式。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum CachedFormat {
    TrueType,
    OpenType,
    Collection,
    Woff,
    Woff2,
}

/// [`IdentityKind`] 的存储形式。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum CachedIdentityKind {
    PostScriptName,
    TypographicNames,
    LegacyNames,
    FullName,
    ContentFallback,
}

/// [`NameKind`] 的存储形式。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum CachedNameKind {
    Family,
    Subfamily,
    FullName,
    PostScriptName,
    Version,
    TypographicFamily,
    TypographicSubfamily,
    WwsFamily,
    WwsSubfamily,
    Other(u16),
}

/// [`LocalizedName`] 的存储形式。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct CachedLocalizedName {
    pub kind: CachedNameKind,
    pub language: Option<String>,
    pub value: String,
    pub locale: Option<CachedNameLocale>,
}

/// [`folio_core::NameLocale`] 的存储形式。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct CachedNameLocale {
    pub platform_id: u16,
    pub encoding_id: u16,
    pub language_id: u16,
    pub language_tag: Option<String>,
}

/// [`FontStyle`] 的存储形式。
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) enum CachedFontStyle {
    Normal,
    Italic,
    Oblique(Option<f32>),
}

/// [`FontVersion`] 的存储形式。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct CachedFontVersion {
    pub head_revision: Option<f64>,
    pub version_string: Option<String>,
}

/// [`VariableAxis`] 的存储形式。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct CachedAxis {
    pub tag: String,
    pub min_value: f32,
    pub default_value: f32,
    pub max_value: f32,
    pub hidden: bool,
    pub name: Option<String>,
    pub localized_names: Vec<CachedLocalizedName>,
}

/// [`AxisCoordinate`] 的存储形式。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct CachedCoordinate {
    pub axis_tag: String,
    pub value: f32,
}

/// [`NamedInstance`] 的存储形式。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct CachedNamedInstance {
    pub subfamily_name: Option<String>,
    pub postscript_name: Option<String>,
    pub coordinates: Vec<CachedCoordinate>,
}

/// [`FaceMetadata`] 的存储形式。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct CachedMetadata {
    pub enrichment: folio_core::FontEnrichment,
    pub family_name: Option<String>,
    pub subfamily_name: Option<String>,
    pub full_name: Option<String>,
    pub postscript_name: Option<String>,
    pub typographic_family_name: Option<String>,
    pub typographic_subfamily_name: Option<String>,
    pub legacy_family_name: Option<String>,
    pub legacy_subfamily_name: Option<String>,
    pub localized_names: Vec<CachedLocalizedName>,
    pub weight: Option<f32>,
    pub width_class: Option<u16>,
    pub style: CachedFontStyle,
    pub font_version: CachedFontVersion,
    pub units_per_em: Option<u16>,
    pub is_variable: bool,
    pub variable_axes: Vec<CachedAxis>,
    pub named_instances: Vec<CachedNamedInstance>,
}

/// 将已解析文件编码为当前版本的缓存载荷。
pub(crate) fn encode_payload(parsed: &ParsedFontFile) -> Result<Vec<u8>, StorageError> {
    let payload = CachedFilePayload {
        faces: parsed.faces.iter().map(CachedFace::from_face).collect(),
        problems: parsed
            .problems
            .iter()
            .map(CachedProblem::from_problem)
            .collect(),
    };
    bincode::DefaultOptions::new()
        .with_fixint_encoding()
        .with_limit(MAX_PAYLOAD_BYTES as u64)
        .serialize(&payload)
        .map_err(|error| StorageError::InvalidCachePayload {
            context: "encode parsed file".to_owned(),
            message: error.to_string(),
        })
}

/// 解码缓存载荷。
pub(crate) fn decode_payload(
    bytes: &[u8],
    context: &str,
) -> Result<CachedFilePayload, StorageError> {
    if bytes.len() > MAX_PAYLOAD_BYTES {
        return Err(StorageError::InvalidCachePayload {
            context: context.to_owned(),
            message: "payload exceeds 64 MiB metadata limit".to_owned(),
        });
    }
    bincode::DefaultOptions::new()
        .with_fixint_encoding()
        .with_limit(bytes.len() as u64)
        .reject_trailing_bytes()
        .deserialize(bytes)
        .map_err(|error| StorageError::InvalidCachePayload {
            context: context.to_owned(),
            message: error.to_string(),
        })
}

impl CachedFace {
    fn from_face(face: &ParsedFace) -> Self {
        Self {
            id: *face.id.as_bytes(),
            face_index: face.face_index,
            format: CachedFormat::from(face.format),
            identity_id: *face.identity.id.as_bytes(),
            identity_kind: CachedIdentityKind::from(face.identity.kind),
            canonical_name: face.identity.canonical_name.clone(),
            revision_id: *face.revision.id.as_bytes(),
            content_fingerprint: *face.revision.content_fingerprint.as_bytes(),
            face_discriminator: face.revision.face_discriminator,
            metadata: CachedMetadata::from(&face.metadata),
        }
    }

    /// 从存储行取得来源，重建核心层的已解析面。
    pub(crate) fn to_parsed_face(&self, source: FontSource) -> ParsedFace {
        let identity_id = FontIdentityId::from_bytes(self.identity_id);
        let fingerprint = ContentFingerprint::from_digest(self.content_fingerprint);
        ParsedFace {
            id: FontFaceId::from_bytes(self.id),
            face_index: self.face_index,
            format: self.format.into(),
            identity: folio_core::FontIdentity {
                id: identity_id,
                kind: self.identity_kind.into(),
                canonical_name: self.canonical_name.clone(),
            },
            revision: folio_core::FontRevision {
                id: FontRevisionId::from_bytes(self.revision_id),
                identity_id,
                content_fingerprint: fingerprint,
                face_discriminator: self.face_discriminator,
            },
            metadata: self.metadata.to_metadata(),
            source,
        }
    }
}

impl CachedProblem {
    fn from_problem(problem: &FaceProblem) -> Self {
        Self {
            face_index: problem.face_index,
            kind: CachedProblemKind::from(problem.kind),
            message: problem.message.clone(),
        }
    }

    pub(crate) fn to_problem(&self) -> FaceProblem {
        FaceProblem {
            face_index: self.face_index,
            kind: self.kind.into(),
            message: self.message.clone(),
        }
    }
}

impl CachedMetadata {
    fn from(metadata: &FaceMetadata) -> Self {
        Self {
            enrichment: metadata.enrichment.clone(),
            family_name: metadata.family_name.clone(),
            subfamily_name: metadata.subfamily_name.clone(),
            full_name: metadata.full_name.clone(),
            postscript_name: metadata.postscript_name.clone(),
            typographic_family_name: metadata.typographic_family_name.clone(),
            typographic_subfamily_name: metadata.typographic_subfamily_name.clone(),
            legacy_family_name: metadata.legacy_family_name.clone(),
            legacy_subfamily_name: metadata.legacy_subfamily_name.clone(),
            localized_names: metadata
                .localized_names
                .iter()
                .map(CachedLocalizedName::from)
                .collect(),
            weight: metadata.weight.map(FontWeight::value),
            width_class: metadata.width.map(FontWidth::class),
            style: metadata.style.into(),
            font_version: CachedFontVersion {
                head_revision: metadata.font_version.head_revision,
                version_string: metadata.font_version.version_string.clone(),
            },
            units_per_em: metadata.units_per_em,
            is_variable: metadata.is_variable,
            variable_axes: metadata
                .variable_axes
                .iter()
                .map(CachedAxis::from)
                .collect(),
            named_instances: metadata
                .named_instances
                .iter()
                .map(CachedNamedInstance::from)
                .collect(),
        }
    }

    fn to_metadata(&self) -> FaceMetadata {
        FaceMetadata {
            enrichment: self.enrichment.clone(),
            family_name: self.family_name.clone(),
            subfamily_name: self.subfamily_name.clone(),
            full_name: self.full_name.clone(),
            postscript_name: self.postscript_name.clone(),
            typographic_family_name: self.typographic_family_name.clone(),
            typographic_subfamily_name: self.typographic_subfamily_name.clone(),
            legacy_family_name: self.legacy_family_name.clone(),
            legacy_subfamily_name: self.legacy_subfamily_name.clone(),
            localized_names: self
                .localized_names
                .iter()
                .map(|name| name.to_name())
                .collect(),
            weight: self.weight.map(FontWeight::new),
            width: self.width_class.and_then(FontWidth::from_width_class),
            style: self.style.into(),
            font_version: FontVersion {
                head_revision: self.font_version.head_revision,
                version_string: self.font_version.version_string.clone(),
            },
            units_per_em: self.units_per_em,
            is_variable: self.is_variable,
            variable_axes: self.variable_axes.iter().map(CachedAxis::to_axis).collect(),
            named_instances: self
                .named_instances
                .iter()
                .map(CachedNamedInstance::to_instance)
                .collect(),
        }
    }
}

impl CachedLocalizedName {
    fn to_name(&self) -> LocalizedName {
        LocalizedName {
            kind: self.kind.clone().into(),
            language: self.language.clone(),
            value: self.value.clone(),
            locale: self.locale.as_ref().map(CachedNameLocale::to_locale),
        }
    }
}

impl CachedNameLocale {
    fn to_locale(&self) -> NameLocale {
        NameLocale {
            platform_id: self.platform_id,
            encoding_id: self.encoding_id,
            language_id: self.language_id,
            language_tag: self.language_tag.clone(),
        }
    }
}

impl From<&NameLocale> for CachedNameLocale {
    fn from(locale: &NameLocale) -> Self {
        Self {
            platform_id: locale.platform_id,
            encoding_id: locale.encoding_id,
            language_id: locale.language_id,
            language_tag: locale.language_tag.clone(),
        }
    }
}

impl From<&LocalizedName> for CachedLocalizedName {
    fn from(name: &LocalizedName) -> Self {
        Self {
            kind: name.kind.into(),
            language: name.language.clone(),
            value: name.value.clone(),
            locale: name.locale.as_ref().map(CachedNameLocale::from),
        }
    }
}

impl CachedAxis {
    fn to_axis(&self) -> VariableAxis {
        VariableAxis {
            tag: self.tag.clone(),
            min_value: self.min_value,
            default_value: self.default_value,
            max_value: self.max_value,
            hidden: self.hidden,
            name: self.name.clone(),
            localized_names: self
                .localized_names
                .iter()
                .map(|name| name.to_name())
                .collect(),
        }
    }
}

impl From<&VariableAxis> for CachedAxis {
    fn from(axis: &VariableAxis) -> Self {
        Self {
            tag: axis.tag.clone(),
            min_value: axis.min_value,
            default_value: axis.default_value,
            max_value: axis.max_value,
            hidden: axis.hidden,
            name: axis.name.clone(),
            localized_names: axis
                .localized_names
                .iter()
                .map(CachedLocalizedName::from)
                .collect(),
        }
    }
}

impl CachedNamedInstance {
    fn to_instance(&self) -> NamedInstance {
        NamedInstance {
            subfamily_name: self.subfamily_name.clone(),
            postscript_name: self.postscript_name.clone(),
            coordinates: self
                .coordinates
                .iter()
                .map(|coordinate| AxisCoordinate {
                    axis_tag: coordinate.axis_tag.clone(),
                    value: coordinate.value,
                })
                .collect(),
        }
    }
}

impl From<&NamedInstance> for CachedNamedInstance {
    fn from(instance: &NamedInstance) -> Self {
        Self {
            subfamily_name: instance.subfamily_name.clone(),
            postscript_name: instance.postscript_name.clone(),
            coordinates: instance
                .coordinates
                .iter()
                .map(|coordinate| CachedCoordinate {
                    axis_tag: coordinate.axis_tag.clone(),
                    value: coordinate.value,
                })
                .collect(),
        }
    }
}

impl From<FontFormat> for CachedFormat {
    fn from(format: FontFormat) -> Self {
        match format {
            FontFormat::TrueType => CachedFormat::TrueType,
            FontFormat::OpenType => CachedFormat::OpenType,
            FontFormat::Collection => CachedFormat::Collection,
            FontFormat::Woff => CachedFormat::Woff,
            FontFormat::Woff2 => CachedFormat::Woff2,
        }
    }
}

impl From<CachedFormat> for FontFormat {
    fn from(format: CachedFormat) -> Self {
        match format {
            CachedFormat::TrueType => FontFormat::TrueType,
            CachedFormat::OpenType => FontFormat::OpenType,
            CachedFormat::Collection => FontFormat::Collection,
            CachedFormat::Woff => FontFormat::Woff,
            CachedFormat::Woff2 => FontFormat::Woff2,
        }
    }
}

impl From<IdentityKind> for CachedIdentityKind {
    fn from(kind: IdentityKind) -> Self {
        match kind {
            IdentityKind::PostScriptName => CachedIdentityKind::PostScriptName,
            IdentityKind::TypographicNames => CachedIdentityKind::TypographicNames,
            IdentityKind::LegacyNames => CachedIdentityKind::LegacyNames,
            IdentityKind::FullName => CachedIdentityKind::FullName,
            IdentityKind::ContentFallback => CachedIdentityKind::ContentFallback,
        }
    }
}

impl From<CachedIdentityKind> for IdentityKind {
    fn from(kind: CachedIdentityKind) -> Self {
        match kind {
            CachedIdentityKind::PostScriptName => IdentityKind::PostScriptName,
            CachedIdentityKind::TypographicNames => IdentityKind::TypographicNames,
            CachedIdentityKind::LegacyNames => IdentityKind::LegacyNames,
            CachedIdentityKind::FullName => IdentityKind::FullName,
            CachedIdentityKind::ContentFallback => IdentityKind::ContentFallback,
        }
    }
}

impl From<NameKind> for CachedNameKind {
    fn from(kind: NameKind) -> Self {
        match kind {
            NameKind::Family => CachedNameKind::Family,
            NameKind::Subfamily => CachedNameKind::Subfamily,
            NameKind::FullName => CachedNameKind::FullName,
            NameKind::PostScriptName => CachedNameKind::PostScriptName,
            NameKind::Version => CachedNameKind::Version,
            NameKind::TypographicFamily => CachedNameKind::TypographicFamily,
            NameKind::TypographicSubfamily => CachedNameKind::TypographicSubfamily,
            NameKind::WwsFamily => CachedNameKind::WwsFamily,
            NameKind::WwsSubfamily => CachedNameKind::WwsSubfamily,
            NameKind::Other(id) => CachedNameKind::Other(id),
        }
    }
}

impl From<CachedNameKind> for NameKind {
    fn from(kind: CachedNameKind) -> Self {
        match kind {
            CachedNameKind::Family => NameKind::Family,
            CachedNameKind::Subfamily => NameKind::Subfamily,
            CachedNameKind::FullName => NameKind::FullName,
            CachedNameKind::PostScriptName => NameKind::PostScriptName,
            CachedNameKind::Version => NameKind::Version,
            CachedNameKind::TypographicFamily => NameKind::TypographicFamily,
            CachedNameKind::TypographicSubfamily => NameKind::TypographicSubfamily,
            CachedNameKind::WwsFamily => NameKind::WwsFamily,
            CachedNameKind::WwsSubfamily => NameKind::WwsSubfamily,
            CachedNameKind::Other(id) => NameKind::Other(id),
        }
    }
}

impl From<FontStyle> for CachedFontStyle {
    fn from(style: FontStyle) -> Self {
        match style {
            FontStyle::Normal => CachedFontStyle::Normal,
            FontStyle::Italic => CachedFontStyle::Italic,
            FontStyle::Oblique { angle } => CachedFontStyle::Oblique(angle),
        }
    }
}

impl From<CachedFontStyle> for FontStyle {
    fn from(style: CachedFontStyle) -> Self {
        match style {
            CachedFontStyle::Normal => FontStyle::Normal,
            CachedFontStyle::Italic => FontStyle::Italic,
            CachedFontStyle::Oblique(angle) => FontStyle::Oblique { angle },
        }
    }
}

impl From<FaceProblemKind> for CachedProblemKind {
    fn from(kind: FaceProblemKind) -> Self {
        match kind {
            FaceProblemKind::Collection => CachedProblemKind::Collection,
            FaceProblemKind::Metadata => CachedProblemKind::Metadata,
        }
    }
}

impl From<CachedProblemKind> for FaceProblemKind {
    fn from(kind: CachedProblemKind) -> Self {
        match kind {
            CachedProblemKind::Collection => FaceProblemKind::Collection,
            CachedProblemKind::Metadata => FaceProblemKind::Metadata,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_decode_rejects_huge_lengths_invalid_tags_and_trailing_bytes() {
        assert!(decode_payload(&u64::MAX.to_le_bytes(), "faces length").is_err());
        let mut problems = vec![0u8; 16];
        problems[8..16].copy_from_slice(&1u64.to_le_bytes());
        problems.push(0);
        problems.extend_from_slice(&0u32.to_le_bytes());
        problems.extend_from_slice(&u64::MAX.to_le_bytes());
        assert!(decode_payload(&problems, "message length").is_err());
        let empty = CachedFilePayload {
            faces: vec![],
            problems: vec![],
        };
        let mut bytes = bincode::serialize(&empty).unwrap();
        assert!(decode_payload(&bytes, "compatible fixed encoding").is_ok());
        bytes.push(1);
        assert!(decode_payload(&bytes, "trailing bytes").is_err());
        let payload = CachedFilePayload {
            faces: vec![],
            problems: vec![CachedProblem {
                face_index: None,
                kind: CachedProblemKind::Metadata,
                message: "problem".into(),
            }],
        };
        let mut bytes = bincode::serialize(&payload).unwrap();
        bytes[17..21].copy_from_slice(&99u32.to_le_bytes());
        assert!(decode_payload(&bytes, "enum tag").is_err());
    }
}
