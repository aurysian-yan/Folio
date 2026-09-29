use std::{
    collections::HashMap,
    hash::Hash,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Condvar, Mutex,
    },
    time::SystemTime,
};

use crate::library::{self, SourceDto};

const FONT_BUDGET: usize = 128 * 1024 * 1024;
const IMAGE_BUDGET: usize = 32 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct SourceKey {
    generation: u64,
    face_id: String,
    path: String,
    face_index: u32,
    length: u64,
    modified: Option<SystemTime>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct ImageKey {
    source: SourceKey,
    sample: String,
    size: u32,
}

type SharedResult = Result<Arc<Vec<u8>>, String>;

#[derive(Default)]
struct Flight {
    result: Mutex<Option<SharedResult>>,
    completed: Condvar,
}

struct CacheState<K> {
    generation: u64,
    tick: u64,
    bytes: usize,
    entries: HashMap<K, (Arc<Vec<u8>>, u64)>,
    flights: HashMap<K, Arc<Flight>>,
}

// 字节预算限制闲置缓存，同一来源的并发请求共享一次导出。
struct ByteCache<K> {
    budget: usize,
    state: Mutex<CacheState<K>>,
}

impl<K: Clone + Eq + Hash> ByteCache<K> {
    fn new(budget: usize) -> Self {
        Self {
            budget,
            state: Mutex::new(CacheState {
                generation: 0,
                tick: 0,
                bytes: 0,
                entries: HashMap::new(),
                flights: HashMap::new(),
            }),
        }
    }

    fn invalidate(&self, generation: u64) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.generation = generation;
        state.entries.clear();
        state.bytes = 0;
    }

    fn get_or_load(
        &self,
        key: K,
        generation: u64,
        load: impl FnOnce() -> Result<Vec<u8>, String>,
    ) -> SharedResult {
        let (flight, owner) = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "字体预览暂时不可用".to_owned())?;
            if state.generation != generation {
                return Err("字体目录已更新，请重试".to_owned());
            }
            state.tick += 1;
            let tick = state.tick;
            if let Some((data, used)) = state.entries.get_mut(&key) {
                *used = tick;
                return Ok(Arc::clone(data));
            }
            if let Some(flight) = state.flights.get(&key) {
                (Arc::clone(flight), false)
            } else {
                let flight = Arc::new(Flight::default());
                state.flights.insert(key.clone(), Arc::clone(&flight));
                (flight, true)
            }
        };
        if !owner {
            let mut result = flight
                .result
                .lock()
                .map_err(|_| "字体预览暂时不可用".to_owned())?;
            while result.is_none() {
                result = flight
                    .completed
                    .wait(result)
                    .map_err(|_| "字体预览暂时不可用".to_owned())?;
            }
            return result.as_ref().unwrap().clone();
        }
        let mut result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(load))
            .unwrap_or_else(|_| Err("字体预览失败".to_owned()))
            .map(Arc::new);
        {
            let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            state.flights.remove(&key);
            if state.generation != generation {
                result = Err("字体目录已更新，请重试".to_owned());
            } else if let Ok(data) = &result {
                if data.len() <= self.budget {
                    while state.bytes + data.len() > self.budget {
                        let oldest = state
                            .entries
                            .iter()
                            .min_by_key(|(_, (_, used))| *used)
                            .map(|(key, _)| key.clone());
                        if let Some(oldest) = oldest {
                            if let Some((old, _)) = state.entries.remove(&oldest) {
                                state.bytes -= old.len();
                            }
                        } else {
                            break;
                        }
                    }
                    state.tick += 1;
                    let tick = state.tick;
                    state.bytes += data.len();
                    state.entries.insert(key, (Arc::clone(data), tick));
                }
            }
        }
        *flight
            .result
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(result.clone());
        flight.completed.notify_all();
        result
    }
}

pub struct PreviewService {
    generation: AtomicU64,
    fonts: ByteCache<SourceKey>,
    images: ByteCache<ImageKey>,
}

impl Default for PreviewService {
    fn default() -> Self {
        Self {
            generation: AtomicU64::new(0),
            fonts: ByteCache::new(FONT_BUDGET),
            images: ByteCache::new(IMAGE_BUDGET),
        }
    }
}

impl PreviewService {
    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::Acquire)
    }

    // 调用方在字体库锁内更新代次，保证来源快照与缓存代次一致。
    pub fn invalidate(&self) {
        let generation = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        self.fonts.invalidate(generation);
        self.images.invalidate(generation);
    }

    pub fn font(&self, face_id: &str, sources: &[SourceDto], generation: u64) -> SharedResult {
        let (source, key) = source_key(face_id, sources, generation)?;
        self.fonts.get_or_load(key.clone(), generation, || {
            let packet = library::load_preview_font(source)
                .and_then(|font| font.into_packet())
                .map_err(|error| error.to_string())?;
            verify_source(&key)?;
            Ok(packet)
        })
    }

    pub fn image(
        &self,
        face_id: &str,
        sources: &[SourceDto],
        generation: u64,
        sample: &str,
        size: u32,
    ) -> Result<String, String> {
        let (source, key) = source_key(face_id, sources, generation)?;
        let size = size.clamp(24, 104);
        let sample: String = sample.chars().take(48).collect();
        let key = ImageKey {
            source: key,
            sample,
            size,
        };
        let data = self.images.get_or_load(key.clone(), generation, || {
            let image = library::render_face_preview(source, &key.sample, size as f32)
                .map_err(|error| error.to_string())?;
            verify_source(&key.source)?;
            Ok(image.into_bytes())
        })?;
        String::from_utf8(data.as_ref().clone()).map_err(|_| "字体预览失败".to_owned())
    }
}

fn source_key<'a>(
    face_id: &str,
    sources: &'a [SourceDto],
    generation: u64,
) -> Result<(&'a SourceDto, SourceKey), String> {
    sources
        .iter()
        .find_map(|source| {
            let metadata = std::fs::metadata(&source.path).ok()?;
            metadata.is_file().then(|| {
                (
                    source,
                    SourceKey {
                        generation,
                        face_id: face_id.to_owned(),
                        path: source.path.clone(),
                        face_index: source.face_index,
                        length: metadata.len(),
                        modified: metadata.modified().ok(),
                    },
                )
            })
        })
        .ok_or_else(|| "字体文件已不可用".to_owned())
}

fn verify_source(key: &SourceKey) -> Result<(), String> {
    let metadata = std::fs::metadata(&key.path).map_err(|_| "字体文件已不可用".to_owned())?;
    if metadata.len() != key.length || metadata.modified().ok() != key.modified {
        return Err("字体文件已变化，请重试".to_owned());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn cache_evicts_least_recently_used_by_bytes() {
        let cache = ByteCache::new(6);
        let a = cache.get_or_load("a", 0, || Ok(vec![1; 3])).unwrap();
        cache.get_or_load("b", 0, || Ok(vec![2; 3])).unwrap();
        assert!(Arc::ptr_eq(
            &a,
            &cache.get_or_load("a", 0, || panic!()).unwrap()
        ));
        cache.get_or_load("c", 0, || Ok(vec![3; 3])).unwrap();
        let state = cache.state.lock().unwrap();
        assert_eq!(state.bytes, 6);
        assert!(state.entries.contains_key("a"));
        assert!(!state.entries.contains_key("b"));
    }

    #[test]
    fn invalidation_discards_old_inflight_results() {
        let cache = ByteCache::new(10);
        assert!(cache
            .get_or_load("a", 0, || {
                cache.invalidate(1);
                Ok(vec![1])
            })
            .is_err());
        assert_eq!(cache.state.lock().unwrap().bytes, 0);
        assert!(cache.get_or_load("a", 0, || panic!()).is_err());
        assert_eq!(&**cache.get_or_load("a", 1, || Ok(vec![2])).unwrap(), &[2]);
    }

    #[test]
    fn concurrent_requests_share_export_and_errors_do_not_poison_cache() {
        let cache = ByteCache::new(10);
        let calls = AtomicUsize::new(0);
        std::thread::scope(|scope| {
            for _ in 0..8 {
                scope.spawn(|| {
                    assert_eq!(
                        &**cache
                            .get_or_load("a", 0, || {
                                calls.fetch_add(1, Ordering::SeqCst);
                                std::thread::sleep(std::time::Duration::from_millis(20));
                                Ok(vec![7])
                            })
                            .unwrap(),
                        &[7]
                    );
                });
            }
        });
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(cache
            .get_or_load("b", 0, || Err("错误".to_owned()))
            .is_err());
        assert!(cache.get_or_load("b", 0, || Ok(vec![1])).is_ok());
    }

    #[test]
    fn changed_or_missing_sources_invalidate_cached_fonts() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("font.ttf");
        let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../fixtures/fonts/Lato-Regular.ttf");
        let mut data = std::fs::read(fixture).unwrap();
        std::fs::write(&path, &data).unwrap();
        let source = SourceDto {
            path: path.to_string_lossy().into_owned(),
            face_index: 0,
        };
        let service = PreviewService::default();
        let original = service
            .font("font", std::slice::from_ref(&source), 0)
            .unwrap();
        assert!(Arc::ptr_eq(
            &original,
            &service
                .font("font", std::slice::from_ref(&source), 0)
                .unwrap()
        ));
        data.push(0);
        std::fs::write(&path, &data).unwrap();
        let changed = service
            .font("font", std::slice::from_ref(&source), 0)
            .unwrap();
        assert!(!Arc::ptr_eq(&original, &changed));
        assert!(changed.len() > original.len());
        std::fs::remove_file(&path).unwrap();
        assert!(service.font("font", &[source], 0).is_err());
    }
}
