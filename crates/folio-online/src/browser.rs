//! 在线来源配置与安全地址构建。

use folio_storage::FolioDatabase;
use reqwest::Url;
use serde::{Deserialize, Serialize};

pub type Result<T> = std::result::Result<T, BrowserError>;

#[derive(Debug, thiserror::Error)]
pub enum BrowserError {
    #[error("online.browser.invalidSource")]
    InvalidSource,
    #[error("online.browser.storageError")]
    Storage(#[from] folio_storage::StorageError),
    #[error("online.browser.storageError")]
    Json(#[from] serde_json::Error),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchProvider {
    pub id: String,
    pub name: String,
    pub homepage: String,
    pub search_template: String,
    pub enabled: bool,
    pub builtin: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<ProviderIcon>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ProviderIcon {
    Custom {
        #[serde(rename = "assetId")]
        asset_id: String,
    },
}

pub fn public_https(value: &str) -> Result<Url> {
    let url = Url::parse(value).map_err(|_| BrowserError::InvalidSource)?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || value.len() > 8192
    {
        return Err(BrowserError::InvalidSource);
    }
    let host = url
        .host_str()
        .ok_or(BrowserError::InvalidSource)?
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
    {
        return Err(BrowserError::InvalidSource);
    }
    if let Ok(address) = host.trim_matches(['[', ']']).parse::<std::net::IpAddr>() {
        if !public_ip(address) {
            return Err(BrowserError::InvalidSource);
        }
    } else if !host.contains('.') {
        return Err(BrowserError::InvalidSource);
    }
    Ok(url)
}

pub fn public_ip(address: std::net::IpAddr) -> bool {
    match address {
        std::net::IpAddr::V4(ip) => {
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_unspecified()
                && !ip.is_broadcast()
                && !ip.is_multicast()
                && ip.octets()[0] != 0
                && ip.octets()[0] < 224
                && !(ip.octets()[0] == 100 && (64..=127).contains(&ip.octets()[1]))
        }
        std::net::IpAddr::V6(ip) => ip
            .to_ipv4_mapped()
            .map(|v| public_ip(v.into()))
            .unwrap_or_else(|| {
                !ip.is_loopback()
                    && !ip.is_unspecified()
                    && !ip.is_multicast()
                    && ip.segments()[0] & 0xfe00 != 0xfc00
                    && ip.segments()[0] & 0xffc0 != 0xfe80
            }),
    }
}

pub fn default_providers() -> Vec<SearchProvider> {
    [
        (
            "google-fonts",
            "Google Fonts",
            "https://fonts.google.com/",
            "https://fonts.google.com/?query={{query}}",
        ),
        (
            "maoken",
            "猫啃网",
            "https://www.maoken.com/",
            "https://www.maoken.com/?s={{query}}",
        ),
        (
            "100font",
            "100font",
            "https://www.100font.com/",
            "https://www.100font.com/search.htm?keyword={{query}}",
        ),
        (
            "font-library",
            "Font Library",
            "https://fontlibrary.org/",
            "https://fontlibrary.org/en/search?query={{query}}",
        ),
    ]
    .into_iter()
    .map(|(id, name, homepage, template)| SearchProvider {
        id: id.into(),
        name: name.into(),
        homepage: homepage.into(),
        search_template: template.into(),
        enabled: true,
        builtin: true,
        icon: None,
    })
    .collect()
}

pub fn validate_provider(provider: &SearchProvider) -> Result<()> {
    if provider.id.is_empty()
        || provider.id.len() > 100
        || provider.name.trim().is_empty()
        || provider.name.chars().count() > 80
        || !provider.search_template.contains("{{query}}")
    {
        return Err(BrowserError::InvalidSource);
    }
    public_https(&provider.homepage)?;
    public_https(&provider.search_template.replace("{{query}}", "folio"))?;
    if let Some(ProviderIcon::Custom { asset_id }) = &provider.icon {
        if asset_id.len() != 64 || !asset_id.bytes().all(|value| value.is_ascii_hexdigit()) {
            return Err(BrowserError::InvalidSource);
        }
    }
    Ok(())
}

pub fn search_url(provider: &SearchProvider, query: &str) -> Result<String> {
    validate_provider(provider)?;
    if query.trim().is_empty() {
        return Ok(provider.homepage.clone());
    }
    let encoded = query
        .as_bytes()
        .iter()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (*byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect::<String>();
    Ok(public_https(&provider.search_template.replace("{{query}}", &encoded))?.into())
}

pub fn providers(db: &FolioDatabase) -> Result<Vec<SearchProvider>> {
    match db.online_setting("providers")? {
        Some(value) => Ok(serde_json::from_str(&value)?),
        None => Ok(default_providers()),
    }
}

pub fn save_providers(db: &FolioDatabase, values: Vec<SearchProvider>) -> Result<()> {
    if values.len() > 50 {
        return Err(BrowserError::InvalidSource);
    }
    let defaults = default_providers();
    let mut ids = std::collections::HashSet::new();
    for provider in &values {
        validate_provider(provider)?;
        if !ids.insert(&provider.id)
            || provider.builtin != defaults.iter().any(|v| v.id == provider.id)
        {
            return Err(BrowserError::InvalidSource);
        }
    }
    if defaults
        .iter()
        .any(|v| !values.iter().any(|p| p.id == v.id))
    {
        return Err(BrowserError::InvalidSource);
    }
    db.save_online_setting("providers", &serde_json::to_string(&values)?)?;
    Ok(())
}

pub fn redacted_url(value: &str) -> Result<String> {
    let mut url = public_https(value)?;
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_encodes_unicode_and_reserved_characters_once() {
        let provider = default_providers().remove(1);
        assert_eq!(
            search_url(&provider, "字体 & #?/%").unwrap(),
            "https://www.maoken.com/?s=%E5%AD%97%E4%BD%93%20%26%20%23%3F%2F%25"
        );
        assert_eq!(search_url(&provider, "  ").unwrap(), provider.homepage);
    }

    #[test]
    fn private_addresses_and_embedded_credentials_are_rejected() {
        for value in [
            "http://example.com",
            "https://localhost",
            "https://127.0.0.1",
            "https://2130706433",
            "https://[::1]",
            "https://[::ffff:127.0.0.1]",
            "https://192.168.1.1",
            "https://100.64.0.1",
            "https://test.local",
            "https://user:secret@example.com",
        ] {
            assert!(public_https(value).is_err(), "{value}");
        }
        assert!(public_https("https://example.com/font").is_ok());
    }

    #[test]
    fn provider_edits_preserve_order_and_cannot_delete_builtins() {
        let root = tempfile::tempdir().unwrap();
        let db = FolioDatabase::open(root.path().join("folio.sqlite")).unwrap();
        let mut values = default_providers();
        values.reverse();
        values[0].enabled = false;
        save_providers(&db, values.clone()).unwrap();
        assert_eq!(providers(&db).unwrap()[0].id, values[0].id);
        assert!(!providers(&db).unwrap()[0].enabled);
        values.pop();
        assert!(save_providers(&db, values).is_err());
    }
}
