//! 解码 OpenType 嵌入位图及复合位图，保留像素定位和透明度。

use crate::{glyph::decode_image, RenderCharacterMapError};
use read_fonts::{
    tables::{
        bitmap::{
            BitmapContent, BitmapData, BitmapDataFormat, BitmapLocation, BitmapMetrics, BitmapSize,
        },
        cbdt::Cbdt,
        cblc::Cblc,
        ebdt::Ebdt,
        eblc::Eblc,
    },
    FontData, FontRef, TableProvider,
};
use skrifa::{bitmap::MaskData, GlyphId};
use std::collections::BTreeSet;

pub(crate) struct BitmapRaster {
    pub image: image::RgbaImage,
    pub bearing_x: f32,
    pub bearing_y: f32,
    pub ppem: f32,
}

enum Source<'a> {
    Color(Cblc<'a>, Cbdt<'a>),
    Mono(Eblc<'a>, Ebdt<'a>),
}
impl<'a> Source<'a> {
    fn sizes(&self) -> &[BitmapSize] {
        match self {
            Self::Color(table, _) => table.bitmap_sizes(),
            Self::Mono(table, _) => table.bitmap_sizes(),
        }
    }
    fn offsets(&self) -> FontData<'a> {
        match self {
            Self::Color(table, _) => table.offset_data(),
            Self::Mono(table, _) => table.offset_data(),
        }
    }
    fn data(&self, location: &BitmapLocation) -> Result<BitmapData<'a>, RenderCharacterMapError> {
        match self {
            Self::Color(_, table) => table.data(location),
            Self::Mono(_, table) => table.data(location),
        }
        .map_err(|_| RenderCharacterMapError::RenderFailed)
    }
}

pub(crate) fn raster(
    font: &FontRef<'_>,
    glyph: GlyphId,
    size: f32,
    foreground: [u8; 4],
) -> Result<Option<BitmapRaster>, RenderCharacterMapError> {
    let color = font
        .cblc()
        .ok()
        .zip(font.cbdt().ok())
        .map(|(location, data)| Source::Color(location, data));
    let mono = font
        .eblc()
        .ok()
        .zip(font.ebdt().ok())
        .map(|(location, data)| Source::Mono(location, data));
    for source in [color, mono].into_iter().flatten() {
        let mut candidates: Vec<_> = source
            .sizes()
            .iter()
            .filter_map(|strike| {
                strike
                    .location(source.offsets(), glyph)
                    .ok()
                    .filter(|location| !location.is_empty())
                    .map(|location| (strike, location))
            })
            .collect();
        let distance = |ppem: u8| {
            if ppem as f32 >= size {
                ppem as f32 - size
            } else {
                size - ppem as f32 + 65536.0
            }
        };
        candidates.sort_by(|(a, _), (b, _)| distance(a.ppem_y()).total_cmp(&distance(b.ppem_y())));
        if let Some((strike, location)) = candidates.first() {
            let bitmap = source.data(location)?;
            let (_, _, bearing_x, bearing_y) = metrics(&bitmap.metrics);
            let image = decode(
                &source,
                strike,
                glyph,
                foreground,
                &mut BTreeSet::new(),
                &mut 1024,
            )?;
            return Ok(Some(BitmapRaster {
                image,
                bearing_x: bearing_x as f32,
                bearing_y: bearing_y as f32,
                ppem: strike.ppem_y().max(1) as f32,
            }));
        }
    }
    Ok(None)
}

fn metrics(metrics: &BitmapMetrics) -> (u32, u32, i8, i8) {
    match metrics {
        BitmapMetrics::Small(metrics) => (
            metrics.width() as u32,
            metrics.height() as u32,
            metrics.bearing_x(),
            metrics.bearing_y(),
        ),
        BitmapMetrics::Big(metrics) => (
            metrics.width() as u32,
            metrics.height() as u32,
            metrics.hori_bearing_x(),
            metrics.hori_bearing_y(),
        ),
    }
}

fn decode(
    source: &Source<'_>,
    strike: &BitmapSize,
    glyph: GlyphId,
    foreground: [u8; 4],
    visited: &mut BTreeSet<u32>,
    budget: &mut usize,
) -> Result<image::RgbaImage, RenderCharacterMapError> {
    if visited.len() >= 16 || *budget == 0 || !visited.insert(glyph.to_u32()) {
        return Err(RenderCharacterMapError::RenderFailed);
    }
    *budget -= 1;
    let location = strike
        .location(source.offsets(), glyph)
        .map_err(|_| RenderCharacterMapError::RenderFailed)?;
    let bitmap = source.data(&location)?;
    let (width, height, _, _) = metrics(&bitmap.metrics);
    let image = match bitmap.content {
        BitmapContent::Composite(components) => {
            let mut canvas = image::RgbaImage::new(width, height);
            for component in components {
                let child = decode(
                    source,
                    strike,
                    GlyphId::new(component.glyph_id().to_u32()),
                    foreground,
                    visited,
                    budget,
                )?;
                image::imageops::overlay(
                    &mut canvas,
                    &child,
                    component.x_offset() as i64,
                    component.y_offset() as i64,
                );
            }
            canvas
        }
        BitmapContent::Data(BitmapDataFormat::Png, bytes) => {
            decode_image(bytes, image::ImageFormat::Png)?
        }
        BitmapContent::Data(BitmapDataFormat::ByteAligned, bytes) if location.bit_depth == 32 => {
            let mut bytes = bytes.to_vec();
            for pixel in bytes.as_chunks_mut::<4>().0 {
                pixel.swap(0, 2);
            }
            image::RgbaImage::from_raw(width, height, crate::glyph::unpremultiply(bytes))
                .ok_or(RenderCharacterMapError::RenderFailed)?
        }
        BitmapContent::Data(format, bytes) => {
            if ![1, 2, 4, 8].contains(&location.bit_depth) {
                return Err(RenderCharacterMapError::RenderFailed);
            }
            let mask = MaskData {
                bpp: location.bit_depth,
                is_packed: format == BitmapDataFormat::BitAligned,
                data: bytes,
            };
            let mut alpha = vec![0; (width * height) as usize];
            mask.decode_to_slice(width, height, &mut alpha)
                .map_err(|_| RenderCharacterMapError::RenderFailed)?;
            let bytes = alpha
                .into_iter()
                .flat_map(|alpha| {
                    [
                        foreground[0],
                        foreground[1],
                        foreground[2],
                        (alpha as u16 * foreground[3] as u16 / 255) as u8,
                    ]
                })
                .collect();
            image::RgbaImage::from_raw(width, height, bytes)
                .ok_or(RenderCharacterMapError::RenderFailed)?
        }
    };
    visited.remove(&glyph.to_u32());
    Ok(image)
}
