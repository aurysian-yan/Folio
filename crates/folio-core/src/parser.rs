//! Font parsing pipeline.
//!
//! Parsing never panics on malformed input and never fails because
//! optional metadata is missing. A single bad face inside a collection
//! does not prevent the remaining faces from being parsed.

use std::path::Path;
use std::time::SystemTime;

use read_fonts::tables::head::{Head, MacStyle};
use read_fonts::tables::os2::{Os2, SelectionFlags};
use read_fonts::tables::post::Post;
use read_fonts::types::CFF_SFNT_VERSION;
use read_fonts::{CollectionRef, FontRef, ReadError, TableProvider};
use skrifa::MetadataProvider;

use crate::attributes::{
    AxisCoordinate, FontStyle, FontVersion, FontWeight, FontWidth, NamedInstance, VariableAxis,
};
use crate::face::{FaceMetadata, FaceProblem, FaceProblemKind, ParsedFace, ParsedFontFile};
use crate::fingerprint::ContentFingerprint;
use crate::format::{sniff_format, FontFormat, SfntOutline, SniffedFormat};
use crate::identity::{compute_identity, IdentityKind, IdentityNames};
use crate::ids::FontFaceId;
use crate::names::{
    collect_localized_names, collect_names_for_id, preferred_value, preferred_value_for_id,
    NameKind,
};
use crate::revision::compute_revision;
use crate::source::FontSource;

use crate::error::{FontError, ParserError};

/// Parses a single font file from disk.
///
/// The returned [`ParsedFontFile`] contains one entry per face, so
/// collections produce multiple faces.
pub fn parse_font_file(path: impl AsRef<Path>) -> Result<ParsedFontFile, FontError> {
    let path = path.as_ref();
    let metadata = std::fs::metadata(path).map_err(|source| FontError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let data = std::fs::read(path).map_err(|source| FontError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    parse_font_data(path, &data, data.len() as u64, metadata.modified().ok())
}

/// Parses an in-memory font binary.
///
/// `file_size` and `modified` are recorded as auxiliary source metadata;
/// they never influence identity or revision.
pub fn parse_font_data(
    path: &Path,
    data: &[u8],
    file_size: u64,
    modified: Option<SystemTime>,
) -> Result<ParsedFontFile, FontError> {
    if data.is_empty() {
        return Err(FontError::EmptyFile {
            path: path.to_path_buf(),
        });
    }

    tracing::debug!(path = %path.display(), bytes = data.len(), "inspecting font file");

    let context = FileContext {
        path,
        file_size,
        modified,
        fingerprint: ContentFingerprint::from_bytes(data),
    };

    match sniff_format(data) {
        Some(SniffedFormat::Woff) => Err(unsupported(path, FontFormat::Woff)),
        Some(SniffedFormat::Woff2) => Err(unsupported(path, FontFormat::Woff2)),
        Some(SniffedFormat::Sfnt(outline)) => parse_single(path, data, outline, &context),
        Some(SniffedFormat::Collection) => parse_collection(path, data, &context),
        None => Err(FontError::UnknownFormat {
            path: path.to_path_buf(),
        }),
    }
}

fn unsupported(path: &Path, format: FontFormat) -> FontError {
    FontError::UnsupportedFormat {
        path: path.to_path_buf(),
        format,
        planned: format.planned_support().unwrap_or("a future version"),
    }
}

struct FileContext<'a> {
    path: &'a Path,
    file_size: u64,
    modified: Option<SystemTime>,
    fingerprint: ContentFingerprint,
}

fn parse_single(
    path: &Path,
    data: &[u8],
    outline: SfntOutline,
    context: &FileContext<'_>,
) -> Result<ParsedFontFile, FontError> {
    let font = FontRef::new(data).map_err(|source| FontError::Malformed {
        path: path.to_path_buf(),
        source: ParserError::new(source),
    })?;
    let mut problems = Vec::new();
    let face = parse_face(&font, 0, outline.format(), context, None, &mut problems);
    tracing::debug!(path = %path.display(), format = ?outline.format(), "parsed single font");
    Ok(ParsedFontFile {
        path: path.to_path_buf(),
        format: outline.format(),
        fingerprint: context.fingerprint,
        faces: vec![face],
        problems,
    })
}

fn parse_collection(
    path: &Path,
    data: &[u8],
    context: &FileContext<'_>,
) -> Result<ParsedFontFile, FontError> {
    let collection = CollectionRef::new(data).map_err(|source| FontError::Malformed {
        path: path.to_path_buf(),
        source: ParserError::new(source),
    })?;

    let mut faces = Vec::new();
    let mut problems = Vec::new();
    let mut first_error: Option<ReadError> = None;
    let mut file_format: Option<FontFormat> = None;

    for index in 0..collection.len() {
        match collection.get(index) {
            Ok(font) => {
                let outline = outline_of(&font);
                let member_format = outline.format();
                if file_format.is_none() {
                    // A mixed collection is labeled by its first member.
                    file_format = Some(match outline {
                        SfntOutline::TrueType => FontFormat::TrueTypeCollection,
                        SfntOutline::OpenType => FontFormat::OpenTypeCollection,
                    });
                }
                faces.push(parse_face(
                    &font,
                    index,
                    member_format,
                    context,
                    Some(index),
                    &mut problems,
                ));
            }
            Err(error) => {
                if first_error.is_none() {
                    first_error = Some(error.clone());
                }
                problems.push(FaceProblem {
                    face_index: Some(index),
                    kind: FaceProblemKind::Collection,
                    message: error.to_string(),
                });
            }
        }
    }

    let format = file_format.ok_or_else(|| FontError::Malformed {
        path: path.to_path_buf(),
        source: ParserError::new(
            first_error.unwrap_or(ReadError::MalformedData("empty font collection")),
        ),
    })?;

    tracing::debug!(
        path = %path.display(),
        format = ?format,
        faces = faces.len(),
        failed_faces = problems.len(),
        "parsed font collection"
    );

    Ok(ParsedFontFile {
        path: path.to_path_buf(),
        format,
        fingerprint: context.fingerprint,
        faces,
        problems,
    })
}

fn outline_of(font: &FontRef<'_>) -> SfntOutline {
    if font.table_directory().sfnt_version() == CFF_SFNT_VERSION {
        SfntOutline::OpenType
    } else {
        SfntOutline::TrueType
    }
}

fn parse_face(
    font: &FontRef<'_>,
    face_index: u32,
    format: FontFormat,
    context: &FileContext<'_>,
    face_discriminator: Option<u32>,
    problems: &mut Vec<FaceProblem>,
) -> ParsedFace {
    let names = collect_localized_names(font);

    let postscript_name = preferred_value(&names, NameKind::PostScriptName);
    let typographic_family = preferred_value(&names, NameKind::TypographicFamily);
    let typographic_subfamily = preferred_value(&names, NameKind::TypographicSubfamily);
    let legacy_family = preferred_value(&names, NameKind::Family);
    let legacy_subfamily = preferred_value(&names, NameKind::Subfamily);
    let full_name = preferred_value(&names, NameKind::FullName);

    let identity = compute_identity(
        IdentityNames {
            postscript_name: postscript_name.as_deref(),
            typographic_family: typographic_family.as_deref(),
            typographic_subfamily: typographic_subfamily.as_deref(),
            legacy_family: legacy_family.as_deref(),
            legacy_subfamily: legacy_subfamily.as_deref(),
            full_name: full_name.as_deref(),
        },
        &context.fingerprint,
        face_index,
    );

    if identity.kind == IdentityKind::ContentFallback {
        problems.push(FaceProblem {
            face_index: Some(face_index),
            kind: FaceProblemKind::Metadata,
            message: "face has no usable name records; identity derived from content".to_owned(),
        });
    }

    let revision = compute_revision(&identity, &context.fingerprint, face_discriminator);

    let head = font.head().ok();
    let (weight, width, style) = read_attributes(font);
    let variable_axes = read_axes(font);
    let named_instances = read_named_instances(font, &variable_axes);

    let family_name = typographic_family.clone().or_else(|| legacy_family.clone());
    let subfamily_name = typographic_subfamily
        .clone()
        .or_else(|| legacy_subfamily.clone());
    let font_version = FontVersion {
        head_revision: head.as_ref().map(|head| head.font_revision().to_f64()),
        version_string: preferred_value(&names, NameKind::Version),
    };

    let metadata = FaceMetadata {
        family_name,
        subfamily_name,
        full_name,
        postscript_name,
        typographic_family_name: typographic_family,
        typographic_subfamily_name: typographic_subfamily,
        legacy_family_name: legacy_family,
        legacy_subfamily_name: legacy_subfamily,
        localized_names: names,
        weight,
        width,
        style,
        font_version,
        units_per_em: head.as_ref().map(|head| head.units_per_em()),
        is_variable: !variable_axes.is_empty(),
        variable_axes,
        named_instances,
    };

    ParsedFace {
        id: FontFaceId::from_revision(revision.id),
        face_index,
        format,
        identity,
        revision,
        metadata,
        source: FontSource::local_file(
            context.path.to_path_buf(),
            face_index,
            context.file_size,
            context.modified,
        ),
    }
}

fn read_attributes(font: &FontRef<'_>) -> (Option<FontWeight>, Option<FontWidth>, FontStyle) {
    let os2 = font.os2().ok();
    let head = font.head().ok();
    let post = font.post().ok();

    let weight = os2
        .as_ref()
        .and_then(|os2| FontWeight::from_os2_class(os2.us_weight_class()))
        .or_else(|| {
            head.as_ref().and_then(|head| {
                head.mac_style()
                    .contains(MacStyle::BOLD)
                    .then_some(FontWeight::BOLD)
            })
        });

    let width = os2
        .as_ref()
        .and_then(|os2| FontWidth::from_width_class(os2.us_width_class()));

    let style = read_style(os2.as_ref(), head.as_ref(), post.as_ref());
    (weight, width, style)
}

fn read_style(
    os2: Option<&Os2<'_>>,
    head: Option<&Head<'_>>,
    post: Option<&Post<'_>>,
) -> FontStyle {
    let head_italic = || head.is_some_and(|head| head.mac_style().contains(MacStyle::ITALIC));
    if let Some(os2) = os2 {
        let flags = os2.fs_selection();
        if flags.contains(SelectionFlags::ITALIC) {
            FontStyle::Italic
        } else if flags.contains(SelectionFlags::OBLIQUE) {
            let angle = post.map(|post| post.italic_angle().to_f64() as f32);
            FontStyle::Oblique { angle }
        } else if head_italic() {
            FontStyle::Italic
        } else {
            FontStyle::Normal
        }
    } else if head_italic() {
        FontStyle::Italic
    } else {
        FontStyle::Normal
    }
}

fn read_axes(font: &FontRef<'_>) -> Vec<VariableAxis> {
    font.axes()
        .iter()
        .map(|axis| {
            let localized_names = collect_names_for_id(font, axis.name_id());
            VariableAxis {
                tag: axis.tag().to_string(),
                min_value: axis.min_value(),
                default_value: axis.default_value(),
                max_value: axis.max_value(),
                hidden: axis.is_hidden(),
                name: preferred_value_for_id(&localized_names, axis.name_id()),
                localized_names,
            }
        })
        .collect()
}

fn read_named_instances(font: &FontRef<'_>, axes: &[VariableAxis]) -> Vec<NamedInstance> {
    font.named_instances()
        .iter()
        .map(|instance| {
            let subfamily_names = collect_names_for_id(font, instance.subfamily_name_id());
            let subfamily_name =
                preferred_value_for_id(&subfamily_names, instance.subfamily_name_id());
            let postscript_name = instance.postscript_name_id().and_then(|id| {
                let names = collect_names_for_id(font, id);
                preferred_value_for_id(&names, id)
            });
            let coordinates = axes
                .iter()
                .zip(instance.user_coords())
                .map(|(axis, value)| AxisCoordinate {
                    axis_tag: axis.tag.clone(),
                    value,
                })
                .collect();
            NamedInstance {
                subfamily_name,
                postscript_name,
                coordinates,
            }
        })
        .collect()
}
