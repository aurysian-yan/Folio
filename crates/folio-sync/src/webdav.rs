//! WebDAV 请求、目录发现与 XML 响应解析。

use std::time::Duration;

use quick_xml::events::Event;
use quick_xml::Reader;
use reqwest::{Method, StatusCode, Url};

use crate::{SyncError, SyncProfile};

pub(crate) struct WebDavClient {
    http: reqwest::Client,
    server: Url,
    base: Url,
    username: String,
    password: String,
}

impl WebDavClient {
    pub(crate) fn new(profile: &SyncProfile, password: &str) -> Result<Self, SyncError> {
        let mut server =
            Url::parse(&profile.server_url).map_err(|_| SyncError::InvalidServerUrl)?;
        if server.scheme() != "https"
            || server.host_str().is_none()
            || !server.username().is_empty()
        {
            return Err(SyncError::InvalidServerUrl);
        }
        server.set_query(None);
        server.set_fragment(None);
        if !server.path().ends_with('/') {
            server
                .path_segments_mut()
                .map_err(|_| SyncError::InvalidServerUrl)?
                .push("");
        }
        let mut base = server.clone();
        for segment in profile.remote_directory.split('/') {
            if segment.is_empty() {
                continue;
            }
            if segment == "." || segment == ".." || segment.contains('\\') {
                return Err(SyncError::InvalidRemoteDirectory);
            }
            base.path_segments_mut()
                .map_err(|_| SyncError::InvalidServerUrl)?
                .pop_if_empty()
                .push(segment);
        }
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(90))
            .connect_timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self {
            http,
            server,
            base,
            username: profile.username.clone(),
            password: password.to_owned(),
        })
    }

    fn url(&self, segments: &[&str]) -> Result<Url, SyncError> {
        let mut url = self.base.clone();
        {
            let mut path = url
                .path_segments_mut()
                .map_err(|_| SyncError::InvalidServerUrl)?;
            path.pop_if_empty();
            for segment in segments {
                if segment.is_empty()
                    || *segment == "."
                    || *segment == ".."
                    || segment.contains('/')
                {
                    return Err(SyncError::InvalidRemoteDirectory);
                }
                path.push(segment);
            }
        }
        Ok(url)
    }

    fn request(
        &self,
        method: Method,
        segments: &[&str],
    ) -> Result<reqwest::RequestBuilder, SyncError> {
        Ok(self
            .http
            .request(method, self.url(segments)?)
            .basic_auth(&self.username, Some(&self.password)))
    }

    pub(crate) async fn test_connection(&self) -> Result<(), SyncError> {
        let response = self
            .http
            .request(
                Method::from_bytes(b"PROPFIND").expect("fixed method"),
                self.server.clone(),
            )
            .basic_auth(&self.username, Some(&self.password))
            .header("Depth", "0")
            .body("<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:allprop/></d:propfind>")
            .send()
            .await?;
        check_status(response.status())?;
        Ok(())
    }

    pub(crate) async fn ensure_root(&self, remote_directory: &str) -> Result<(), SyncError> {
        let mut url = self.server.clone();
        for segment in remote_directory
            .split('/')
            .filter(|segment| !segment.is_empty())
        {
            url.path_segments_mut()
                .map_err(|_| SyncError::InvalidServerUrl)?
                .pop_if_empty()
                .push(segment);
            let response = self
                .http
                .request(
                    Method::from_bytes(b"MKCOL").expect("fixed method"),
                    url.clone(),
                )
                .basic_auth(&self.username, Some(&self.password))
                .send()
                .await?;
            if !response.status().is_success()
                && response.status() != StatusCode::METHOD_NOT_ALLOWED
            {
                return Err(status_error(response.status()));
            }
        }
        Ok(())
    }

    pub(crate) async fn ensure_directory(&self, segments: &[&str]) -> Result<(), SyncError> {
        for length in 0..=segments.len() {
            let response = self
                .request(
                    Method::from_bytes(b"MKCOL").expect("fixed method"),
                    &segments[..length],
                )?
                .send()
                .await?;
            if response.status().is_success()
                || response.status() == StatusCode::METHOD_NOT_ALLOWED
                || response.status() == StatusCode::CONFLICT && length == 0
            {
                continue;
            }
            return Err(status_error(response.status()));
        }
        Ok(())
    }

    pub(crate) async fn list(&self, segments: &[&str]) -> Result<Vec<String>, SyncError> {
        let mut directory = self.url(segments)?;
        if !directory.path().ends_with('/') {
            directory.set_path(&format!("{}/", directory.path()));
        }
        let response = self
            .http
            .request(Method::from_bytes(b"PROPFIND").expect("fixed method"), directory.clone())
            .basic_auth(&self.username, Some(&self.password))
            .header("Depth", "1")
            .body("<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:resourcetype/></d:prop></d:propfind>")
            .send()
            .await?;
        check_status(response.status())?;
        let bytes = response.bytes().await?;
        let mut reader = Reader::from_reader(bytes.as_ref());
        let mut hrefs = Vec::new();
        let mut in_href = false;
        loop {
            match reader
                .read_event()
                .map_err(|_| SyncError::InvalidDavResponse)?
            {
                Event::Start(start) if start.local_name().as_ref() == "href" => in_href = true,
                Event::Text(value) if in_href => {
                    let normalized = value.xml10_content();
                    let href = quick_xml::escape::unescape(&normalized)
                        .map_err(|_| SyncError::InvalidDavResponse)?;
                    hrefs.push(href.into_owned());
                }
                Event::End(end) if end.local_name().as_ref() == "href" => in_href = false,
                Event::Eof => break,
                _ => {}
            }
        }
        let mut names = Vec::new();
        for href in hrefs {
            let parsed = directory
                .join(&href)
                .map_err(|_| SyncError::InvalidDavResponse)?;
            if parsed.origin() != directory.origin() {
                return Err(SyncError::InvalidDavResponse);
            }
            let path = parsed.path().trim_end_matches('/');
            let parent = directory.path().trim_end_matches('/');
            if path == parent {
                continue;
            }
            if !path.starts_with(directory.path()) {
                return Err(SyncError::InvalidDavResponse);
            }
            let name = path
                .rsplit('/')
                .next()
                .ok_or(SyncError::InvalidDavResponse)?;
            if name.is_empty() || name.contains('%') {
                return Err(SyncError::InvalidDavResponse);
            }
            names.push(name.to_owned());
        }
        names.sort();
        names.dedup();
        Ok(names)
    }

    pub(crate) async fn get(&self, segments: &[&str]) -> Result<Vec<u8>, SyncError> {
        let response = self.request(Method::GET, segments)?.send().await?;
        check_status(response.status())?;
        Ok(response.bytes().await?.to_vec())
    }

    pub(crate) async fn put(&self, segments: &[&str], body: Vec<u8>) -> Result<(), SyncError> {
        let response = self
            .request(Method::PUT, segments)?
            .header("If-None-Match", "*")
            .body(body.clone())
            .send()
            .await?;
        if response.status() == StatusCode::PRECONDITION_FAILED {
            if self.get(segments).await? == body {
                return Ok(());
            }
            return Err(SyncError::InvalidDavResponse);
        }
        check_status(response.status())
    }

    pub(crate) async fn exists(&self, segments: &[&str]) -> Result<bool, SyncError> {
        let response = self
            .request(
                Method::from_bytes(b"PROPFIND").expect("fixed method"),
                segments,
            )?
            .header("Depth", "0")
            .send()
            .await?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(false);
        }
        check_status(response.status())?;
        Ok(true)
    }
}

fn check_status(status: StatusCode) -> Result<(), SyncError> {
    if status.is_success() {
        Ok(())
    } else {
        Err(status_error(status))
    }
}

fn status_error(status: StatusCode) -> SyncError {
    match status {
        StatusCode::UNAUTHORIZED => SyncError::Authentication,
        StatusCode::FORBIDDEN => SyncError::PermissionDenied,
        StatusCode::INSUFFICIENT_STORAGE => SyncError::RemoteStorageFull,
        _ => SyncError::HttpStatus(status.as_u16()),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    use super::*;

    #[derive(Default)]
    struct DavState {
        directories: BTreeSet<String>,
        files: BTreeMap<String, Vec<u8>>,
        full: bool,
        malformed: bool,
        interrupt_next_get: bool,
    }

    struct DavServer {
        url: String,
        state: Arc<Mutex<DavState>>,
        stopped: Arc<AtomicBool>,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl DavServer {
        fn start() -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let url = format!("http://{}/dav", listener.local_addr().unwrap());
            let state = Arc::new(Mutex::new(DavState {
                directories: ["/dav".to_owned()].into_iter().collect(),
                ..DavState::default()
            }));
            let stopped = Arc::new(AtomicBool::new(false));
            let state_for_thread = state.clone();
            let stopped_for_thread = stopped.clone();
            let thread = std::thread::spawn(move || {
                while !stopped_for_thread.load(Ordering::Relaxed) {
                    match listener.accept() {
                        Ok((stream, _)) => serve(stream, &state_for_thread),
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            std::thread::sleep(Duration::from_millis(5));
                        }
                        Err(_) => break,
                    }
                }
            });
            Self {
                url,
                state,
                stopped,
                thread: Some(thread),
            }
        }

        fn client(&self, password: &str) -> WebDavClient {
            let server = Url::parse(&self.url).unwrap();
            WebDavClient {
                http: reqwest::Client::builder()
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .unwrap(),
                server: server.clone(),
                base: server,
                username: "u".to_owned(),
                password: password.to_owned(),
            }
        }
    }

    impl Drop for DavServer {
        fn drop(&mut self) {
            self.stopped.store(true, Ordering::Relaxed);
            if let Some(thread) = self.thread.take() {
                thread.join().unwrap();
            }
        }
    }

    fn serve(mut stream: TcpStream, state: &Arc<Mutex<DavState>>) {
        stream.set_nonblocking(false).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut request = Vec::new();
        let header_end = loop {
            let mut chunk = [0; 4096];
            let Ok(count) = stream.read(&mut chunk) else {
                return;
            };
            if count == 0 {
                return;
            }
            request.extend_from_slice(&chunk[..count]);
            if let Some(offset) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                break offset + 4;
            }
        };
        let headers = String::from_utf8_lossy(&request[..header_end]).into_owned();
        let first = headers.lines().next().unwrap_or_default();
        let mut fields = first.split_whitespace();
        let method = fields.next().unwrap_or_default();
        let path = fields.next().unwrap_or_default().trim_end_matches('/');
        let length = headers
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length:")
                    .and_then(|value| value.trim().parse::<usize>().ok())
            })
            .unwrap_or(0);
        while request.len() - header_end < length {
            let mut chunk = [0; 4096];
            let Ok(count) = stream.read(&mut chunk) else {
                return;
            };
            if count == 0 {
                return;
            }
            request.extend_from_slice(&chunk[..count]);
        }
        let authorized = headers
            .lines()
            .any(|line| line.eq_ignore_ascii_case("authorization: Basic dTpw"));
        let mut state = state.lock().unwrap();
        if method == "GET" && state.interrupt_next_get {
            state.interrupt_next_get = false;
            return;
        }
        let (status, body) = if !authorized {
            (401, Vec::new())
        } else {
            match method {
                "PROPFIND" if state.malformed => (207, b"<broken".to_vec()),
                "PROPFIND"
                    if state.directories.contains(path) || state.files.contains_key(path) =>
                {
                    let depth_one = headers
                        .lines()
                        .any(|line| line.eq_ignore_ascii_case("depth: 1"));
                    let mut entries = vec![path.to_owned()];
                    if depth_one {
                        let prefix = format!("{path}/");
                        entries.extend(
                            state
                                .directories
                                .iter()
                                .chain(state.files.keys())
                                .filter(|item| {
                                    item.starts_with(&prefix) && !item[prefix.len()..].contains('/')
                                })
                                .cloned(),
                        );
                    }
                    let body = format!(
                        "<d:multistatus xmlns:d=\"DAV:\">{}</d:multistatus>",
                        entries
                            .iter()
                            .map(|item| format!("<d:response><d:href>{item}</d:href></d:response>"))
                            .collect::<String>()
                    );
                    (207, body.into_bytes())
                }
                "PROPFIND" => (404, Vec::new()),
                "MKCOL" if state.directories.contains(path) => (405, Vec::new()),
                "MKCOL" => {
                    let parent = path
                        .rsplit_once('/')
                        .map(|value| value.0)
                        .unwrap_or_default();
                    if state.directories.contains(parent) {
                        state.directories.insert(path.to_owned());
                        (201, Vec::new())
                    } else {
                        (409, Vec::new())
                    }
                }
                "PUT" if state.full => (507, Vec::new()),
                "PUT" if state.files.contains_key(path) => (412, Vec::new()),
                "PUT" => {
                    state.files.insert(
                        path.to_owned(),
                        request[header_end..header_end + length].to_vec(),
                    );
                    (201, Vec::new())
                }
                "GET" => state
                    .files
                    .get(path)
                    .map_or((404, Vec::new()), |bytes| (200, bytes.clone())),
                _ => (405, Vec::new()),
            }
        };
        let message = match status {
            200 => "OK",
            201 => "Created",
            207 => "Multi-Status",
            401 => "Unauthorized",
            404 => "Not Found",
            405 => "Method Not Allowed",
            409 => "Conflict",
            412 => "Precondition Failed",
            507 => "Insufficient Storage",
            _ => "Error",
        };
        let header = format!(
            "HTTP/1.1 {status} {message}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(header.as_bytes()).unwrap();
        stream.write_all(&body).unwrap();
    }

    #[tokio::test]
    async fn webdav_directory_transfer_and_failures() {
        let server = DavServer::start();
        let client = server.client("p");
        client.test_connection().await.unwrap();
        assert!(matches!(
            server.client("wrong").test_connection().await,
            Err(SyncError::Authentication)
        ));
        client.ensure_root("Library").await.unwrap();
        client
            .ensure_directory(&["Library", "objects"])
            .await
            .unwrap();
        let path = &["Library", "objects", "a"];
        assert!(!client.exists(path).await.unwrap());
        client.put(path, b"font".to_vec()).await.unwrap();
        assert_eq!(
            client.list(&["Library", "objects"]).await.unwrap(),
            vec!["a"]
        );
        assert_eq!(client.get(path).await.unwrap(), b"font");
        server.state.lock().unwrap().interrupt_next_get = true;
        assert!(matches!(client.get(path).await, Err(SyncError::Http(_))));
        assert_eq!(client.get(path).await.unwrap(), b"font");
        client.put(path, b"font".to_vec()).await.unwrap();
        assert!(matches!(
            client.put(path, b"other".to_vec()).await,
            Err(SyncError::InvalidDavResponse)
        ));
        server.state.lock().unwrap().full = true;
        assert!(matches!(
            client.put(&["Library", "objects", "b"], vec![]).await,
            Err(SyncError::RemoteStorageFull)
        ));
        server.state.lock().unwrap().malformed = true;
        assert!(matches!(
            client.list(&["Library", "objects"]).await,
            Err(SyncError::InvalidDavResponse)
        ));
    }

    #[test]
    fn configured_collection_url_keeps_a_trailing_slash() {
        let profile = SyncProfile {
            server_url: "https://example.com/webdav".to_owned(),
            remote_directory: "Folio".to_owned(),
            username: "u".to_owned(),
            automatic: true,
        };
        let client = WebDavClient::new(&profile, "p").unwrap();
        assert_eq!(client.server.path(), "/webdav/");
        assert_eq!(client.base.path(), "/webdav/Folio");
    }

    #[tokio::test]
    async fn two_libraries_exchange_managed_font_and_user_state() {
        use folio_core::parse_font_file;
        use folio_storage::FolioDatabase;

        let server = DavServer::start();
        let client = server.client("p");
        let dir = tempfile::tempdir().unwrap();
        let first_directory = dir.path().join("first");
        let second_directory = dir.path().join("second");
        std::fs::create_dir_all(&first_directory).unwrap();
        std::fs::create_dir_all(&second_directory).unwrap();
        let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/fonts/Lato-Regular.ttf");
        let font = first_directory.join("Lato-Regular.ttf");
        std::fs::copy(source, &font).unwrap();
        std::fs::copy(&font, first_directory.join("same-bytes.ttf")).unwrap();
        let identity = parse_font_file(&font).unwrap().faces[0].identity.id;
        let profile = SyncProfile {
            server_url: server.url.clone(),
            remote_directory: String::new(),
            username: "u".to_owned(),
            automatic: true,
        };
        let cancelled = AtomicBool::new(false);
        let report: Arc<dyn Fn(crate::SyncProgress) + Send + Sync> = Arc::new(|_| {});
        let mut first = FolioDatabase::open(dir.path().join("first.sqlite")).unwrap();
        first.set_favorite(identity, true).unwrap();
        let collection = first.create_collection("常用字体").unwrap();
        first
            .add_collection_members(collection.id, &[identity])
            .unwrap();
        first.record_recent(identity).unwrap();
        let first_progress = crate::synchronize_with_client(
            &mut first,
            &first_directory,
            &profile,
            &client,
            &cancelled,
            &report,
        )
        .await
        .unwrap();
        assert_eq!(first_progress.uploaded_files, 1);

        let mut second = FolioDatabase::open(dir.path().join("second.sqlite")).unwrap();
        let second_progress = crate::synchronize_with_client(
            &mut second,
            &second_directory,
            &profile,
            &client,
            &cancelled,
            &report,
        )
        .await
        .unwrap();
        assert_eq!(second_progress.downloaded_files, 1);
        assert_eq!(second.list_favorites().unwrap(), vec![identity]);
        assert_eq!(
            second.list_collection_members(collection.id).unwrap(),
            vec![identity]
        );
        assert_eq!(second.list_recent(10).unwrap()[0].identity_id, identity);
        assert_eq!(second.list_sync_assets().unwrap().len(), 1);
        let initial_event_count = second.list_sync_events().unwrap().len();
        crate::synchronize_with_client(
            &mut second,
            &second_directory,
            &profile,
            &client,
            &cancelled,
            &report,
        )
        .await
        .unwrap();
        assert_eq!(
            second.list_sync_events().unwrap().len(),
            initial_event_count
        );
        first.set_favorite(identity, false).unwrap();
        crate::synchronize_with_client(
            &mut first,
            &first_directory,
            &profile,
            &client,
            &cancelled,
            &report,
        )
        .await
        .unwrap();
        crate::synchronize_with_client(
            &mut second,
            &second_directory,
            &profile,
            &client,
            &cancelled,
            &report,
        )
        .await
        .unwrap();
        assert!(second.list_favorites().unwrap().is_empty());
        let downloaded = second.list_sync_assets().unwrap()[0]
            .local_path
            .clone()
            .unwrap();
        assert!(std::path::Path::new(&downloaded).is_file());
        assert_eq!(
            std::fs::read(font).unwrap(),
            std::fs::read(&downloaded).unwrap()
        );

        let fingerprint = second.list_sync_assets().unwrap()[0].fingerprint.clone();
        crate::set_cloud_only(second.path(), &fingerprint).unwrap();
        crate::synchronize_with_client(
            &mut second,
            &second_directory,
            &profile,
            &client,
            &cancelled,
            &report,
        )
        .await
        .unwrap();
        assert!(second.list_sync_assets().unwrap()[0].cloud_only);
        crate::request_restore(second.path(), &fingerprint).unwrap();
        crate::synchronize_with_client(
            &mut second,
            &second_directory,
            &profile,
            &client,
            &cancelled,
            &report,
        )
        .await
        .unwrap();
        assert!(std::path::Path::new(&downloaded).is_file());

        crate::delete_everywhere(first.path(), &fingerprint).unwrap();
        crate::synchronize_with_client(
            &mut first,
            &first_directory,
            &profile,
            &client,
            &cancelled,
            &report,
        )
        .await
        .unwrap();
        crate::synchronize_with_client(
            &mut second,
            &second_directory,
            &profile,
            &client,
            &cancelled,
            &report,
        )
        .await
        .unwrap();
        assert!(second.list_sync_assets().unwrap()[0].deleted);
        assert!(!std::path::Path::new(&downloaded).is_file());
        crate::restore_deleted_font(second.path(), &fingerprint).unwrap();
        crate::synchronize_with_client(
            &mut second,
            &second_directory,
            &profile,
            &client,
            &cancelled,
            &report,
        )
        .await
        .unwrap();
        assert!(std::path::Path::new(&downloaded).is_file());
        crate::synchronize_with_client(
            &mut first,
            &first_directory,
            &profile,
            &client,
            &cancelled,
            &report,
        )
        .await
        .unwrap();
        assert!(!first.list_sync_assets().unwrap()[0].deleted);
    }

    #[tokio::test]
    async fn unknown_remote_format_is_rejected() {
        let server = DavServer::start();
        let client = server.client("p");
        client.ensure_directory(&["Folio", "v2"]).await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        let mut db = folio_storage::FolioDatabase::open(dir.path().join("folio.sqlite")).unwrap();
        let profile = SyncProfile {
            server_url: server.url.clone(),
            remote_directory: String::new(),
            username: "u".to_owned(),
            automatic: true,
        };
        let cancelled = AtomicBool::new(false);
        let report: Arc<dyn Fn(crate::SyncProgress) + Send + Sync> = Arc::new(|_| {});
        assert!(matches!(
            crate::synchronize_with_client(
                &mut db,
                dir.path(),
                &profile,
                &client,
                &cancelled,
                &report,
            )
            .await,
            Err(SyncError::UnsupportedFormat)
        ));
    }

    #[tokio::test]
    async fn concurrent_collection_renames_can_keep_both_versions() {
        let server = DavServer::start();
        let client = server.client("p");
        let dir = tempfile::tempdir().unwrap();
        let first_dir = dir.path().join("first");
        let second_dir = dir.path().join("second");
        let mut first =
            folio_storage::FolioDatabase::open(dir.path().join("first.sqlite")).unwrap();
        let mut second =
            folio_storage::FolioDatabase::open(dir.path().join("second.sqlite")).unwrap();
        let collection = first.create_collection("原名称").unwrap();
        let profile = SyncProfile {
            server_url: server.url.clone(),
            remote_directory: String::new(),
            username: "u".to_owned(),
            automatic: true,
        };
        let cancelled = AtomicBool::new(false);
        let report: Arc<dyn Fn(crate::SyncProgress) + Send + Sync> = Arc::new(|_| {});
        crate::synchronize_with_client(
            &mut first, &first_dir, &profile, &client, &cancelled, &report,
        )
        .await
        .unwrap();
        crate::synchronize_with_client(
            &mut second,
            &second_dir,
            &profile,
            &client,
            &cancelled,
            &report,
        )
        .await
        .unwrap();
        first.rename_collection(collection.id, "本地版本").unwrap();
        second.rename_collection(collection.id, "云端版本").unwrap();
        crate::synchronize_with_client(
            &mut first, &first_dir, &profile, &client, &cancelled, &report,
        )
        .await
        .unwrap();
        crate::synchronize_with_client(
            &mut second,
            &second_dir,
            &profile,
            &client,
            &cancelled,
            &report,
        )
        .await
        .unwrap();
        let conflict = crate::list_conflicts(second.path()).unwrap();
        assert_eq!(conflict.len(), 1);
        crate::resolve_conflict(
            second.path(),
            &conflict[0].id,
            crate::ConflictResolution::KeepBoth,
        )
        .unwrap();
        crate::synchronize_with_client(
            &mut second,
            &second_dir,
            &profile,
            &client,
            &cancelled,
            &report,
        )
        .await
        .unwrap();
        crate::synchronize_with_client(
            &mut first, &first_dir, &profile, &client, &cancelled, &report,
        )
        .await
        .unwrap();
        assert_eq!(first.list_collections().unwrap().len(), 2);
        assert_eq!(second.list_collections().unwrap().len(), 2);
    }
}
