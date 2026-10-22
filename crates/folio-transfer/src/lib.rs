//! 可恢复的本机传输记录与原生下载交接。

#![forbid(unsafe_code)]

use folio_online::browser::{public_https, public_ip, redacted_url};
use folio_storage::{new_operation_id, FolioDatabase};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

type Result<T> = std::result::Result<T, TransferError>;
pub const FONT_LIMIT: u64 = 512 * 1024 * 1024;
pub const ARCHIVE_LIMIT: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum TransferError {
    #[error("online.browser.storageError")]
    Storage(#[from] folio_storage::StorageError),
    #[error("online.browser.storageError")]
    Json(#[from] serde_json::Error),
    #[error("online.browser.fileError")]
    Io(#[from] std::io::Error),
    #[error("online.browser.invalidDownload")]
    InvalidDownload,
    #[error("online.browser.networkError")]
    Network(#[from] reqwest::Error),
    #[error("online.browser.busy")]
    Busy,
}

pub use folio_core::OnlineFontOrigin as OnlineOrigin;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferJob {
    pub id: String,
    pub name: String,
    pub state: String,
    pub bytes_done: u64,
    pub bytes_total: Option<u64>,
    pub kind: Option<String>,
    pub origin: OnlineOrigin,
    pub content_hash: Option<String>,
    pub error_key: Option<String>,
    pub created_at: u64,
    #[serde(default)]
    pub resume_validator: Option<String>,
    #[serde(default)]
    pub generation: u64,
}

pub struct TransferService {
    database: PathBuf,
    directory: PathBuf,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveFont {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: u64,
}

impl TransferService {
    pub fn open(database: impl AsRef<Path>, directory: impl AsRef<Path>) -> Result<Self> {
        FolioDatabase::open(database.as_ref())?;
        fs::create_dir_all(directory.as_ref())?;
        Ok(Self {
            database: database.as_ref().into(),
            directory: directory.as_ref().canonicalize()?,
        })
    }
    pub fn list(&self) -> Result<Vec<TransferJob>> {
        FolioDatabase::open(&self.database)?
            .transfer_records()?
            .into_iter()
            .map(|(value, _)| serde_json::from_str(&value).map_err(Into::into))
            .collect()
    }
    pub fn job(&self, id: &str) -> Result<TransferJob> {
        let (value, _) = FolioDatabase::open(&self.database)?
            .transfer_record(id)?
            .ok_or(TransferError::InvalidDownload)?;
        Ok(serde_json::from_str(&value)?)
    }
    fn update(
        &self,
        id: &str,
        edit: impl Fn(&mut TransferJob) -> Result<()>,
    ) -> Result<TransferJob> {
        let db = FolioDatabase::open(&self.database)?;
        for _ in 0..8 {
            let (value, revision) = db
                .transfer_record(id)?
                .ok_or(TransferError::InvalidDownload)?;
            let mut job: TransferJob = serde_json::from_str(&value)?;
            edit(&mut job)?;
            if db.update_transfer_record(id, revision, &serde_json::to_string(&job)?)? {
                return Ok(job);
            }
        }
        Err(TransferError::Busy)
    }
    pub fn create(&self, url: &str, name: &str, mut origin: OnlineOrigin) -> Result<TransferJob> {
        let url = public_https(url).map_err(|_| TransferError::InvalidDownload)?;
        origin.source_page_url =
            redacted_url(&origin.source_page_url).map_err(|_| TransferError::InvalidDownload)?;
        origin.download_host = url.host_str().unwrap_or_default().to_string();
        if origin.provider_name.len() > 240
            || origin.provider_id.as_ref().is_some_and(|id| id.len() > 100)
        {
            return Err(TransferError::InvalidDownload);
        }
        let job = TransferJob {
            id: new_operation_id()?,
            name: safe_name(name),
            state: "queued".into(),
            bytes_done: 0,
            bytes_total: None,
            kind: None,
            origin,
            content_hash: None,
            error_key: None,
            created_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            resume_validator: None,
            generation: 0,
        };
        fs::create_dir_all(self.directory.join(&job.id))?;
        FolioDatabase::open(&self.database)?
            .insert_transfer_record(&job.id, &serde_json::to_string(&job)?)?;
        Ok(job)
    }
    pub fn progress(&self, id: &str, done: u64, total: Option<u64>) -> Result<TransferJob> {
        self.progress_for_attempt(id, done, total, self.job(id)?.generation)
    }
    pub fn progress_for_attempt(
        &self,
        id: &str,
        done: u64,
        total: Option<u64>,
        generation: u64,
    ) -> Result<TransferJob> {
        self.update(id, |job| {
            if !["queued", "transferring"].contains(&job.state.as_str()) {
                return Err(TransferError::InvalidDownload);
            }
            if job.generation != generation {
                return Err(TransferError::Busy);
            }
            if done > ARCHIVE_LIMIT || total.is_some_and(|value| value > ARCHIVE_LIMIT) {
                return Err(TransferError::InvalidDownload);
            }
            job.state = "transferring".into();
            job.bytes_done = done;
            job.bytes_total = total;
            Ok(())
        })
    }
    pub fn state(&self, id: &str, state: &str, error: Option<String>) -> Result<TransferJob> {
        self.state_for_attempt(id, state, error, self.job(id)?.generation)
    }
    pub fn state_for_attempt(
        &self,
        id: &str,
        state: &str,
        error: Option<String>,
        generation: u64,
    ) -> Result<TransferJob> {
        self.update(id, |job| {
            if job.generation != generation {
                return Err(TransferError::Busy);
            }
            let allowed = match state {
                "paused" => ["queued", "transferring"].contains(&job.state.as_str()),
                "cancelled" => [
                    "queued",
                    "transferring",
                    "paused",
                    "failed",
                    "needsUser",
                    "ready",
                    "completed",
                    "cancelled",
                ]
                .contains(&job.state.as_str()),
                "queued" => ["paused", "failed", "needsUser"].contains(&job.state.as_str()),
                "failed" | "needsUser" => {
                    ["queued", "transferring", "paused"].contains(&job.state.as_str())
                }
                "completed" => job.state == "ready",
                _ => false,
            };
            if !allowed {
                return Err(TransferError::InvalidDownload);
            }
            if state == "queued" {
                job.generation = job
                    .generation
                    .checked_add(1)
                    .ok_or(TransferError::InvalidDownload)?;
            }
            job.state = state.into();
            job.error_key = error.clone();
            Ok(())
        })
    }
    pub fn path(&self, id: &str) -> Result<PathBuf> {
        self.job(id)?;
        if id.is_empty() || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') {
            return Err(TransferError::InvalidDownload);
        }
        Ok(self.directory.join(id).join("payload"))
    }
    pub fn finish(&self, id: &str) -> Result<TransferJob> {
        self.finish_for_attempt(id, self.job(id)?.generation)
    }
    pub fn finish_for_attempt(&self, id: &str, generation: u64) -> Result<TransferJob> {
        let path = self.path(id)?;
        if !["queued", "transferring"].contains(&self.job(id)?.state.as_str()) {
            return Err(TransferError::InvalidDownload);
        }
        if !path.canonicalize()?.starts_with(self.directory.join(id)) || !path.is_file() {
            return Err(TransferError::InvalidDownload);
        }
        if self.job(id)?.generation != generation {
            return Err(TransferError::Busy);
        }
        let size = fs::metadata(&path)?.len();
        if size == 0 || size > ARCHIVE_LIMIT {
            return Err(TransferError::InvalidDownload);
        }
        let mut file = fs::File::open(&path)?;
        let mut header = [0; 4];
        file.read_exact(&mut header)?;
        let kind = if header == *b"PK\x03\x04" || header == *b"PK\x05\x06" {
            "archive"
        } else if size <= FONT_LIMIT
            && folio_core::parse_font_file(&path).is_ok_and(|font| !font.faces.is_empty())
        {
            "font"
        } else {
            return Err(TransferError::InvalidDownload);
        };
        let mut hash = blake3::Hasher::new();
        let mut buffer = [0; 65536];
        let mut file = fs::File::open(&path)?;
        loop {
            let n = file.read(&mut buffer)?;
            if n == 0 {
                break;
            }
            hash.update(&buffer[..n]);
        }
        let hash = hash.finalize().to_hex().to_string();
        let extension = if kind == "archive" {
            "zip"
        } else if header == *b"OTTO" {
            "otf"
        } else if header == *b"ttcf" {
            "ttc"
        } else {
            "ttf"
        };
        self.update(id, |job| {
            if !["queued", "transferring"].contains(&job.state.as_str()) {
                return Err(TransferError::InvalidDownload);
            }
            if job.generation != generation {
                return Err(TransferError::Busy);
            }
            job.kind = Some(kind.into());
            let current = Path::new(&job.name)
                .extension()
                .and_then(|v| v.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if current != extension && !(extension == "ttc" && current == "otc") {
                let stem = Path::new(&job.name)
                    .file_stem()
                    .and_then(|v| v.to_str())
                    .unwrap_or("download");
                job.name = format!("{stem}.{extension}");
            }
            job.state = "ready".into();
            job.bytes_done = size;
            job.bytes_total = Some(size);
            job.content_hash = Some(hash.clone());
            job.error_key = None;
            Ok(())
        })
    }
    pub fn discard(&self, id: &str) -> Result<()> {
        let path = self
            .path(id)?
            .parent()
            .ok_or(TransferError::InvalidDownload)?
            .to_path_buf();
        self.state(id, "cancelled", None)?;
        if path.exists() {
            fs::remove_dir_all(path)?;
        }
        Ok(())
    }
    pub fn record_origin(&self, id: &str, fingerprint: &str) -> Result<()> {
        let job = self.job(id)?;
        if !["ready", "completed"].contains(&job.state.as_str())
            || fingerprint.len() != 64
            || !fingerprint.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err(TransferError::InvalidDownload);
        }
        FolioDatabase::open(&self.database)?.save_online_origin(
            fingerprint,
            id,
            &serde_json::to_string(&job.origin)?,
        )?;
        Ok(())
    }

    pub fn inspect_archive(&self, id: &str) -> Result<Vec<ArchiveFont>> {
        let job = self.job(id)?;
        if job.state != "ready" || job.kind.as_deref() != Some("archive") {
            return Err(TransferError::InvalidDownload);
        }
        let mut archive = zip::ZipArchive::new(fs::File::open(self.path(id)?)?)
            .map_err(|_| TransferError::InvalidDownload)?;
        if archive.len() > 10_000 {
            return Err(TransferError::InvalidDownload);
        }
        let mut total = 0u64;
        for index in 0..archive.len() {
            let entry = archive
                .by_index(index)
                .map_err(|_| TransferError::InvalidDownload)?;
            let name = entry.name();
            if entry.enclosed_name().is_none()
                || name.contains('\\')
                || name.contains(':')
                || name.split('/').any(|v| v == "..")
                || name.split('/').count() > 16
                || entry.unix_mode().is_some_and(|v| {
                    v & 0o170000 != 0 && v & 0o170000 != 0o100000 && v & 0o170000 != 0o040000
                })
                || entry.size() > FONT_LIMIT
                || entry.size() > entry.compressed_size().max(1).saturating_mul(200)
            {
                return Err(TransferError::InvalidDownload);
            }
            total = total
                .checked_add(entry.size())
                .ok_or(TransferError::InvalidDownload)?;
            if total > ARCHIVE_LIMIT {
                return Err(TransferError::InvalidDownload);
            }
        }
        let directory = self
            .path(id)?
            .parent()
            .ok_or(TransferError::InvalidDownload)?
            .join("entries");
        fs::create_dir_all(&directory)?;
        let mut fonts = Vec::new();
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|_| TransferError::InvalidDownload)?;
            let name = entry.name().to_string();
            let extension = Path::new(&name)
                .extension()
                .and_then(|v| v.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if !["ttf", "otf", "ttc", "otc"].contains(&extension.as_str()) || entry.is_dir() {
                continue;
            }
            let path = directory.join(format!("{index}.{extension}"));
            let mut output = fs::File::create(&path)?;
            let size = std::io::copy(&mut (&mut entry).take(FONT_LIMIT + 1), &mut output)?;
            if size > FONT_LIMIT || size != entry.size() {
                let _ = fs::remove_file(path);
                return Err(TransferError::InvalidDownload);
            }
            fonts.push(ArchiveFont {
                id: index.to_string(),
                name,
                path: path.to_string_lossy().into_owned(),
                size,
            });
        }
        Ok(fonts)
    }

    async fn wait_for_stop(&self, id: &str, generation: u64) {
        loop {
            if !self.job(id).is_ok_and(|job| {
                ["queued", "transferring"].contains(&job.state.as_str())
                    && job.generation == generation
            }) {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }

    pub async fn download(&self, id: &str, url: &str, headers: &str) -> Result<()> {
        let _guard =
            folio_storage::ResourceGuard::acquire(&self.database, &format!("online:{id}"), true)
                .map_err(|_| TransferError::Busy)?;
        if !["queued", "transferring"].contains(&self.job(id)?.state.as_str()) {
            return Err(TransferError::Busy);
        }
        let mut url = public_https(url).map_err(|_| TransferError::InvalidDownload)?;
        let headers: std::collections::BTreeMap<String, String> = serde_json::from_str(headers)?;
        let previous = self.job(id)?;
        let generation = previous.generation;
        let path = self.path(id)?;
        let offset = if previous.resume_validator.is_some() {
            fs::metadata(&path).map(|v| v.len()).unwrap_or(0)
        } else {
            0
        };
        if offset > ARCHIVE_LIMIT {
            return Err(TransferError::InvalidDownload);
        }
        self.progress_for_attempt(id, offset, None, generation)?;
        let initial_origin = url.origin();
        let mut response = None;
        for _ in 0..=5 {
            let host = url.host_str().ok_or(TransferError::InvalidDownload)?;
            let port = url.port_or_known_default().unwrap_or(443);
            let addresses: Vec<_> = tokio::net::lookup_host((host, port)).await?.collect();
            if addresses.is_empty() || addresses.iter().any(|v| !public_ip(v.ip())) {
                return Err(TransferError::InvalidDownload);
            }
            let client = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(std::time::Duration::from_secs(20))
                .timeout(std::time::Duration::from_secs(1800))
                .no_proxy()
                .resolve_to_addrs(host, &addresses)
                .build()?;
            let mut request = client
                .get(url.clone())
                .header("Accept-Encoding", "identity");
            if offset > 0 {
                request = request.header("Range", format!("bytes={offset}-")).header(
                    "If-Range",
                    previous.resume_validator.as_deref().unwrap_or_default(),
                );
            }
            if url.origin() == initial_origin {
                for (key, value) in &headers {
                    if ["cookie", "referer", "user-agent", "origin"]
                        .contains(&key.to_ascii_lowercase().as_str())
                    {
                        request = request.header(key, value);
                    }
                }
            }
            let next = tokio::select! {
                response=request.send()=>response?,
                _=self.wait_for_stop(id, generation)=>return Ok(()),
            };
            if next.status().is_redirection() {
                let target = next
                    .headers()
                    .get("Location")
                    .and_then(|v| v.to_str().ok())
                    .ok_or(TransferError::InvalidDownload)?;
                let next_url = url
                    .join(target)
                    .map_err(|_| TransferError::InvalidDownload)?;
                url =
                    public_https(next_url.as_str()).map_err(|_| TransferError::InvalidDownload)?;
                continue;
            }
            if next.status().as_u16() == 401 || next.status().as_u16() == 403 {
                self.state_for_attempt(
                    id,
                    "needsUser",
                    Some("online.browser.expiredLink".into()),
                    generation,
                )?;
                return Ok(());
            }
            response = Some(next.error_for_status()?);
            break;
        }
        let mut response = response.ok_or(TransferError::InvalidDownload)?;
        let validator = response
            .headers()
            .get("ETag")
            .and_then(|v| v.to_str().ok())
            .filter(|v| v.starts_with('"') && v.ends_with('"') && v.len() <= 1024)
            .map(str::to_owned);
        let (mut done, total) = if response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
            if offset == 0 || validator != previous.resume_validator {
                return Err(TransferError::InvalidDownload);
            }
            let total = range_total(
                response
                    .headers()
                    .get("Content-Range")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or_default(),
                offset,
            )?;
            (offset, Some(total))
        } else {
            (0, response.content_length())
        };
        self.progress_for_attempt(id, done, total, generation)?;
        self.update(id, |job| {
            if job.state != "transferring" {
                return Err(TransferError::InvalidDownload);
            }
            if job.generation != generation {
                return Err(TransferError::Busy);
            }
            job.resume_validator = validator.clone();
            Ok(())
        })?;
        let mut file = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(done == 0)
            .append(done > 0)
            .open(path)?;
        let mut last = std::time::Instant::now();
        loop {
            let chunk = tokio::select! {
                chunk=response.chunk()=>chunk?,
                _=self.wait_for_stop(id, generation)=>return Ok(()),
            };
            let Some(chunk) = chunk else {
                break;
            };
            if self.job(id)?.state != "transferring" || self.job(id)?.generation != generation {
                return Ok(());
            }
            done += chunk.len() as u64;
            if done > ARCHIVE_LIMIT {
                return Err(TransferError::InvalidDownload);
            }
            file.write_all(&chunk)?;
            if last.elapsed().as_millis() > 500 {
                self.progress_for_attempt(id, done, total, generation)?;
                last = std::time::Instant::now();
            }
        }
        file.sync_all()?;
        if total.is_some_and(|value| value != done) {
            return Err(TransferError::InvalidDownload);
        }
        self.finish_for_attempt(id, generation)?;
        Ok(())
    }
}

fn range_total(value: &str, offset: u64) -> Result<u64> {
    let value = value
        .strip_prefix("bytes ")
        .ok_or(TransferError::InvalidDownload)?;
    let (range, total) = value
        .split_once('/')
        .ok_or(TransferError::InvalidDownload)?;
    let (start, end) = range
        .split_once('-')
        .ok_or(TransferError::InvalidDownload)?;
    let (start, end, total): (u64, u64, u64) = (
        start.parse().map_err(|_| TransferError::InvalidDownload)?,
        end.parse().map_err(|_| TransferError::InvalidDownload)?,
        total.parse().map_err(|_| TransferError::InvalidDownload)?,
    );
    if start != offset || start > end || end.checked_add(1) != Some(total) || total > ARCHIVE_LIMIT
    {
        return Err(TransferError::InvalidDownload);
    }
    Ok(total)
}

pub fn safe_name(value: &str) -> String {
    let mut bytes = 0;
    let name = value
        .chars()
        .filter(|c| !c.is_control() && !['/', '\\', ':', '*', '?', '"', '<', '>', '|'].contains(c))
        .take_while(|character| {
            bytes += character.len_utf8();
            bytes <= 180
        })
        .collect::<String>();
    let name = name.trim_matches([' ', '.']);
    if name.is_empty() {
        "download".into()
    } else {
        name.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resumed_content_must_cover_exactly_the_remaining_bytes() {
        assert_eq!(range_total("bytes 20-99/100", 20).unwrap(), 100);
        for value in [
            "bytes 0-99/100",
            "bytes 20-40/100",
            "bytes 20-100/100",
            "bytes 20-99/*",
            "bytes 20-1/100",
        ] {
            assert!(range_total(value, 20).is_err(), "{value}");
        }
    }
}
