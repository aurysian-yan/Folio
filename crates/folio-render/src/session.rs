//! 字符表快照固定来源与版本，图片缓存按字节预算回收。

use crate::glyph::{render_glyph, GlyphImage, RenderRequest};
use folio_core::{CharacterMapIndex, CharacterPage, CharacterScript, FontFace};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

const IMAGE_BUDGET: usize = 32 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCharacterMap {
    pub face_id: String,
    pub revision_id: String,
    pub source_path: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn image_budget_evicts_old_items_and_close_releases_the_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gradient.ttf");
        std::fs::write(&path, font_test_data::COLR_GRADIENT_RECT).unwrap();
        let catalog = folio_core::scan_directory(dir.path(), &folio_core::ScanOptions::default())
            .unwrap()
            .catalog;
        let face = catalog.faces().next().unwrap();
        let service = CharacterMapService::default();
        let info = service
            .open(
                face,
                &OpenCharacterMap {
                    face_id: face.id.to_string(),
                    revision_id: face.revision_id.to_string(),
                    source_path: face.sources[0].path().to_string_lossy().into_owned(),
                },
            )
            .unwrap();
        for color in 0..10 {
            service
                .render(&RenderRequest {
                    handle: info.handle.clone(),
                    glyph_ids: vec![2],
                    axes: BTreeMap::new(),
                    size: 1024,
                    foreground: [color, 0, 0, 255],
                })
                .unwrap();
            assert!(service.images.lock().unwrap().bytes <= IMAGE_BUDGET);
        }
        assert!(service.images.lock().unwrap().entries.len() < 10);
        service.close(&info.handle);
        assert_eq!(service.images.lock().unwrap().bytes, 0);
        assert!(service.sessions.lock().unwrap().is_empty());
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCharacterMapResult {
    pub handle: String,
    pub revision_id: String,
    pub source_path: String,
    pub face_index: u32,
    pub count: u32,
    pub scripts: Vec<CharacterScript>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryCharacterMap {
    pub handle: String,
    #[serde(default)]
    pub text: String,
    pub script: Option<String>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default = "page_size")]
    pub limit: u32,
}

fn page_size() -> u32 {
    256
}

#[derive(Debug, Clone, Copy, thiserror::Error, PartialEq, Eq)]
pub enum RenderCharacterMapError {
    #[error("characterMap.error.notDownloaded")]
    NotDownloaded,
    #[error("characterMap.error.sourceUnavailable")]
    SourceUnavailable,
    #[error("characterMap.error.staleSource")]
    StaleSource,
    #[error("characterMap.error.invalidFont")]
    InvalidFont,
    #[error("characterMap.error.invalidQuery")]
    InvalidQuery,
    #[error("characterMap.error.invalidAxes")]
    InvalidAxes,
    #[error("characterMap.error.sessionClosed")]
    SessionClosed,
    #[error("characterMap.error.renderFailed")]
    RenderFailed,
}

struct Session {
    data: Arc<Vec<u8>>,
    index: CharacterMapIndex,
    face_index: u32,
    path: String,
    modified: Option<SystemTime>,
    created: Option<SystemTime>,
    closed: AtomicBool,
}

impl Session {
    fn check(&self) -> Result<(), RenderCharacterMapError> {
        if self.closed.load(Ordering::Acquire) {
            return Err(RenderCharacterMapError::SessionClosed);
        }
        let metadata = std::fs::metadata(&self.path)
            .map_err(|_| RenderCharacterMapError::SourceUnavailable)?;
        if metadata.len() != self.data.len() as u64
            || metadata.modified().ok() != self.modified
            || metadata.created().ok() != self.created
        {
            return Err(RenderCharacterMapError::StaleSource);
        }
        std::fs::File::open(&self.path).map_err(|_| RenderCharacterMapError::SourceUnavailable)?;
        Ok(())
    }
}

struct CacheEntry {
    handle: String,
    key: String,
    image: GlyphImage,
    bytes: usize,
}
#[derive(Default)]
struct ImageCache {
    entries: VecDeque<CacheEntry>,
    bytes: usize,
}

#[derive(Default)]
pub struct CharacterMapService {
    next_id: AtomicU64,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    images: Mutex<ImageCache>,
}

impl CharacterMapService {
    pub fn open(
        &self,
        face: &FontFace,
        request: &OpenCharacterMap,
    ) -> Result<OpenCharacterMapResult, RenderCharacterMapError> {
        if face.id.to_string() != request.face_id
            || face.revision_id.to_string() != request.revision_id
        {
            return Err(RenderCharacterMapError::StaleSource);
        }
        if face.sources.is_empty() {
            return Err(RenderCharacterMapError::NotDownloaded);
        }
        let source = face
            .sources
            .iter()
            .find(|source| source.path() == Path::new(&request.source_path))
            .ok_or(RenderCharacterMapError::SourceUnavailable)?;
        let before = std::fs::metadata(source.path())
            .map_err(|_| RenderCharacterMapError::SourceUnavailable)?;
        if !before.is_file() || before.len() > 512 * 1024 * 1024 {
            return Err(RenderCharacterMapError::InvalidFont);
        }
        let data =
            std::fs::read(source.path()).map_err(|_| RenderCharacterMapError::SourceUnavailable)?;
        let after = std::fs::metadata(source.path())
            .map_err(|_| RenderCharacterMapError::SourceUnavailable)?;
        if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
            return Err(RenderCharacterMapError::StaleSource);
        }
        if !face.matches_revision_data(&data, source.face_index()) {
            return Err(RenderCharacterMapError::StaleSource);
        }
        let index = CharacterMapIndex::from_data(&data, source.face_index())
            .map_err(|_| RenderCharacterMapError::InvalidFont)?;
        let handle = format!("charmap-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let result = OpenCharacterMapResult {
            handle: handle.clone(),
            revision_id: request.revision_id.clone(),
            source_path: request.source_path.clone(),
            face_index: source.face_index(),
            count: index.len(),
            scripts: index.scripts.clone(),
        };
        let session = Arc::new(Session {
            data: Arc::new(data),
            index,
            face_index: source.face_index(),
            path: request.source_path.clone(),
            modified: after.modified().ok(),
            created: after.created().ok(),
            closed: AtomicBool::new(false),
        });
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| RenderCharacterMapError::SessionClosed)?;
        if sessions.len() >= 8 {
            return Err(RenderCharacterMapError::SessionClosed);
        }
        sessions.insert(handle, session);
        Ok(result)
    }

    pub fn query(
        &self,
        request: &QueryCharacterMap,
    ) -> Result<CharacterPage, RenderCharacterMapError> {
        let session = self.session(&request.handle)?;
        session.check()?;
        session
            .index
            .query(
                &request.text,
                request.script.as_deref(),
                request.offset,
                request.limit,
            )
            .map_err(|_| RenderCharacterMapError::InvalidQuery)
    }

    pub fn render(
        &self,
        request: &RenderRequest,
    ) -> Result<Vec<GlyphImage>, RenderCharacterMapError> {
        if !(16..=1024).contains(&request.size) || request.glyph_ids.len() > 256 {
            return Err(RenderCharacterMapError::InvalidQuery);
        }
        let session = self.session(&request.handle)?;
        session.check()?;
        crate::glyph::validate_axes(&session.data, session.face_index, &request.axes)?;
        let mut result = Vec::with_capacity(request.glyph_ids.len());
        for &glyph_id in &request.glyph_ids {
            session.check()?;
            if !session.index.contains_glyph(glyph_id) {
                return Err(RenderCharacterMapError::InvalidQuery);
            }
            let key = serde_json::to_string(&(
                &request.handle,
                glyph_id,
                &request.axes,
                request.size,
                request.foreground,
            ))
            .map_err(|_| RenderCharacterMapError::InvalidQuery)?;
            let cached = {
                let mut cache = self
                    .images
                    .lock()
                    .map_err(|_| RenderCharacterMapError::SessionClosed)?;
                cache
                    .entries
                    .iter()
                    .position(|entry| entry.key == key)
                    .and_then(|position| {
                        let entry = cache.entries.remove(position)?;
                        let image = entry.image.clone();
                        cache.entries.push_back(entry);
                        Some(image)
                    })
            };
            if let Some(image) = cached {
                result.push(image);
                continue;
            }
            let image = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                render_glyph(
                    Arc::clone(&session.data),
                    session.face_index,
                    glyph_id,
                    request,
                )
            }))
            .unwrap_or(Err(RenderCharacterMapError::RenderFailed))
            .unwrap_or_else(|error| GlyphImage::error(glyph_id, error));
            session.check()?;
            let bytes = image.data_url.as_ref().map_or(0, |data| data.len() * 2)
                + (request.size * request.size * 4) as usize;
            let mut cache = self
                .images
                .lock()
                .map_err(|_| RenderCharacterMapError::SessionClosed)?;
            if session.closed.load(Ordering::Acquire) {
                return Err(RenderCharacterMapError::SessionClosed);
            }
            if bytes <= IMAGE_BUDGET && image.status != "error" {
                while cache.bytes + bytes > IMAGE_BUDGET {
                    let Some(oldest) = cache.entries.pop_front() else {
                        break;
                    };
                    cache.bytes -= oldest.bytes;
                }
                cache.bytes += bytes;
                cache.entries.push_back(CacheEntry {
                    handle: request.handle.clone(),
                    key,
                    image: image.clone(),
                    bytes,
                });
            }
            result.push(image);
        }
        Ok(result)
    }

    pub fn close(&self, handle: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(session) = sessions.remove(handle) {
                session.closed.store(true, Ordering::Release);
            }
        }
        if let Ok(mut images) = self.images.lock() {
            images.entries.retain(|entry| entry.handle != handle);
            images.bytes = images.entries.iter().map(|entry| entry.bytes).sum();
        }
    }

    fn session(&self, handle: &str) -> Result<Arc<Session>, RenderCharacterMapError> {
        self.sessions
            .lock()
            .map_err(|_| RenderCharacterMapError::SessionClosed)?
            .get(handle)
            .cloned()
            .ok_or(RenderCharacterMapError::SessionClosed)
    }
}
