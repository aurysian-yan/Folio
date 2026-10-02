//! 独立回环 WebDAV 验证；只在测试客户端允许 HTTP。

use super::webdav::tests::DavServer;
use super::*;
use std::sync::Mutex;

fn sample(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/fonts")
        .join(name)
}
fn profile() -> SyncProfile {
    SyncProfile {
        server_url: "https://independent.example.test/".to_owned(),
        remote_directory: String::new(),
        username: "test".to_owned(),
        automatic: true,
    }
}
async fn exchange(db: &mut FolioDatabase, directory: &Path, remote: &WebDavClient) -> SyncProgress {
    let reports = Arc::new(Mutex::new(Vec::new()));
    let values = reports.clone();
    let report: Arc<dyn Fn(SyncProgress) + Send + Sync> =
        Arc::new(move |state| values.lock().unwrap().push(state));
    let result = synchronize_with_client(
        db,
        directory,
        &profile(),
        remote,
        &AtomicBool::new(false),
        &report,
    )
    .await
    .unwrap();
    let values = reports.lock().unwrap();
    assert!(values
        .iter()
        .any(|state| state.phase == SyncPhase::Connecting));
    assert!(values
        .iter()
        .any(|state| state.phase == SyncPhase::Finishing));
    assert_eq!(result.percent, 100);
    result
}

#[tokio::test]
async fn mobile_and_desktop_exchange_fonts_and_all_user_state_without_duplicate_imports() {
    let server = DavServer::start();
    let remote = server.client("p");
    let mobile = tempfile::tempdir().unwrap();
    let desktop = tempfile::tempdir().unwrap();
    let mobile_fonts = mobile.path().join("FolioMobilePoC/fonts");
    let desktop_fonts = desktop.path().join("ManagedFonts");
    std::fs::create_dir_all(&mobile_fonts).unwrap();
    std::fs::create_dir_all(&desktop_fonts).unwrap();
    let mobile_db = mobile.path().join("folio.sqlite");
    let desktop_db = desktop.path().join("folio.sqlite");
    save_profile(&mobile_db, &profile()).unwrap();
    save_profile(&desktop_db, &profile()).unwrap();
    let old = mobile_fonts.join("legacy.font");
    std::fs::copy(sample("Lato-Regular.ttf"), &old).unwrap();
    let identity = parse_font_file(&old).unwrap().faces[0].identity.id;
    let mut a = FolioDatabase::open(&mobile_db).unwrap();
    a.add_file_root(&old).unwrap();
    a.refresh(RefreshMode::Incremental).unwrap();
    a.set_favorite(identity, true).unwrap();
    let collection = a.create_collection("移动收藏夹").unwrap();
    a.add_collection_members(collection.id, &[identity])
        .unwrap();
    let smart = a
        .create_smart_folder(
            "拉丁字体",
            r#"{"text":"Lato","scripts":["Latn"],"weights":[400.0]}"#,
        )
        .unwrap();
    a.record_recent(identity).unwrap();
    prepare_managed_sources(&mobile_db, &mobile_fonts).unwrap();
    assert!(!old.exists());
    let first = exchange(&mut a, &mobile_fonts, &remote).await;
    assert_eq!(first.uploaded_files, 1);
    let mut b = FolioDatabase::open(&desktop_db).unwrap();
    b.add_root(&desktop_fonts, true).unwrap();
    let downloaded = exchange(&mut b, &desktop_fonts, &remote).await;
    assert_eq!(downloaded.downloaded_files, 1);
    assert_eq!(b.list_favorites().unwrap(), vec![identity]);
    assert_eq!(
        b.list_collection_members(collection.id).unwrap(),
        vec![identity]
    );
    assert_eq!(
        b.list_smart_folders()
            .unwrap()
            .into_iter()
            .find(|folder| folder.id == smart.id)
            .unwrap()
            .query_json,
        smart.query_json
    );
    assert_eq!(b.list_recent(100).unwrap()[0].identity_id, identity);
    std::fs::copy(
        sample("SourceSerif4-Regular.otf"),
        desktop_fonts.join("desktop.otf"),
    )
    .unwrap();
    b.refresh(RefreshMode::Incremental).unwrap();
    let second_id = parse_font_file(desktop_fonts.join("desktop.otf"))
        .unwrap()
        .faces[0]
        .identity
        .id;
    b.set_favorite(identity, false).unwrap();
    b.set_favorite(second_id, true).unwrap();
    b.add_collection_members(collection.id, &[second_id])
        .unwrap();
    b.record_recent(second_id).unwrap();
    b.update_collection(
        collection.id,
        "桌面收藏夹",
        CollectionIcon::Heart,
        CollectionColor::Purple,
    )
    .unwrap();
    b.update_smart_folder(
        smart.id,
        "桌面条件",
        r#"{"text":"Source","scripts":["Latn"]}"#,
    )
    .unwrap();
    exchange(&mut b, &desktop_fonts, &remote).await;
    let received = exchange(&mut a, &mobile_fonts, &remote).await;
    assert_eq!(received.downloaded_files, 1);
    assert_eq!(a.list_favorites().unwrap(), vec![second_id]);
    assert_eq!(a.list_collection_members(collection.id).unwrap().len(), 2);
    assert_eq!(a.list_collections().unwrap()[0].name, "桌面收藏夹");
    assert_eq!(
        a.list_smart_folders()
            .unwrap()
            .into_iter()
            .find(|folder| folder.id == smart.id)
            .unwrap()
            .name,
        "桌面条件"
    );
    assert_eq!(a.list_recent(100).unwrap()[0].identity_id, second_id);
    let file_count = std::fs::read_dir(&mobile_fonts).unwrap().count();
    let events = a.list_sync_events().unwrap().len();
    let repeated = exchange(&mut a, &mobile_fonts, &remote).await;
    assert_eq!(
        repeated.uploaded_files + repeated.downloaded_files + repeated.published_events,
        0
    );
    assert_eq!(a.list_sync_events().unwrap().len(), events);
    assert_eq!(
        std::fs::read_dir(&mobile_fonts).unwrap().count(),
        file_count
    );
    drop(a);
    assert_eq!(load_profile(&mobile_db).unwrap(), Some(profile()));
    prepare_managed_sources(&mobile_db, &mobile_fonts).unwrap();
    let reopened = FolioDatabase::open(&mobile_db).unwrap();
    assert_eq!(reopened.list_roots().unwrap().len(), 1);
    assert_eq!(reopened.list_favorites().unwrap(), vec![second_id]);
    assert_eq!(
        reopened
            .list_collection_members(collection.id)
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn legacy_sources_relocate_and_failed_validation_keeps_originals() {
    let temporary = tempfile::tempdir().unwrap();
    let previous = temporary.path().join("old/FolioMobilePoC/fonts");
    let current = temporary.path().join("new/FolioMobilePoC/fonts");
    std::fs::create_dir_all(&previous).unwrap();
    let old = previous.join("legacy.font");
    std::fs::copy(sample("Lato-Regular.ttf"), &old).unwrap();
    let db_path = temporary.path().join("folio.sqlite");
    let mut db = FolioDatabase::open(&db_path).unwrap();
    db.add_file_root(&old).unwrap();
    db.add_root(&previous, true).unwrap();
    db.refresh(RefreshMode::Incremental).unwrap();
    let parsed = parse_font_file(&old).unwrap();
    let identity = parsed.faces[0].identity.id;
    let fingerprint = parsed.fingerprint.to_hex();
    db.upsert_sync_asset(&StoredSyncAsset {
        fingerprint: fingerprint.clone(),
        filename: "legacy.ttf".to_owned(),
        extension: "ttf".to_owned(),
        local_path: Some(old.to_string_lossy().into_owned()),
        remote_payload: String::new(),
        cloud_only: false,
        deleted: false,
    })
    .unwrap();
    db.set_favorite(identity, true).unwrap();
    db.record_recent(identity).unwrap();
    let collection = db.create_collection("保留收藏夹").unwrap();
    db.add_collection_members(collection.id, &[identity])
        .unwrap();
    std::fs::create_dir_all(current.parent().unwrap()).unwrap();
    std::fs::rename(&previous, &current).unwrap();
    prepare_managed_sources(&db_path, &current).unwrap();
    prepare_managed_sources(&db_path, &current).unwrap();
    let roots = db.list_roots().unwrap();
    assert_eq!(roots.len(), 1);
    assert_eq!(roots[0].path, current.canonicalize().unwrap());
    assert_eq!(db.list_favorites().unwrap(), vec![identity]);
    assert_eq!(
        db.list_collection_members(collection.id).unwrap(),
        vec![identity]
    );
    assert_eq!(db.list_recent(100).unwrap()[0].identity_id, identity);
    let normalized = std::fs::read_dir(&current)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert_eq!(normalized.extension().unwrap(), "ttf");
    let asset = db
        .list_sync_assets()
        .unwrap()
        .into_iter()
        .find(|asset| asset.fingerprint == fingerprint)
        .unwrap();
    assert_eq!(
        asset.local_path,
        Some(
            normalized
                .canonicalize()
                .unwrap()
                .to_string_lossy()
                .into_owned()
        )
    );
    let bad = current.join("invalid.font");
    std::fs::write(&bad, b"invalid").unwrap();
    let root = match db.add_file_root(&bad).unwrap() {
        folio_storage::AddRootOutcome::Created(root) => root,
        _ => panic!(),
    };
    assert!(prepare_managed_sources(&db_path, &current).is_err());
    assert!(bad.exists());
    assert!(db.get_root(root.id).unwrap().is_some());
    assert!(normalized.exists());
}

#[test]
fn embedded_password_is_rejected_before_profile_is_persisted() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("folio.sqlite");
    let mut config = profile();
    config.server_url = "https://:test-password@independent.example.test/".to_owned();
    assert!(matches!(
        save_profile(&database, &config),
        Err(SyncError::InvalidServerUrl)
    ));
    assert!(load_profile(&database).unwrap().is_none());
}

#[test]
fn file_source_is_kept_until_the_managed_directory_owns_its_parsed_cache() {
    let temporary = tempfile::tempdir().unwrap();
    let fonts = temporary.path().join("FolioMobilePoC/fonts");
    let nested = fonts.join("legacy");
    std::fs::create_dir_all(&nested).unwrap();
    let source = nested.join("old.data");
    std::fs::copy(sample("Lato-Regular.ttf"), &source).unwrap();
    let database = temporary.path().join("folio.sqlite");
    let mut db = FolioDatabase::open(&database).unwrap();
    let root = match db.add_file_root(&source).unwrap() {
        folio_storage::AddRootOutcome::Created(root)
        | folio_storage::AddRootOutcome::Existing(root) => root,
    };
    db.refresh(RefreshMode::Incremental).unwrap();
    prepare_managed_sources(&database, &fonts).unwrap();
    assert!(db.get_root(root.id).unwrap().is_some());
    assert!(source.exists());
    assert_eq!(db.load_cached_catalog().unwrap().face_count(), 1);
}

#[test]
fn nested_legacy_font_is_normalized_into_the_upload_directory() {
    let temporary = tempfile::tempdir().unwrap();
    let fonts = temporary.path().join("FolioMobilePoC/fonts");
    let nested = fonts.join("legacy");
    std::fs::create_dir_all(&nested).unwrap();
    let source = nested.join("old.font");
    std::fs::copy(sample("Lato-Regular.ttf"), &source).unwrap();
    let database = temporary.path().join("folio.sqlite");
    let mut db = FolioDatabase::open(&database).unwrap();
    db.add_file_root(&source).unwrap();
    db.refresh(RefreshMode::Incremental).unwrap();
    prepare_managed_sources(&database, &fonts).unwrap();
    assert!(!source.exists());
    assert_eq!(db.list_roots().unwrap().len(), 1);
    stage_managed_fonts(&mut db, &fonts).unwrap();
    assert_eq!(db.list_sync_assets().unwrap().len(), 1);
}
