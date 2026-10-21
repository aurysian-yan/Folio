//! 供原生文件提供器复用的只读目录与单文件按需读取。

use super::*;
use folio_query::{FontQuery, FontQueryIndex, QueryScope, SavedFontQuery};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvidedDocument {
    pub id: String,
    pub parent_id: String,
    pub name: String,
    pub title_key: Option<String>,
    pub mime_type: String,
    pub directory: bool,
    pub size: u64,
    pub fingerprint: Option<String>,
    pub available: bool,
}

fn folder(id: &str, parent: &str, name: &str, key: Option<&str>) -> ProvidedDocument {
    ProvidedDocument {
        id: id.into(),
        parent_id: parent.into(),
        name: name.into(),
        title_key: key.map(str::to_owned),
        mime_type: "vnd.android.document/directory".into(),
        directory: true,
        size: 0,
        fingerprint: None,
        available: true,
    }
}

pub fn provided_documents(
    database: &Path,
    parent: &str,
) -> Result<Vec<ProvidedDocument>, SyncError> {
    let mut db = FolioDatabase::open(database)?;
    if parent == "root" {
        return Ok(vec![
            folder("local", "root", "", Some("workflow.local")),
            folder("favorites", "root", "", Some("library.favorites")),
            folder("collections", "root", "", Some("workflow.collections")),
            folder("cloud", "root", "", Some("workflow.cloud")),
        ]);
    }
    if parent == "collections" {
        let mut result = db
            .list_collections()?
            .into_iter()
            .map(|value| {
                folder(
                    &format!("collection:{}", value.id),
                    parent,
                    &value.name,
                    None,
                )
            })
            .collect::<Vec<_>>();
        result.extend(
            db.list_smart_folders()?
                .into_iter()
                .map(|value| folder(&format!("smart:{}", value.id), parent, &value.name, None)),
        );
        return Ok(result);
    }
    let local = db.load_cached_catalog()?;
    let unified = unified_library(&db, &local)?;
    let state = db.library_state_snapshot()?;
    let index =
        FontQueryIndex::build(&unified.catalog, &state).map_err(|_| SyncError::InvalidId)?;
    let mut query = FontQuery::default();
    match parent {
        "local" | "cloud" => {}
        "favorites" => query.scope = QueryScope::Favorites,
        value if value.starts_with("collection:") => {
            query.scope = QueryScope::Collection(CollectionId::from_bytes(parse_id(&value[11..])?))
        }
        value if value.starts_with("smart:") => {
            let item = db
                .list_smart_folders()?
                .into_iter()
                .find(|item| item.id.to_string() == value[6..])
                .ok_or(SyncError::InvalidId)?;
            query = serde_json::from_str::<SavedFontQuery>(&item.query_json)?
                .into_query(0, None)
                .map_err(|_| SyncError::InvalidId)?;
        }
        _ => return Err(SyncError::InvalidId),
    }
    let faces = index
        .query(&query)
        .map_err(|_| SyncError::InvalidId)?
        .families
        .into_iter()
        .flat_map(|family| family.matched_face_ids)
        .collect::<BTreeSet<_>>();
    let mut files = BTreeMap::new();
    for (face, location) in unified.locations {
        if !faces.contains(&face) {
            continue;
        }
        for file in location.files {
            if parent == "local" && file.local_sources.is_empty()
                || parent == "cloud" && !file.cloud_available
            {
                continue;
            }
            let mime = match Path::new(&file.filename)
                .extension()
                .and_then(|extension| extension.to_str())
                .unwrap_or("")
                .to_lowercase()
                .as_str()
            {
                "ttf" => "font/ttf",
                "otf" => "font/otf",
                "ttc" | "otc" => "font/collection",
                _ => "application/octet-stream",
            };
            files
                .entry(file.fingerprint.clone())
                .or_insert(ProvidedDocument {
                    id: format!("{parent}/{}", file.fingerprint),
                    parent_id: parent.into(),
                    name: file.filename,
                    title_key: None,
                    mime_type: mime.into(),
                    directory: false,
                    size: file.file_size,
                    fingerprint: Some(file.fingerprint),
                    available: !file.local_sources.is_empty(),
                });
        }
    }
    Ok(files.into_values().collect())
}

pub fn provided_document(database: &Path, id: &str) -> Result<ProvidedDocument, SyncError> {
    if id == "root" {
        return Ok(folder("root", "root", "Folio", None));
    }
    let parent = if let Some((parent, _)) = id.rsplit_once('/') {
        parent
    } else if id.starts_with("collection:") || id.starts_with("smart:") {
        "collections"
    } else {
        "root"
    };
    provided_documents(database, parent)?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or(SyncError::InvalidId)
}

pub fn readable_document(database: &Path, fingerprint: &str) -> Result<Option<PathBuf>, SyncError> {
    let db = FolioDatabase::open(database)?;
    for (path, hash) in db.readable_font_files()? {
        if hash == fingerprint
            && db.reference_path_available(&path)?
            && parse_font_file(&path).is_ok_and(|file| file.fingerprint.to_hex() == fingerprint)
        {
            return Ok(Some(path));
        }
    }
    Ok(None)
}

pub async fn materialize_document(
    database: &Path,
    directory: &Path,
    fingerprint: &str,
    password: &str,
    cancelled: &AtomicBool,
) -> Result<PathBuf, SyncError> {
    if cancelled.load(Ordering::Acquire) {
        return Err(SyncError::Cancelled);
    }
    if fingerprint.len() != 64 || !fingerprint.bytes().all(|value| value.is_ascii_hexdigit()) {
        return Err(SyncError::InvalidId);
    }
    if let Some(path) = readable_document(database, fingerprint)? {
        return Ok(path);
    }
    // 单文件锁串行同一对象的落盘；取消只作用于当前调用，不共享取消标记。
    let _guard = object_write_guard(database, fingerprint, cancelled).await?;

    if let Some(path) = readable_document(database, fingerprint)? {
        return Ok(path);
    }
    let profile = load_profile(database)?.ok_or(SyncError::NotConfigured)?;
    let remote = WebDavClient::new(&profile, password)?;
    let mut db = FolioDatabase::open(database)?;
    let mut asset = db
        .list_sync_assets()?
        .into_iter()
        .find(|asset| asset.fingerprint == fingerprint && !asset.deleted)
        .ok_or(SyncError::InvalidId)?;
    if !cloud_fonts(&db)?
        .iter()
        .any(|item| item.fingerprint == fingerprint && !item.deleted)
    {
        return Err(SyncError::InvalidId);
    }
    let metadata: RemoteAsset = serde_json::from_str(&asset.remote_payload)?;
    std::fs::create_dir_all(directory)?;
    let path = download_asset_unlocked(database, &remote, directory, &metadata, cancelled).await?;
    // 下载期间断开或切换连接，不将旧连接对象提交到新连接。
    if load_profile(database)?.as_ref() != Some(&profile) {
        return Err(SyncError::Cancelled);
    }
    if db
        .list_sync_assets()?
        .iter()
        .find(|value| value.fingerprint == fingerprint)
        .is_none_or(|value| value.deleted)
    {
        return Err(SyncError::Cancelled);
    }
    asset.local_path = Some(path.to_string_lossy().into_owned());
    asset.cloud_only = false;
    db.upsert_sync_asset(&asset)?;
    db.add_root(directory, true)?;
    db.refresh(RefreshMode::Incremental)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn document_aliases_preserve_whole_files_and_shared_collection_queries() {
        let temp = tempfile::tempdir().unwrap();
        let database = temp.path().join("folio.sqlite");
        let source =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/fonts/Lato-Regular.ttf");
        let mut db = FolioDatabase::open(&database).unwrap();
        db.add_file_root(&source).unwrap();
        let refreshed = db.refresh(RefreshMode::Incremental).unwrap();
        let identity = refreshed.catalog.faces().next().unwrap().identity_id;
        db.set_favorite(identity, true).unwrap();
        let local = provided_documents(&database, "local").unwrap();
        let favorites = provided_documents(&database, "favorites").unwrap();
        assert_eq!(local.len(), 1);
        assert_eq!(favorites.len(), 1);
        assert_eq!(local[0].fingerprint, favorites[0].fingerprint);
        assert!(!local[0].id.contains(temp.path().to_str().unwrap()));
        let collection = db.create_collection("测试").unwrap();
        db.add_collection_members(collection.id, &[identity])
            .unwrap();
        assert_eq!(
            provided_documents(&database, &format!("collection:{}", collection.id))
                .unwrap()
                .len(),
            1
        );
        assert!(provided_document(&database, &local[0].id).is_ok());
        assert!(provided_document(&database, "local/../../private").is_err());
    }
}
