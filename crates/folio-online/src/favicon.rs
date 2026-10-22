//! 来源图标的安全读取、位图归一化与本机缓存。

use crate::browser::{self, ProviderIcon, SearchProvider};
use folio_storage::{FolioDatabase, ResourceGuard};
use image::{ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub const CUSTOM_ICON_LIMIT: u64 = 8 * 1024 * 1024;
const REMOTE_ICON_LIMIT: u64 = 1024 * 1024;
type Result<T> = std::result::Result<T, IconError>;

#[derive(Debug, thiserror::Error)]
pub enum IconError {
    #[error("online.browser.invalidIcon")]
    InvalidIcon,
    #[error("online.browser.acceptRequired")]
    AcceptRequired,
    #[error("online.browser.storageError")]
    Storage(#[from] folio_storage::StorageError),
    #[error("online.browser.storageError")]
    Io(#[from] std::io::Error),
    #[error("online.browser.storageError")]
    Json(#[from] serde_json::Error),
}

#[derive(Clone, Serialize, Deserialize)]
struct CachedIcon {
    homepage: String,
    candidate_key: String,
    attempted_at: u64,
    asset_id: Option<String>,
    success: bool,
}

pub struct IconCache {
    directory: PathBuf,
    database: PathBuf,
}

impl IconCache {
    pub fn open(database: impl AsRef<Path>) -> Result<Self> {
        let database = database.as_ref();
        let directory = database
            .parent()
            .ok_or(IconError::InvalidIcon)?
            .join("online-icons");
        fs::create_dir_all(&directory)?;
        Ok(Self {
            directory: directory.canonicalize()?,
            database: database.to_path_buf(),
        })
    }

    fn asset_path(&self, id: &str) -> Result<PathBuf> {
        if id.len() != 64 || !id.bytes().all(|value| value.is_ascii_hexdigit()) {
            return Err(IconError::InvalidIcon);
        }
        Ok(self.directory.join(format!("{id}.png")))
    }

    pub fn custom_exists(&self, id: &str) -> bool {
        self.asset_path(id).is_ok_and(|path| path.is_file())
    }

    pub fn asset_uri(&self, id: &str) -> Result<String> {
        let path = self.asset_path(id)?;
        if !path.is_file() {
            return Err(IconError::InvalidIcon);
        }
        reqwest::Url::from_file_path(path)
            .map(String::from)
            .map_err(|_| IconError::InvalidIcon)
    }

    pub fn provider_uri(
        &self,
        db: &FolioDatabase,
        provider: &SearchProvider,
    ) -> Result<Option<String>> {
        let id = if let Some(ProviderIcon::Custom { asset_id }) = &provider.icon {
            Some(asset_id.clone())
        } else {
            self.cached(db, &provider.id)?
                .filter(|value| value.homepage == provider.homepage)
                .and_then(|value| value.asset_id)
        };
        let Some(id) = id else { return Ok(None) };
        let path = self.asset_path(&id)?;
        if !path.is_file() {
            return Ok(None);
        }
        Ok(reqwest::Url::from_file_path(path).ok().map(String::from))
    }

    pub fn import_file(&self, path: &Path) -> Result<String> {
        let mut bytes = Vec::new();
        fs::File::open(path)?
            .take(CUSTOM_ICON_LIMIT + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > CUSTOM_ICON_LIMIT {
            return Err(IconError::InvalidIcon);
        }
        self.store(&bytes)
    }

    fn store(&self, bytes: &[u8]) -> Result<String> {
        if bytes.is_empty() || bytes.len() as u64 > CUSTOM_ICON_LIMIT {
            return Err(IconError::InvalidIcon);
        }
        let mut reader = ImageReader::new(Cursor::new(bytes))
            .with_guessed_format()
            .map_err(|_| IconError::InvalidIcon)?;
        if !matches!(
            reader.format(),
            Some(ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP | ImageFormat::Ico)
        ) {
            return Err(IconError::InvalidIcon);
        }
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(4096);
        limits.max_image_height = Some(4096);
        limits.max_alloc = Some(64 * 1024 * 1024);
        reader.limits(limits);
        let image = reader
            .decode()
            .map_err(|_| IconError::InvalidIcon)?
            .thumbnail(128, 128);
        let mut output = Cursor::new(Vec::new());
        image
            .write_to(&mut output, ImageFormat::Png)
            .map_err(|_| IconError::InvalidIcon)?;
        let bytes = output.into_inner();
        let id = blake3::hash(&bytes).to_hex().to_string();
        let path = self.asset_path(&id)?;
        if !path.is_file() {
            let mut temporary = tempfile::NamedTempFile::new_in(&self.directory)?;
            temporary.write_all(&bytes)?;
            temporary.persist(path).map_err(|error| error.error)?;
        }
        Ok(id)
    }

    fn cached(&self, db: &FolioDatabase, provider_id: &str) -> Result<Option<CachedIcon>> {
        db.online_setting(&format!("favicon:{provider_id}"))?
            .map(|value| serde_json::from_str(&value).map_err(Into::into))
            .transpose()
    }

    pub async fn refresh(
        &self,
        provider_id: &str,
        page_url: &str,
        candidates: &[String],
    ) -> Result<bool> {
        let db = FolioDatabase::open(&self.database)?;
        if db.online_setting("disclaimer")?.is_none() {
            return Err(IconError::AcceptRequired);
        }
        let provider = browser::providers(&db)
            .map_err(|_| IconError::InvalidIcon)?
            .into_iter()
            .find(|value| value.id == provider_id)
            .ok_or(IconError::InvalidIcon)?;
        if provider.icon.is_some() {
            return Ok(false);
        }
        let page = browser::public_https(page_url).map_err(|_| IconError::InvalidIcon)?;
        let home = browser::public_https(&provider.homepage).map_err(|_| IconError::InvalidIcon)?;
        let host = home.host_str().ok_or(IconError::InvalidIcon)?;
        let current = page.host_str().ok_or(IconError::InvalidIcon)?;
        if current != host && !current.ends_with(&format!(".{host}")) {
            return Ok(false);
        }
        let _guard =
            match ResourceGuard::acquire(&self.database, &format!("favicon:{provider_id}"), true) {
                Ok(guard) => guard,
                Err(folio_storage::StorageError::ResourceBusy) => return Ok(false),
                Err(error) => return Err(error.into()),
            };
        let mut urls: Vec<_> = candidates
            .iter()
            .take(4)
            .filter_map(|value| browser::public_https(value).ok())
            .collect();
        let fallback = home
            .join("/favicon.ico")
            .map_err(|_| IconError::InvalidIcon)?;
        if !urls.contains(&fallback) {
            urls.push(fallback);
        }
        let candidate_key = blake3::hash(
            serde_json::to_string(&urls.iter().map(|v| v.as_str()).collect::<Vec<_>>())?.as_bytes(),
        )
        .to_hex()
        .to_string();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let previous = self
            .cached(&db, provider_id)?
            .filter(|value| value.homepage == provider.homepage);
        if previous.as_ref().is_some_and(|value| {
            value.candidate_key == candidate_key
                && now.saturating_sub(value.attempted_at) < if value.success { 86400 } else { 600 }
        }) {
            return Ok(false);
        }
        let fetched = tokio::time::timeout(Duration::from_secs(12), async {
            for url in urls {
                if let Some(bytes) = fetch(url).await {
                    if let Ok(id) = self.store(&bytes) {
                        return Some(id);
                    }
                }
            }
            None
        })
        .await
        .ok()
        .flatten();
        // 自定义设置与来源编辑优先于较早发出的网络请求。
        if !browser::providers(&db)
            .map_err(|_| IconError::InvalidIcon)?
            .iter()
            .any(|value| {
                value.id == provider_id
                    && value.homepage == provider.homepage
                    && value.icon.is_none()
            })
        {
            return Ok(false);
        }
        let success = fetched.is_some();
        let cached = CachedIcon {
            homepage: provider.homepage,
            candidate_key,
            attempted_at: now,
            success,
            asset_id: fetched.or_else(|| previous.and_then(|value| value.asset_id)),
        };
        db.save_online_setting(
            &format!("favicon:{provider_id}"),
            &serde_json::to_string(&cached)?,
        )?;
        Ok(success)
    }
}

async fn fetch(mut url: reqwest::Url) -> Option<Vec<u8>> {
    for _ in 0..=5 {
        let host = url.host_str()?;
        let addresses: Vec<_> = tokio::net::lookup_host((host, url.port_or_known_default()?))
            .await
            .ok()?
            .collect();
        if addresses.is_empty()
            || addresses
                .iter()
                .any(|value| !browser::public_ip(value.ip()))
        {
            return None;
        }
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(6))
            .resolve_to_addrs(host, &addresses)
            .build()
            .ok()?;
        let mut response = client
            .get(url.clone())
            .header("Accept-Encoding", "identity")
            .send()
            .await
            .ok()?;
        if response.status().is_redirection() {
            let next = url
                .join(response.headers().get("Location")?.to_str().ok()?)
                .ok()?;
            url = browser::public_https(next.as_str()).ok()?;
            continue;
        }
        if !response.status().is_success()
            || response
                .content_length()
                .is_some_and(|value| value > REMOTE_ICON_LIMIT)
        {
            return None;
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.ok()? {
            if bytes.len() as u64 + chunk.len() as u64 > REMOTE_ICON_LIMIT {
                return None;
            }
            bytes.extend_from_slice(&chunk);
        }
        return Some(bytes);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let image = image::DynamicImage::new_rgba8(width, height);
        let mut output = Cursor::new(Vec::new());
        image.write_to(&mut output, ImageFormat::Png).unwrap();
        output.into_inner()
    }

    #[test]
    fn imported_icons_are_normalized_and_survive_reopen() {
        let root = tempfile::tempdir().unwrap();
        let database = root.path().join("folio.sqlite");
        let db = FolioDatabase::open(&database).unwrap();
        let cache = IconCache::open(&database).unwrap();
        let source = root.path().join("uploaded-image");
        fs::write(&source, png(256, 64)).unwrap();
        let id = cache.import_file(&source).unwrap();
        let image = image::open(cache.asset_path(&id).unwrap()).unwrap();
        assert_eq!((image.width(), image.height()), (128, 32));
        let mut providers = browser::default_providers();
        providers[0].icon = Some(ProviderIcon::Custom {
            asset_id: id.clone(),
        });
        browser::save_providers(&db, providers).unwrap();
        drop(cache);
        let cache = IconCache::open(&database).unwrap();
        let provider = browser::providers(&db).unwrap().remove(0);
        assert_eq!(
            cache.provider_uri(&db, &provider).unwrap(),
            Some(cache.asset_uri(&id).unwrap())
        );
        assert_eq!(cache.import_file(&source).unwrap(), id);
    }

    #[test]
    fn scripts_wrong_formats_oversized_inputs_and_invalid_asset_paths_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let cache = IconCache::open(root.path().join("folio.sqlite")).unwrap();
        assert!(cache
            .store(b"<svg><script>alert(1)</script></svg>")
            .is_err());
        assert!(cache.store(b"<html>login</html>").is_err());
        assert!(cache
            .store(&vec![0; CUSTOM_ICON_LIMIT as usize + 1])
            .is_err());
        assert!(cache.store(&png(4097, 1)).is_err());
        assert!(cache.asset_uri("../../font").is_err());
        assert!(cache.asset_uri(&"a".repeat(64)).is_err());
    }

    #[tokio::test]
    async fn custom_icon_takes_priority_and_reset_restores_cached_favicon() {
        let root = tempfile::tempdir().unwrap();
        let database = root.path().join("folio.sqlite");
        let db = FolioDatabase::open(&database).unwrap();
        let cache = IconCache::open(&database).unwrap();
        let automatic = cache.store(&png(16, 16)).unwrap();
        let custom = cache.store(&png(32, 16)).unwrap();
        let mut providers = browser::default_providers();
        let mut provider = providers[0].clone();
        let cached = CachedIcon {
            homepage: provider.homepage.clone(),
            candidate_key: String::new(),
            attempted_at: 0,
            asset_id: Some(automatic.clone()),
            success: true,
        };
        db.save_online_setting(
            &format!("favicon:{}", provider.id),
            &serde_json::to_string(&cached).unwrap(),
        )
        .unwrap();
        provider.icon = Some(ProviderIcon::Custom {
            asset_id: custom.clone(),
        });
        providers[0] = provider.clone();
        browser::save_providers(&db, providers.clone()).unwrap();
        db.save_online_setting("disclaimer", "1").unwrap();
        assert!(!cache
            .refresh(&provider.id, &provider.homepage, &[])
            .await
            .unwrap());
        assert_eq!(
            cache.provider_uri(&db, &provider).unwrap(),
            Some(cache.asset_uri(&custom).unwrap())
        );
        provider.icon = None;
        providers[0] = provider.clone();
        browser::save_providers(&db, providers).unwrap();
        assert_eq!(
            cache.provider_uri(&db, &provider).unwrap(),
            Some(cache.asset_uri(&automatic).unwrap())
        );
        provider.homepage = "https://other.example.com/".into();
        assert_eq!(cache.provider_uri(&db, &provider).unwrap(), None);
    }

    #[tokio::test]
    #[ignore = "需要访问公开 HTTPS 图标"]
    async fn public_favicon_is_cached_without_changing_source_configuration() {
        let root = tempfile::tempdir().unwrap();
        let database = root.path().join("folio.sqlite");
        let db = FolioDatabase::open(&database).unwrap();
        let cache = IconCache::open(&database).unwrap();
        db.save_online_setting("disclaimer", "1").unwrap();
        let provider = browser::default_providers().remove(0);
        let candidates = vec!["https://www.google.com/favicon.ico".into()];
        assert!(cache
            .refresh(&provider.id, &provider.homepage, &candidates)
            .await
            .unwrap());
        assert!(cache.provider_uri(&db, &provider).unwrap().is_some());
        assert!(!cache
            .refresh(&provider.id, &provider.homepage, &candidates)
            .await
            .unwrap());
        assert_eq!(db.online_setting("providers").unwrap(), None);
    }
}
