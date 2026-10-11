//! 按 Glyph ID 绘制轮廓、彩色与嵌入位图，不经过文本塑形或字体回退。

use crate::session::RenderCharacterMapError;
use base64::{engine::general_purpose::STANDARD, Engine};
use read_fonts::{FontRef, TableProvider};
use serde::{Deserialize, Serialize};
use skrifa::{
    instance::{Location, Size},
    MetadataProvider,
};
use std::{
    collections::BTreeMap,
    io::{Cursor, Read},
    sync::Arc,
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderRequest {
    pub handle: String,
    pub glyph_ids: Vec<u32>,
    #[serde(default)]
    pub axes: BTreeMap<String, f32>,
    pub size: u32,
    pub foreground: [u8; 4],
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphImage {
    pub glyph_id: u32,
    pub status: String,
    pub data_url: Option<String>,
    pub error: Option<String>,
}

impl GlyphImage {
    pub(crate) fn error(glyph_id: u32, error: RenderCharacterMapError) -> Self {
        Self {
            glyph_id,
            status: "error".into(),
            data_url: None,
            error: Some(error.to_string()),
        }
    }
}

pub(crate) fn validate_axes(
    data: &[u8],
    index: u32,
    axes: &BTreeMap<String, f32>,
) -> Result<(), RenderCharacterMapError> {
    let font =
        FontRef::from_index(data, index).map_err(|_| RenderCharacterMapError::InvalidFont)?;
    for (tag, value) in axes {
        let axis = font
            .axes()
            .iter()
            .find(|axis| axis.tag().to_string() == *tag)
            .ok_or(RenderCharacterMapError::InvalidAxes)?;
        if !value.is_finite() || *value < axis.min_value() || *value > axis.max_value() {
            return Err(RenderCharacterMapError::InvalidAxes);
        }
    }
    Ok(())
}

pub(crate) fn render_glyph(
    data: Arc<Vec<u8>>,
    face_index: u32,
    glyph_id: u32,
    request: &RenderRequest,
) -> Result<GlyphImage, RenderCharacterMapError> {
    let font =
        FontRef::from_index(&data, face_index).map_err(|_| RenderCharacterMapError::InvalidFont)?;
    let settings: Vec<_> = request
        .axes
        .iter()
        .map(|(tag, value)| (tag.as_str(), *value))
        .collect();
    let location = font.axes().location(settings);
    let glyph = skrifa::GlyphId::new(glyph_id);
    let metrics = font.metrics(Size::unscaled(), &location);
    if metrics.units_per_em == 0 {
        return Err(RenderCharacterMapError::InvalidFont);
    }
    let glyph_metrics = font.glyph_metrics(Size::unscaled(), &location);
    let bounds = font
        .color_glyphs()
        .get(glyph)
        .and_then(|color| color.bounding_box(&location, Size::unscaled()))
        .or_else(|| glyph_metrics.bounds(glyph));
    let advance = glyph_metrics
        .advance_width(glyph)
        .unwrap_or(metrics.units_per_em as f32);
    let span = bounds.map_or(0.0, |bounds| bounds.x_max - bounds.x_min);
    let height = bounds.map_or(0.0, |bounds| bounds.y_max - bounds.y_min);
    let em = (metrics.units_per_em as f32)
        .max(advance)
        .max(span)
        .max(height)
        .max(metrics.ascent - metrics.descent)
        .max(1.0);
    let pixels_per_em = request.size as f32 * metrics.units_per_em as f32 / em;
    let scale = pixels_per_em / metrics.units_per_em as f32;
    let x = bounds.map_or((request.size as f32 - advance * scale) / 2.0, |bounds| {
        (request.size as f32 - span * scale) / 2.0 - bounds.x_min * scale
    });
    let y = bounds.map_or(
        (request.size as f32 + (metrics.ascent + metrics.descent) * scale) / 2.0,
        |bounds| (request.size as f32 + height * scale) / 2.0 + bounds.y_min * scale,
    );
    let rgba = if let Some(svg) = render_svg(&font, glyph_id, request, scale, x, y)? {
        svg
    } else if let Some(bitmap) = render_bitmap(&font, glyph, request, pixels_per_em, x, y)? {
        bitmap
    } else {
        render_outline_or_colr(
            data.clone(),
            face_index,
            glyph_id,
            request,
            &location,
            pixels_per_em,
            [x, y],
        )?
    };
    let empty = rgba.as_chunks::<4>().0.iter().all(|pixel| pixel[3] == 0);
    let mut png = Cursor::new(Vec::new());
    image::write_buffer_with_format(
        &mut png,
        &rgba,
        request.size,
        request.size,
        image::ColorType::Rgba8,
        image::ImageFormat::Png,
    )
    .map_err(|_| RenderCharacterMapError::RenderFailed)?;
    Ok(GlyphImage {
        glyph_id,
        status: if empty { "empty" } else { "ready" }.into(),
        data_url: Some(format!(
            "data:image/png;base64,{}",
            STANDARD.encode(png.into_inner())
        )),
        error: None,
    })
}

fn render_outline_or_colr(
    data: Arc<Vec<u8>>,
    index: u32,
    glyph_id: u32,
    request: &RenderRequest,
    location: &Location,
    size: f32,
    origin: [f32; 2],
) -> Result<Vec<u8>, RenderCharacterMapError> {
    use vello_cpu::{
        color::{AlphaColor, Srgb},
        peniko::{Blob, FontData},
        Glyph, Pixmap, RenderContext, Resources,
    };
    let mut context = RenderContext::new(request.size as u16, request.size as u16);
    let mut resources = Resources::new();
    context.set_paint(AlphaColor::<Srgb>::from_rgba8(
        request.foreground[0],
        request.foreground[1],
        request.foreground[2],
        request.foreground[3],
    ));
    let font = FontData::new(Blob::new(data), index);
    let coords: Vec<i16> = location
        .coords()
        .iter()
        .map(|value| value.to_bits())
        .collect();
    context
        .glyph_run(&mut resources, &font)
        .font_size(size)
        .normalized_coords(&coords)
        .fill_glyphs(std::iter::once(Glyph {
            id: glyph_id,
            x: origin[0],
            y: origin[1],
        }))
        .map_err(|_| RenderCharacterMapError::RenderFailed)?;
    let mut pixmap = Pixmap::new(request.size as u16, request.size as u16);
    context.render(&mut pixmap, &mut resources);
    Ok(unpremultiply(pixmap.data_as_u8_slice().to_vec()))
}

pub(crate) fn unpremultiply(mut data: Vec<u8>) -> Vec<u8> {
    for pixel in data.as_chunks_mut::<4>().0 {
        let alpha = pixel[3] as u32;
        for channel in &mut pixel[..3] {
            *channel = (*channel as u32 * 255 + alpha / 2)
                .checked_div(alpha)
                .unwrap_or(0)
                .min(255) as u8;
        }
    }
    data
}

fn render_bitmap(
    font: &FontRef<'_>,
    glyph: skrifa::GlyphId,
    request: &RenderRequest,
    size: f32,
    x: f32,
    y: f32,
) -> Result<Option<Vec<u8>>, RenderCharacterMapError> {
    if font.color_glyphs().get(glyph).is_some() {
        return Ok(None);
    }
    if font.sbix().is_ok() {
        if let Some(image) = render_sbix(font, glyph, request, size, x, y)? {
            return Ok(Some(image));
        }
    }
    let Some(bitmap) = crate::bitmap::raster(font, glyph, size, request.foreground)? else {
        return Ok(None);
    };
    let scale = size / bitmap.ppem;
    let width = (bitmap.image.width() as f32 * scale)
        .round()
        .clamp(1.0, request.size as f32 * 4.0) as u32;
    let height = (bitmap.image.height() as f32 * scale)
        .round()
        .clamp(1.0, request.size as f32 * 4.0) as u32;
    let image = image::imageops::resize(
        &bitmap.image,
        width,
        height,
        image::imageops::FilterType::Lanczos3,
    );
    let mut canvas = image::RgbaImage::new(request.size, request.size);
    image::imageops::overlay(
        &mut canvas,
        &image,
        (x + bitmap.bearing_x * scale).round() as i64,
        (y - bitmap.bearing_y * scale).round() as i64,
    );
    Ok(Some(canvas.into_raw()))
}

pub(crate) fn decode_image(
    data: &[u8],
    format: image::ImageFormat,
) -> Result<image::RgbaImage, RenderCharacterMapError> {
    if data.len() > 16 * 1024 * 1024 {
        return Err(RenderCharacterMapError::RenderFailed);
    }
    let mut reader = image::ImageReader::with_format(Cursor::new(data), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    reader
        .decode()
        .map(|image| image.to_rgba8())
        .map_err(|_| RenderCharacterMapError::RenderFailed)
}

fn render_sbix(
    font: &FontRef<'_>,
    glyph: skrifa::GlyphId,
    request: &RenderRequest,
    size: f32,
    x: f32,
    y: f32,
) -> Result<Option<Vec<u8>>, RenderCharacterMapError> {
    use read_fonts::types::Tag;
    let table = font
        .sbix()
        .map_err(|_| RenderCharacterMapError::RenderFailed)?;
    let strike = table
        .strikes()
        .iter()
        .filter_map(Result::ok)
        .filter(|strike| !matches!(strike.glyph_data(glyph), Ok(None)))
        .min_by(|a, b| {
            let distance = |ppem: u16| {
                if ppem as f32 >= size {
                    ppem as f32 - size
                } else {
                    size - ppem as f32 + 65536.0
                }
            };
            distance(a.ppem()).total_cmp(&distance(b.ppem()))
        });
    let Some(strike) = strike else {
        return Ok(None);
    };
    let mut id = glyph;
    let mut seen = std::collections::BTreeSet::new();
    let mut origin = None;
    loop {
        if !seen.insert(id.to_u32()) || seen.len() > 32 {
            return Err(RenderCharacterMapError::RenderFailed);
        }
        let Some(data) = strike
            .glyph_data(id)
            .map_err(|_| RenderCharacterMapError::RenderFailed)?
        else {
            return Ok(None);
        };
        let (origin_x, origin_y) =
            *origin.get_or_insert((data.origin_offset_x(), data.origin_offset_y()));
        if data.graphic_type() == Tag::new(b"dupe") {
            let bytes: [u8; 2] = data
                .data()
                .get(..2)
                .ok_or(RenderCharacterMapError::RenderFailed)?
                .try_into()
                .unwrap();
            id = skrifa::GlyphId::new(u16::from_be_bytes(bytes) as u32);
            continue;
        }
        let format = match data.graphic_type() {
            tag if tag == Tag::new(b"png ") => image::ImageFormat::Png,
            tag if tag == Tag::new(b"jpg ") => image::ImageFormat::Jpeg,
            tag if tag == Tag::new(b"tiff") => image::ImageFormat::Tiff,
            _ => return Err(RenderCharacterMapError::RenderFailed),
        };
        let image = decode_image(data.data(), format)?;
        let bitmap_scale = size / (strike.ppem() as f32).max(1.0);
        let width = (image.width() as f32 * bitmap_scale)
            .round()
            .clamp(1.0, request.size as f32 * 4.0) as u32;
        let height = (image.height() as f32 * bitmap_scale)
            .round()
            .clamp(1.0, request.size as f32 * 4.0) as u32;
        let image =
            image::imageops::resize(&image, width, height, image::imageops::FilterType::Lanczos3);
        let units = font
            .head()
            .map_err(|_| RenderCharacterMapError::InvalidFont)?
            .units_per_em()
            .max(1) as f32;
        let metrics =
            font.glyph_metrics(Size::unscaled(), skrifa::instance::LocationRef::default());
        let bounds = metrics.bounds(glyph);
        let left = x
            + bounds.map_or(0.0, |bounds| bounds.x_min) * size / units
            + origin_x as f32 * bitmap_scale;
        let top = y
            - bounds.map_or(0.0, |bounds| bounds.y_min) * size / units
            - origin_y as f32 * bitmap_scale
            - height as f32;
        let mut canvas = image::RgbaImage::new(request.size, request.size);
        image::imageops::overlay(&mut canvas, &image, left.round() as i64, top.round() as i64);
        return Ok(Some(canvas.into_raw()));
    }
}

fn render_svg(
    font: &FontRef<'_>,
    glyph_id: u32,
    request: &RenderRequest,
    scale: f32,
    x: f32,
    y: f32,
) -> Result<Option<Vec<u8>>, RenderCharacterMapError> {
    let Ok(svg) = font.svg() else { return Ok(None) };
    let list = svg
        .svg_document_list()
        .map_err(|_| RenderCharacterMapError::InvalidFont)?;
    let Some(record) = list.document_records().iter().find(|record| {
        glyph_id >= record.start_glyph_id().to_u32() && glyph_id <= record.end_glyph_id().to_u32()
    }) else {
        return Ok(None);
    };
    let encoded = svg
        .glyph_data(skrifa::GlyphId::new(glyph_id))
        .ok_or(RenderCharacterMapError::RenderFailed)?;
    const SVG_LIMIT: usize = 16 * 1024 * 1024;
    if encoded.len() > SVG_LIMIT {
        return Err(RenderCharacterMapError::RenderFailed);
    }
    let mut decoded = Vec::new();
    if encoded.starts_with(&[0x1f, 0x8b]) {
        flate2::read::GzDecoder::new(encoded)
            .take((SVG_LIMIT + 1) as u64)
            .read_to_end(&mut decoded)
            .map_err(|_| RenderCharacterMapError::RenderFailed)?;
    } else {
        decoded.extend_from_slice(encoded);
    }
    if decoded.len() > SVG_LIMIT {
        return Err(RenderCharacterMapError::RenderFailed);
    }
    let document = String::from_utf8(decoded).map_err(|_| RenderCharacterMapError::RenderFailed)?;
    let palette = font.color_palettes();
    let palette = palette.get(0);
    let document = svg_palette(
        &document,
        palette.as_ref().map_or(&[], |palette| palette.colors()),
    );
    let mut options = resvg::usvg::Options::default();
    options.image_href_resolver.resolve_string = Box::new(|_, _| None);
    let resolve_data = resvg::usvg::ImageHrefResolver::default_data_resolver();
    let resource_bytes = std::sync::atomic::AtomicUsize::new(0);
    options.image_href_resolver.resolve_data = Box::new(move |mime, data, options| {
        const RESOURCE_BUDGET: usize = 64 * 1024 * 1024;
        if data.len() > SVG_LIMIT {
            return None;
        }
        let data = if data.starts_with(&[0x1f, 0x8b]) {
            let mut decoded = Vec::new();
            flate2::read::GzDecoder::new(data.as_slice())
                .take((SVG_LIMIT + 1) as u64)
                .read_to_end(&mut decoded)
                .ok()?;
            if decoded.len() > SVG_LIMIT {
                return None;
            }
            Arc::new(decoded)
        } else {
            data
        };
        let decoded_bytes = if let Ok(size) = imagesize::blob_size(&data) {
            if size.width > 4096 || size.height > 4096 {
                return None;
            }
            size.width * size.height * 4
        } else {
            0
        };
        let bytes = data.len() + decoded_bytes;
        if resource_bytes
            .fetch_add(bytes, std::sync::atomic::Ordering::Relaxed)
            .saturating_add(bytes)
            > RESOURCE_BUDGET
        {
            return None;
        }
        resolve_data(mime, data, options)
    });
    options.style_sheet = Some(format!(
        "svg {{ color: rgba({},{},{},{}); }}",
        request.foreground[0],
        request.foreground[1],
        request.foreground[2],
        request.foreground[3] as f32 / 255.0
    ));
    let tree = resvg::usvg::Tree::from_data(document.as_bytes(), &options)
        .map_err(|_| RenderCharacterMapError::RenderFailed)?;
    let mut canvas = resvg::tiny_skia::Pixmap::new(request.size, request.size)
        .ok_or(RenderCharacterMapError::RenderFailed)?;
    let transform = resvg::tiny_skia::Transform::from_scale(scale, scale).post_translate(x, y);
    if let Some(node) = tree.node_by_id(&format!("glyph{glyph_id}")) {
        let bounds = node
            .abs_layer_bounding_box()
            .ok_or(RenderCharacterMapError::RenderFailed)?;
        resvg::render_node(
            node,
            transform.pre_translate(bounds.x(), bounds.y()),
            &mut canvas.as_mut(),
        );
    } else if record.start_glyph_id() == record.end_glyph_id() {
        resvg::render(&tree, transform, &mut canvas.as_mut());
    } else {
        return Err(RenderCharacterMapError::RenderFailed);
    }
    Ok(Some(unpremultiply(canvas.data().to_vec())))
}

// 将 OpenType SVG 的调色板变量解析为首个 CPAL 调色板颜色。
fn svg_palette(document: &str, colors: &[skrifa::color::Color]) -> String {
    let mut output = String::with_capacity(document.len());
    let mut remaining = document;
    while let Some(start) = remaining.find("var(") {
        output.push_str(&remaining[..start]);
        let tail = &remaining[start + 4..];
        let mut depth = 1;
        let end = tail.char_indices().find_map(|(index, character)| {
            match character {
                '(' => depth += 1,
                ')' => depth -= 1,
                _ => {}
            }
            (depth == 0).then_some(index)
        });
        let Some(end) = end else {
            output.push_str(&remaining[start..]);
            return output;
        };
        let (name, fallback) = tail[..end]
            .split_once(',')
            .map_or((&tail[..end], "currentColor"), |(name, value)| {
                (name, value.trim())
            });
        if let Some(index) = name
            .trim()
            .strip_prefix("--color")
            .and_then(|index| index.parse::<usize>().ok())
        {
            if let Some(color) = colors.get(index) {
                output.push_str(&format!(
                    "rgba({},{},{},{})",
                    color.red(),
                    color.green(),
                    color.blue(),
                    color.alpha() as f32 / 255.0
                ));
            } else {
                output.push_str(fallback);
            }
        } else {
            output.push_str(&remaining[start..start + 4 + end + 1]);
        }
        remaining = &tail[end + 1..];
    }
    output.push_str(remaining);
    output
}
