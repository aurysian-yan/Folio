//! 在线来源与后台传输的跨端粗粒度接口。

use crate::FolioFfiError;
use folio_online::browser;
use folio_online::favicon::IconCache;
use folio_storage::FolioDatabase;
use folio_transfer::{OnlineOrigin, TransferService};
use std::{path::PathBuf, sync::Arc};
type Result<T> = std::result::Result<T, FolioFfiError>;
fn error(value: impl std::fmt::Display) -> FolioFfiError {
    FolioFfiError::operation(value)
}

#[derive(uniffi::Object)]
pub struct FolioBrowser {
    database: PathBuf,
    transfers: TransferService,
    icons: IconCache,
}

#[uniffi::export]
impl FolioBrowser {
    #[uniffi::constructor]
    pub fn open(database_path: String, transfer_directory: String) -> Result<Arc<Self>> {
        Ok(Arc::new(Self {
            transfers: TransferService::open(&database_path, transfer_directory).map_err(error)?,
            icons: IconCache::open(&database_path).map_err(error)?,
            database: database_path.into(),
        }))
    }
    pub fn state(&self) -> Result<String> {
        let db = FolioDatabase::open(&self.database).map_err(error)?;
        let providers = browser::providers(&db)
            .map_err(error)?
            .into_iter()
            .map(|provider| {
                let uri = self.icons.provider_uri(&db, &provider).map_err(error)?;
                let mut value = serde_json::to_value(provider).map_err(error)?;
                value["iconUri"] = serde_json::json!(uri);
                Ok(value)
            })
            .collect::<Result<Vec<_>>>()?;
        serde_json::to_string(&serde_json::json!({
            "providers": providers,
            "defaultProviders": browser::default_providers(),
            "accepted": db.online_setting("disclaimer").map_err(error)?.is_some(),
            "jobs": self.transfers.list().map_err(error)?
        }))
        .map_err(error)
    }
    pub fn accept_disclaimer(&self) -> Result<()> {
        FolioDatabase::open(&self.database)
            .map_err(error)?
            .save_online_setting("disclaimer", "1")
            .map_err(error)
    }
    pub fn save_providers(&self, value: String) -> Result<()> {
        let db = FolioDatabase::open(&self.database).map_err(error)?;
        if db.online_setting("disclaimer").map_err(error)?.is_none() {
            return Err(error("online.browser.acceptRequired"));
        }
        let values: Vec<browser::SearchProvider> = serde_json::from_str(&value).map_err(error)?;
        for provider in &values {
            if let Some(browser::ProviderIcon::Custom { asset_id }) = &provider.icon {
                if !self.icons.custom_exists(asset_id) {
                    return Err(error("online.browser.invalidIcon"));
                }
            }
        }
        browser::save_providers(&db, values).map_err(error)
    }
    pub fn import_icon(&self, path: String) -> Result<String> {
        let db = FolioDatabase::open(&self.database).map_err(error)?;
        if db.online_setting("disclaimer").map_err(error)?.is_none() {
            return Err(error("online.browser.acceptRequired"));
        }
        let asset_id = self
            .icons
            .import_file(std::path::Path::new(&path))
            .map_err(error)?;
        let uri = self.icons.asset_uri(&asset_id).map_err(error)?;
        serde_json::to_string(&serde_json::json!({"assetId":asset_id,"uri":uri})).map_err(error)
    }
    pub fn refresh_icon(
        &self,
        provider_id: String,
        page_url: String,
        candidates: Vec<String>,
    ) -> Result<bool> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(error)?;
        runtime
            .block_on(self.icons.refresh(&provider_id, &page_url, &candidates))
            .map_err(error)
    }
    pub fn search(&self, provider_id: String, query: String) -> Result<String> {
        let db = FolioDatabase::open(&self.database).map_err(error)?;
        let provider = browser::providers(&db)
            .map_err(error)?
            .into_iter()
            .find(|v| v.id == provider_id && v.enabled)
            .ok_or_else(|| error("online.browser.invalidSource"))?;
        browser::search_url(&provider, &query).map_err(error)
    }
    pub fn validate_address(&self, url: String) -> Result<String> {
        Ok(browser::public_https(&url).map_err(error)?.into())
    }
    pub fn create_download(&self, url: String, name: String, origin: String) -> Result<String> {
        let db = FolioDatabase::open(&self.database).map_err(error)?;
        if db.online_setting("disclaimer").map_err(error)?.is_none() {
            return Err(error("online.browser.acceptRequired"));
        }
        let origin: OnlineOrigin = serde_json::from_str(&origin).map_err(error)?;
        serde_json::to_string(&self.transfers.create(&url, &name, origin).map_err(error)?)
            .map_err(error)
    }
    pub fn create_local_download(&self, name: String, origin: String) -> Result<String> {
        let db = FolioDatabase::open(&self.database).map_err(error)?;
        if db.online_setting("disclaimer").map_err(error)?.is_none() {
            return Err(error("online.browser.acceptRequired"));
        }
        let origin: OnlineOrigin = serde_json::from_str(&origin).map_err(error)?;
        serde_json::to_string(&self.transfers.create_local(&name, origin).map_err(error)?)
            .map_err(error)
    }
    pub fn download_path(&self, id: String) -> Result<String> {
        Ok(self
            .transfers
            .path(&id)
            .map_err(error)?
            .to_string_lossy()
            .into_owned())
    }
    pub fn progress(
        &self,
        id: String,
        done: u64,
        total: Option<u64>,
        generation: u64,
    ) -> Result<()> {
        self.transfers
            .progress_for_attempt(&id, done, total, generation)
            .map(|_| ())
            .map_err(error)
    }
    pub fn finish_download(&self, id: String, generation: u64) -> Result<()> {
        self.transfers
            .finish_for_attempt(&id, generation)
            .map(|_| ())
            .map_err(error)
    }
    pub fn set_download_state(
        &self,
        id: String,
        state: String,
        error_key: Option<String>,
        generation: Option<u64>,
    ) -> Result<()> {
        self.transfers
            .state_for_attempt(
                &id,
                &state,
                error_key,
                generation.unwrap_or(self.transfers.job(&id).map_err(error)?.generation),
            )
            .map(|_| ())
            .map_err(error)
    }
    pub fn cancel_download(&self, id: String) -> Result<()> {
        self.transfers.discard(&id).map_err(error)
    }
    pub fn record_origin(&self, id: String, fingerprint: String) -> Result<()> {
        self.transfers
            .record_origin(&id, &fingerprint)
            .map_err(error)
    }
    pub fn archive_entries(&self, id: String) -> Result<String> {
        serde_json::to_string(&self.transfers.inspect_archive(&id).map_err(error)?).map_err(error)
    }
    pub fn run_download(&self, id: String, url: String, headers: String) -> Result<()> {
        let generation = self.transfers.job(&id).map_err(error)?.generation;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(error)?;
        if let Err(cause) = runtime.block_on(self.transfers.download(&id, &url, &headers)) {
            if !matches!(cause, folio_transfer::TransferError::Busy) {
                let _ = self.transfers.state_for_attempt(
                    &id,
                    "failed",
                    Some(cause.to_string()),
                    generation,
                );
            }
            return Err(error(cause));
        }
        Ok(())
    }
}
