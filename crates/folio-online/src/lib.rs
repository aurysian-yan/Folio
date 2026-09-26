//! Google Fonts 离线目录、预览缓存和经过校验的下载边界。

#![forbid(unsafe_code)]

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, SystemTime};

use reqwest::{redirect, Client, Url};
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use tokio::sync::Semaphore;

pub const OFFICIAL_TEMPLATE: &str =
    "https://raw.githubusercontent.com/google/fonts/{commit}/{path}";
const CATALOG_DATA: &str = include_str!("../data/google-fonts.json");
const CACHE_LIMIT: u64 = 512 * 1024 * 1024;
const FILE_LIMIT: u64 = 256 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Catalog {
    pub provider: String,
    pub commit: String,
    pub families: Vec<Family>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Family {
    pub id: String,
    pub name: String,
    pub designer: String,
    pub category: String,
    pub subsets: Vec<String>,
    pub license: String,
    pub license_path: String,
    pub license_text: String,
    pub styles: Vec<Style>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Style {
    pub id: String,
    pub path: String,
    pub git_oid: String,
    pub style: String,
    pub weight: u16,
    pub variable: bool,
}

#[derive(Clone, Debug)]
pub struct DownloadedFont {
    pub path: PathBuf,
    pub source: DownloadSource,
    pub family: Family,
    pub style: Style,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DownloadSource {
    Cache,
    Mirror,
    Official,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DownloadUse {
    Preview,
    Collect,
}

#[derive(Debug, thiserror::Error)]
pub enum OnlineError {
    #[error("没有找到所选字体或字款")]
    UnknownStyle,
    #[error("镜像地址必须是 HTTPS，并包含各一次 {{commit}} 和 {{path}} 占位符")]
    InvalidMirror,
    #[error("下载已取消")]
    Cancelled,
    #[error("下载文件过大")]
    TooLarge,
    #[error("下载文件与目录指纹不一致")]
    FingerprintMismatch,
    #[error("下载文件不是可用的字体")]
    InvalidFont,
    #[error("无法获取字体文件，请检查网络连接或下载地址")]
    Network(#[from] reqwest::Error),
    #[error("无法读写字体文件")]
    Io(#[from] std::io::Error),
}

pub fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        let catalog: Catalog = serde_json::from_str(CATALOG_DATA).expect("内置字体目录必须有效");
        assert_eq!(catalog.provider, "google-fonts");
        catalog
    })
}

pub fn query_families(
    text: &str,
    category: Option<&str>,
    subset: Option<&str>,
    offset: usize,
    limit: usize,
) -> (usize, Vec<Family>) {
    let needle = text.trim().to_lowercase();
    let found: Vec<_> = catalog()
        .families
        .iter()
        .filter(|family| {
            (needle.is_empty()
                || family.name.to_lowercase().contains(&needle)
                || family.designer.to_lowercase().contains(&needle))
                && category.is_none_or(|value| family.category == value)
                && subset.is_none_or(|value| family.subsets.iter().any(|item| item == value))
        })
        .collect();
    let total = found.len();
    let page = found
        .into_iter()
        .skip(offset)
        .take(limit.min(200))
        .cloned()
        .collect();
    (total, page)
}

pub fn family(id: &str) -> Option<&'static Family> {
    catalog().families.iter().find(|family| family.id == id)
}

pub fn validate_mirror(template: &str) -> Result<(), OnlineError> {
    if template.matches("{commit}").count() != 1 || template.matches("{path}").count() != 1 {
        return Err(OnlineError::InvalidMirror);
    }
    let sample = template
        .replace("{commit}", &catalog().commit)
        .replace("{path}", "ofl/lato/Lato-Regular.ttf");
    let url = Url::parse(&sample).map_err(|_| OnlineError::InvalidMirror)?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(OnlineError::InvalidMirror);
    }
    Ok(())
}

pub fn url_for(template: &str, style: &Style) -> Result<Url, OnlineError> {
    validate_mirror(template)?;
    let value = template
        .replace("{commit}", &catalog().commit)
        .replace("{path}", &style.path);
    Url::parse(&value).map_err(|_| OnlineError::InvalidMirror)
}

pub struct OnlineClient {
    client: Client,
    cache_dir: PathBuf,
    slots: Arc<Semaphore>,
}

impl OnlineClient {
    pub fn new(cache_dir: impl AsRef<Path>) -> Result<Self, OnlineError> {
        let cache_dir = cache_dir.as_ref().to_path_buf();
        fs::create_dir_all(cache_dir.join("previews"))?;
        fs::create_dir_all(cache_dir.join("downloads"))?;
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(180))
            .redirect(redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= 5 || attempt.url().scheme() != "https" {
                    attempt.stop()
                } else {
                    attempt.follow()
                }
            }))
            .build()?;
        Ok(Self {
            client,
            cache_dir,
            slots: Arc::new(Semaphore::new(3)),
        })
    }

    pub async fn download(
        &self,
        family_id: &str,
        style_id: &str,
        mirror: Option<&str>,
        use_for: DownloadUse,
        cancelled: &AtomicBool,
        report: impl Fn(u64, u64),
    ) -> Result<DownloadedFont, OnlineError> {
        let family = family(family_id).ok_or(OnlineError::UnknownStyle)?.clone();
        let style = family
            .styles
            .iter()
            .find(|style| style.id == style_id)
            .ok_or(OnlineError::UnknownStyle)?
            .clone();
        let _permit = self
            .slots
            .acquire()
            .await
            .map_err(|_| OnlineError::Cancelled)?;
        if cancelled.load(Ordering::Relaxed) {
            return Err(OnlineError::Cancelled);
        }
        let directory = match use_for {
            DownloadUse::Preview => self.cache_dir.join("previews"),
            DownloadUse::Collect => self.cache_dir.join("downloads"),
        };
        let extension = Path::new(&style.id)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("ttf");
        let destination = directory.join(format!("{}.{}", style.git_oid, extension));
        if destination.is_file() && verify_file(&destination, &style.git_oid)? {
            let file = File::options().read(true).open(&destination)?;
            let _ = file.set_modified(SystemTime::now());
            return Ok(DownloadedFont {
                path: destination,
                source: DownloadSource::Cache,
                family,
                style,
            });
        }
        let _ = fs::remove_file(&destination);
        let mut attempts = Vec::new();
        if let Some(template) = mirror {
            attempts.push((url_for(template, &style)?, DownloadSource::Mirror));
        }
        attempts.push((
            url_for(OFFICIAL_TEMPLATE, &style)?,
            DownloadSource::Official,
        ));
        let mut last_error = None;
        for (url, source) in attempts {
            if cancelled.load(Ordering::Relaxed) {
                return Err(OnlineError::Cancelled);
            }
            match self
                .fetch_one(&url, &destination, &style.git_oid, cancelled, &report)
                .await
            {
                Ok(()) => {
                    if use_for == DownloadUse::Preview {
                        self.trim_preview_cache()?;
                    }
                    return Ok(DownloadedFont {
                        path: destination,
                        source,
                        family,
                        style,
                    });
                }
                Err(OnlineError::Cancelled) => return Err(OnlineError::Cancelled),
                Err(error) => last_error = Some(error),
            }
        }
        Err(last_error.unwrap_or(OnlineError::InvalidFont))
    }

    pub async fn test_mirror(&self, template: &str) -> Result<(), OnlineError> {
        validate_mirror(template)?;
        let family = family("ofl/lato").ok_or(OnlineError::UnknownStyle)?;
        let style = family
            .styles
            .iter()
            .find(|style| style.id == "Lato-Regular.ttf")
            .ok_or(OnlineError::UnknownStyle)?;
        let url = url_for(template, style)?;
        let temporary = tempfile::tempdir_in(self.cache_dir.join("downloads"))?;
        let destination = temporary.path().join("mirror-test.ttf");
        let cancelled = AtomicBool::new(false);
        self.fetch_one(&url, &destination, &style.git_oid, &cancelled, &|_, _| {})
            .await
    }

    async fn fetch_one(
        &self,
        url: &Url,
        destination: &Path,
        git_oid: &str,
        cancelled: &AtomicBool,
        report: &impl Fn(u64, u64),
    ) -> Result<(), OnlineError> {
        let mut response = tokio::select! {
            result = self.client.get(url.clone()).send() => result?,
            () = wait_cancel(cancelled) => return Err(OnlineError::Cancelled),
        }
        .error_for_status()?;
        if response.url().scheme() != "https" {
            return Err(OnlineError::InvalidMirror);
        }
        let total = response.content_length().unwrap_or(0);
        if total > FILE_LIMIT {
            return Err(OnlineError::TooLarge);
        }
        let mut temporary =
            tempfile::NamedTempFile::new_in(destination.parent().ok_or(OnlineError::InvalidFont)?)?;
        let mut received = 0_u64;
        loop {
            let chunk = tokio::select! {
                result = response.chunk() => result?,
                () = wait_cancel(cancelled) => return Err(OnlineError::Cancelled),
            };
            let Some(chunk) = chunk else { break };
            if cancelled.load(Ordering::Relaxed) {
                return Err(OnlineError::Cancelled);
            }
            received += chunk.len() as u64;
            if received > FILE_LIMIT {
                return Err(OnlineError::TooLarge);
            }
            temporary.write_all(&chunk)?;
            report(received, total);
        }
        temporary.flush()?;
        if !verify_file(temporary.path(), git_oid)? {
            return Err(OnlineError::FingerprintMismatch);
        }
        let parsed =
            folio_core::parse_font_file(temporary.path()).map_err(|_| OnlineError::InvalidFont)?;
        if parsed.faces.is_empty() {
            return Err(OnlineError::InvalidFont);
        }
        temporary
            .persist(destination)
            .map_err(|error| OnlineError::Io(error.error))?;
        Ok(())
    }

    fn trim_preview_cache(&self) -> Result<(), OnlineError> {
        let directory = self.cache_dir.join("previews");
        let mut entries = Vec::new();
        let mut total = 0_u64;
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let metadata = entry.metadata()?;
            if metadata.is_file() {
                total += metadata.len();
                entries.push((
                    entry.path(),
                    metadata.len(),
                    metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                ));
            }
        }
        entries.sort_by_key(|entry| entry.2);
        for (path, size, _) in entries {
            if total <= CACHE_LIMIT {
                break;
            }
            fs::remove_file(path)?;
            total -= size;
        }
        Ok(())
    }
}

async fn wait_cancel(cancelled: &AtomicBool) {
    while !cancelled.load(Ordering::Relaxed) {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

pub fn verify_file(path: &Path, expected: &str) -> Result<bool, OnlineError> {
    let mut file = File::open(path)?;
    let length = file.metadata()?.len();
    if length > FILE_LIMIT {
        return Err(OnlineError::TooLarge);
    }
    let mut hash = Sha1::new();
    hash.update(format!("blob {length}\0").as_bytes());
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hash.finalize()) == expected)
}

pub fn local_statuses(
    paths: &[PathBuf],
    manifest: &Catalog,
) -> Result<HashMap<String, bool>, OnlineError> {
    let known: HashMap<_, _> = manifest
        .families
        .iter()
        .flat_map(|family| family.styles.iter())
        .map(|style| (style.git_oid.clone(), false))
        .collect();
    let mut found = known;
    for path in paths {
        if !path.is_file() {
            continue;
        }
        let mut file = File::open(path)?;
        let length = file.metadata()?.len();
        if length > FILE_LIMIT {
            continue;
        }
        let mut hash = Sha1::new();
        hash.update(format!("blob {length}\0").as_bytes());
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            hash.update(&buffer[..read]);
        }
        if let Some(value) = found.get_mut(&format!("{:x}", hash.finalize())) {
            *value = true;
        }
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn bundled_catalog_has_valid_sources_and_licenses() {
        let manifest = catalog();
        assert_eq!(manifest.commit.len(), 40);
        assert!(manifest.families.len() > 1_900);
        let mut ids = HashSet::new();
        for family in &manifest.families {
            assert!(ids.insert(&family.id));
            assert!(!family.styles.is_empty());
            assert!(!family.license_text.trim().is_empty());
            assert!(family.license_path.starts_with(&family.id));
            let mut styles = HashSet::new();
            for style in &family.styles {
                assert!(styles.insert(&style.id));
                assert!(style.path.starts_with(&family.id));
                assert_eq!(style.git_oid.len(), 40);
                assert!(style.git_oid.bytes().all(|byte| byte.is_ascii_hexdigit()));
            }
        }
    }

    #[test]
    fn query_and_mirror_template_are_stable() {
        let (total, page) = query_families("lato", None, None, 0, 20);
        assert!(total >= 1);
        assert!(page.iter().any(|family| family.id == "ofl/lato"));
        assert!(validate_mirror("https://cdn.example.org/{commit}/{path}").is_ok());
        assert!(validate_mirror("http://cdn.example.org/{commit}/{path}").is_err());
        assert!(validate_mirror("https://cdn.example.org/{path}").is_err());
        assert!(validate_mirror("https://user:password@cdn.example.org/{commit}/{path}").is_err());
        let style = &family("ofl/lato").unwrap().styles[0];
        let url = url_for(OFFICIAL_TEMPLATE, style).unwrap();
        assert!(url.as_str().contains(&catalog().commit));
        assert!(url.as_str().contains(&style.path));
    }

    #[test]
    fn local_statuses_match_git_blob_fingerprint() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sample.ttf");
        std::fs::write(&path, b"font bytes").unwrap();
        let mut hash = Sha1::new();
        hash.update(b"blob 10\0font bytes");
        let oid = format!("{:x}", hash.finalize());
        let manifest = Catalog {
            provider: "google-fonts".to_owned(),
            commit: "a".repeat(40),
            families: vec![Family {
                id: "ofl/example".to_owned(),
                name: "Example".to_owned(),
                designer: String::new(),
                category: String::new(),
                subsets: vec![],
                license: "OFL".to_owned(),
                license_path: "ofl/example/OFL.txt".to_owned(),
                license_text: "License".to_owned(),
                styles: vec![Style {
                    id: "sample.ttf".to_owned(),
                    path: "ofl/example/sample.ttf".to_owned(),
                    git_oid: oid.clone(),
                    style: "Regular".to_owned(),
                    weight: 400,
                    variable: false,
                }],
            }],
        };
        assert!(local_statuses(&[path], &manifest).unwrap()[&oid]);
    }

    #[test]
    fn preview_cache_removes_oldest_file_when_over_limit() {
        let directory = tempfile::tempdir().unwrap();
        let client = OnlineClient::new(directory.path()).unwrap();
        let older = directory.path().join("previews/older.ttf");
        let newer = directory.path().join("previews/newer.ttf");
        let first = File::create(&older).unwrap();
        first.set_len(300 * 1024 * 1024).unwrap();
        first
            .set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(10))
            .unwrap();
        let second = File::create(&newer).unwrap();
        second.set_len(300 * 1024 * 1024).unwrap();
        second
            .set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(20))
            .unwrap();
        client.trim_preview_cache().unwrap();
        assert!(!older.exists());
        assert!(newer.exists());
    }

    #[tokio::test]
    async fn cancellation_stops_before_network_request() {
        let directory = tempfile::tempdir().unwrap();
        let client = OnlineClient::new(directory.path()).unwrap();
        let cancelled = AtomicBool::new(true);
        let result = client
            .download(
                "ofl/lato",
                "Lato-Regular.ttf",
                None,
                DownloadUse::Preview,
                &cancelled,
                |_, _| {},
            )
            .await;
        assert!(matches!(result, Err(OnlineError::Cancelled)));
    }

    #[tokio::test]
    #[ignore = "需要访问 Google Fonts 官方文件地址"]
    async fn official_download_and_mirror_fallback() {
        let cache = tempfile::tempdir().unwrap();
        let client = OnlineClient::new(cache.path()).unwrap();
        let cancelled = AtomicBool::new(false);
        let downloaded = client
            .download(
                "ofl/lato",
                "Lato-Regular.ttf",
                Some("https://example.org/missing/{commit}/{path}"),
                DownloadUse::Preview,
                &cancelled,
                |_, _| {},
            )
            .await
            .unwrap();
        assert_eq!(downloaded.source, DownloadSource::Official);
        assert!(verify_file(&downloaded.path, &downloaded.style.git_oid).unwrap());
    }

    #[tokio::test]
    #[ignore = "需要访问 Google Fonts 官方文件地址"]
    async fn chinese_variable_font_download() {
        let cache = tempfile::tempdir().unwrap();
        let client = OnlineClient::new(cache.path()).unwrap();
        let cancelled = AtomicBool::new(false);
        let downloaded = client
            .download(
                "ofl/notosanssc",
                "NotoSansSC[wght].ttf",
                None,
                DownloadUse::Preview,
                &cancelled,
                |_, _| {},
            )
            .await
            .unwrap();
        assert!(downloaded.style.variable);
        assert!(downloaded
            .family
            .subsets
            .contains(&"chinese-simplified".to_owned()));
        assert!(verify_file(&downloaded.path, &downloaded.style.git_oid).unwrap());
    }

    #[tokio::test]
    #[ignore = "需要访问镜像测试站与 Google Fonts 官方地址"]
    async fn wrong_mirror_content_uses_official_file() {
        let cache = tempfile::tempdir().unwrap();
        let client = OnlineClient::new(cache.path()).unwrap();
        let cancelled = AtomicBool::new(false);
        let downloaded = client
            .download(
                "ofl/lato",
                "Lato-Regular.ttf",
                Some("https://example.org/?commit={commit}&path={path}"),
                DownloadUse::Preview,
                &cancelled,
                |_, _| {},
            )
            .await
            .unwrap();
        assert_eq!(downloaded.source, DownloadSource::Official);
    }
}
