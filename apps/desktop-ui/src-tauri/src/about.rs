use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::WebviewWindow;

// 关于接口仅服务设置窗口，联网入口固定到本项目的正式发行版。
const REPOSITORY: &str = "https://github.com/aurysian-yan/Folio";
static REQUESTING: AtomicBool = AtomicBool::new(false);
struct RequestGuard;
impl Drop for RequestGuard {
    fn drop(&mut self) {
        REQUESTING.store(false, Ordering::Release);
    }
}
#[derive(Serialize)]
pub struct AppInfo {
    version: String,
    build: String,
    platform: &'static str,
    arch: &'static str,
}
#[derive(Serialize)]
pub struct HttpResult {
    status: u16,
    body: String,
}
fn require_settings(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "settings" {
        Ok(())
    } else {
        Err("此操作仅允许从设置窗口执行".into())
    }
}
fn release_link(value: &str, download: bool) -> bool {
    let Ok(url) = reqwest::Url::parse(value) else {
        return false;
    };
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return false;
    }
    let prefix = if download {
        format!("{REPOSITORY}/releases/download/")
    } else {
        format!("{REPOSITORY}/releases/tag/")
    };
    let Some(tail) = value.strip_prefix(&prefix) else {
        return false;
    };
    let parts: Vec<_> = tail.split('/').collect();
    parts.len() == if download { 2 } else { 1 }
        && parts
            .iter()
            .all(|part| !part.is_empty() && *part != "." && *part != "..")
}
#[tauri::command]
pub fn about_info(window: WebviewWindow, app: tauri::AppHandle) -> Result<AppInfo, String> {
    require_settings(&window)?;
    let platform = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    };
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        build: option_env!("FOLIO_BUILD_NUMBER").unwrap_or("1").into(),
        platform,
        arch,
    })
}
#[tauri::command]
pub async fn request_release(window: WebviewWindow, url: String) -> Result<HttpResult, String> {
    require_settings(&window)?;
    if url != "https://api.github.com/repos/aurysian-yan/Folio/releases/latest"
        && !(release_link(&url, true) && url.ends_with("/folio-release.json"))
    {
        return Err("不允许的更新地址".into());
    }
    if REQUESTING.swap(true, Ordering::AcqRel) {
        return Err("已有更新检查正在进行".into());
    }
    let _guard = RequestGuard;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent(concat!("Folio/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "failed")?;
    let mut response = client
        .get(url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "timeout"
            } else {
                "failed"
            }
        })?;
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        if error.is_timeout() {
            "timeout"
        } else {
            "failed"
        }
    })? {
        if bytes.len() + chunk.len() > 2_000_000 {
            return Err("failed".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8(bytes).map_err(|_| "failed")?;
    Ok(HttpResult { status, body })
}
#[tauri::command]
pub fn open_about_link(window: WebviewWindow, url: String) -> Result<(), String> {
    require_settings(&window)?;
    let content: serde_json::Value =
        serde_json::from_str(include_str!("../../../../shared/about/content.json"))
            .map_err(|_| "failed")?;
    let licenses: serde_json::Value =
        serde_json::from_str(include_str!("../../../../shared/about/licenses.json"))
            .map_err(|_| "failed")?;
    let registered = ["links", "credits"].iter().any(|key| {
        content[*key]
            .as_array()
            .is_some_and(|items| items.iter().any(|item| item["url"].as_str() == Some(&url)))
    }) || licenses["entries"].as_array().is_some_and(|items| {
        items
            .iter()
            .any(|item| item["source"].as_str() == Some(&url))
    });
    if !registered && !release_link(&url, false) && !release_link(&url, true) {
        return Err("不允许的外部链接".into());
    }
    let parsed = reqwest::Url::parse(&url).map_err(|_| "failed")?;
    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("不允许的外部链接".into());
    }
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer.exe").arg(&url).spawn();
    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg(&url).spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).spawn();
    result.map(|_| ()).map_err(|_| "failed".into())
}

#[cfg(test)]
mod tests {
    use super::release_link;
    #[test]
    fn restrict_release_links() {
        assert!(release_link(
            "https://github.com/aurysian-yan/Folio/releases/download/v1.0.0/Folio.exe",
            true
        ));
        for value in [
            "https://github.com/other/Folio/releases/tag/v1.0.0",
            "http://github.com/aurysian-yan/Folio/releases/tag/v1.0.0",
            "https://github.com/aurysian-yan/Folio/releases/tag/v1.0.0?next=evil",
            "https://github.com@evil.test/aurysian-yan/Folio/releases/tag/v1.0.0",
        ] {
            assert!(!release_link(value, false));
        }
    }
}
