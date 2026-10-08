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
    set_automatic_download(db.path(), true).unwrap();
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

fn collection_bytes() -> Vec<u8> {
    let mut bytes = b"ttcf\0\x01\0\0\0\0\0\x02\0\0\0\0\0\0\0\0".to_vec();
    for (index, name) in ["Lato-Regular.ttf", "Lato-Bold.ttf"].iter().enumerate() {
        let base = bytes.len() as u32;
        bytes[12 + index * 4..16 + index * 4].copy_from_slice(&base.to_be_bytes());
        let mut font = std::fs::read(sample(name)).unwrap();
        let count = u16::from_be_bytes(font[4..6].try_into().unwrap());
        for table in 0..count as usize {
            let record = 12 + table * 16;
            let offset = u32::from_be_bytes(font[record + 8..record + 12].try_into().unwrap());
            font[record + 8..record + 12].copy_from_slice(&(offset + base).to_be_bytes());
        }
        bytes.extend(font);
        while !bytes.len().is_multiple_of(4) {
            bytes.push(0);
        }
    }
    bytes
}

#[tokio::test]
async fn cloud_eviction_download_delete_and_recovery_preserve_sources_and_user_state() {
    let server = DavServer::start();
    let remote = server.client("p");
    let temporary = tempfile::tempdir().unwrap();
    let first = temporary.path().join("mobile/fonts");
    let second = temporary.path().join("desktop/fonts");
    std::fs::create_dir_all(&first).unwrap();
    std::fs::create_dir_all(&second).unwrap();
    std::fs::write(first.join("Lato.ttc"), collection_bytes()).unwrap();
    std::fs::copy(sample("Inter-Variable.ttf"), first.join("Inter.ttf")).unwrap();
    let mut a = FolioDatabase::open(temporary.path().join("mobile.sqlite")).unwrap();
    let mut b = FolioDatabase::open(temporary.path().join("desktop.sqlite")).unwrap();
    a.add_file_root(first.join("Lato.ttc")).unwrap();
    a.add_root(&first, true).unwrap();
    a.refresh(RefreshMode::Incremental).unwrap();
    let parsed = parse_font_file(first.join("Lato.ttc")).unwrap();
    let ids = parsed
        .faces
        .iter()
        .map(|face| face.identity.id)
        .collect::<Vec<_>>();
    let fingerprint = parsed.fingerprint.to_hex();
    a.set_favorite(ids[1], true).unwrap();
    let collection = a.create_collection("测试收藏").unwrap();
    a.add_collection_members(collection.id, &ids).unwrap();
    a.record_recent(ids[1]).unwrap();
    exchange(&mut a, &first, &remote).await;
    exchange(&mut b, &second, &remote).await;
    set_cloud_only(a.path(), &fingerprint).unwrap();
    // 显式文件根与目录的重叠缓存都必须立即清除。
    assert_eq!(a.load_cached_catalog().unwrap().face_count(), 1);
    assert!(a
        .source_root_ids(first.join("Lato.ttc"))
        .unwrap()
        .is_empty());
    exchange(&mut a, &first, &remote).await;
    assert!(
        list_cloud_fonts(a.path())
            .unwrap()
            .iter()
            .find(|font| font.fingerprint == fingerprint)
            .unwrap()
            .cloud_only
    );
    assert_eq!(b.load_cached_catalog().unwrap().face_count(), 3);
    request_restore(a.path(), &fingerprint).unwrap();
    let result = exchange(&mut a, &first, &remote).await;
    assert_eq!(result.downloaded_files, 1);
    let asset = a
        .list_sync_assets()
        .unwrap()
        .into_iter()
        .find(|asset| asset.fingerprint == fingerprint)
        .unwrap();
    let restored = parse_font_file(asset.local_path.unwrap()).unwrap();
    assert_eq!(restored.fingerprint, parsed.fingerprint);
    assert_eq!(restored.faces[1].face_index, 1);
    delete_everywhere(a.path(), &fingerprint).unwrap();
    assert_eq!(a.load_cached_catalog().unwrap().face_count(), 1);
    exchange(&mut a, &first, &remote).await;
    exchange(&mut b, &second, &remote).await;
    assert_eq!(b.load_cached_catalog().unwrap().face_count(), 1);
    assert!(
        list_cloud_fonts(b.path())
            .unwrap()
            .iter()
            .find(|font| font.fingerprint == fingerprint)
            .unwrap()
            .deleted
    );
    restore_deleted_font(b.path(), &fingerprint).unwrap();
    exchange(&mut b, &second, &remote).await;
    exchange(&mut a, &first, &remote).await;
    assert_eq!(b.load_cached_catalog().unwrap().face_count(), 1);
    request_restore(b.path(), &fingerprint).unwrap();
    request_restore(a.path(), &fingerprint).unwrap();
    exchange(&mut b, &second, &remote).await;
    exchange(&mut a, &first, &remote).await;
    for db in [&a, &b] {
        assert_eq!(db.load_cached_catalog().unwrap().face_count(), 3);
        assert_eq!(db.list_favorites().unwrap(), vec![ids[1]]);
        assert_eq!(db.list_collection_members(collection.id).unwrap().len(), 2);
        assert_eq!(db.list_recent(100).unwrap()[0].identity_id, ids[1]);
        let variable = db
            .list_sync_assets()
            .unwrap()
            .into_iter()
            .find(|asset| asset.extension == "ttf")
            .unwrap();
        assert!(
            !parse_font_file(variable.local_path.unwrap()).unwrap().faces[0]
                .metadata
                .variable_axes
                .is_empty()
        );
    }
}

#[tokio::test]
async fn cancellation_after_a_download_keeps_real_catalog_and_retry_completes() {
    let server = DavServer::start();
    let remote = server.client("p");
    let temporary = tempfile::tempdir().unwrap();
    let first = temporary.path().join("first");
    let second = temporary.path().join("second");
    std::fs::create_dir_all(&first).unwrap();
    for name in ["Lato-Regular.ttf", "Inter-Variable.ttf"] {
        std::fs::copy(sample(name), first.join(name)).unwrap();
    }
    let mut a = FolioDatabase::open(temporary.path().join("a.sqlite")).unwrap();
    let mut b = FolioDatabase::open(temporary.path().join("b.sqlite")).unwrap();
    exchange(&mut a, &first, &remote).await;
    set_automatic_download(b.path(), true).unwrap();
    let cancelled = Arc::new(AtomicBool::new(false));
    let signal = cancelled.clone();
    let report: Arc<dyn Fn(SyncProgress) + Send + Sync> = Arc::new(move |progress| {
        if progress.downloaded_files == 1 {
            signal.store(true, Ordering::Relaxed);
        }
    });
    let result =
        synchronize_with_client(&mut b, &second, &profile(), &remote, &cancelled, &report).await;
    assert!(matches!(result, Err(SyncError::Cancelled)));
    assert_eq!(b.load_cached_catalog().unwrap().face_count(), 1);
    assert_eq!(exchange(&mut b, &second, &remote).await.downloaded_files, 0);
    for policy in b.file_policies().unwrap() {
        if policy.transfer_status.as_deref() == Some("cancelled") {
            request_restore(b.path(), &policy.fingerprint).unwrap();
        }
    }
    assert_eq!(exchange(&mut b, &second, &remote).await.downloaded_files, 1);
    assert_eq!(b.load_cached_catalog().unwrap().face_count(), 2);
    let report: Arc<dyn Fn(SyncProgress) + Send + Sync> = Arc::new(|_| {});
    let result = synchronize_with_client(
        &mut b,
        &second,
        &profile(),
        &server.client("wrong"),
        &AtomicBool::new(false),
        &report,
    )
    .await;
    assert!(matches!(result, Err(SyncError::Authentication)));
    assert_eq!(b.load_cached_catalog().unwrap().face_count(), 2);
}

#[tokio::test]
async fn all_collection_conflict_resolutions_converge_across_mobile_and_desktop() {
    for resolution in [
        ConflictResolution::KeepBoth,
        ConflictResolution::UseLocal,
        ConflictResolution::UseRemote,
    ] {
        let server = DavServer::start();
        let remote = server.client("p");
        let temporary = tempfile::tempdir().unwrap();
        let mut a = FolioDatabase::open(temporary.path().join("a.sqlite")).unwrap();
        let mut b = FolioDatabase::open(temporary.path().join("b.sqlite")).unwrap();
        let first = temporary.path().join("a");
        let second = temporary.path().join("b");
        let original = a.create_collection("原名称").unwrap();
        exchange(&mut a, &first, &remote).await;
        exchange(&mut b, &second, &remote).await;
        a.update_collection(
            original.id,
            "桌面版",
            CollectionIcon::Heart,
            CollectionColor::Blue,
        )
        .unwrap();
        b.update_collection(
            original.id,
            "移动版",
            CollectionIcon::Books,
            CollectionColor::Purple,
        )
        .unwrap();
        exchange(&mut a, &first, &remote).await;
        exchange(&mut b, &second, &remote).await;
        let conflict = list_conflicts(b.path()).unwrap().remove(0);
        resolve_conflict(b.path(), &conflict.id, resolution).unwrap();
        exchange(&mut b, &second, &remote).await;
        exchange(&mut a, &first, &remote).await;
        let names = a
            .list_collections()
            .unwrap()
            .into_iter()
            .map(|c| c.name)
            .collect::<BTreeSet<_>>();
        match resolution {
            ConflictResolution::KeepBoth => assert_eq!(names.len(), 2),
            ConflictResolution::UseLocal => {
                assert_eq!(names, ["移动版".to_owned()].into_iter().collect())
            }
            ConflictResolution::UseRemote => {
                assert_eq!(names, ["桌面版".to_owned()].into_iter().collect())
            }
        }
        assert!(list_conflicts(b.path()).unwrap().is_empty());
    }
}

#[tokio::test]
async fn font_revision_decisions_keep_both_or_remove_the_selected_other_version() {
    for resolution in [
        ConflictResolution::KeepBoth,
        ConflictResolution::UseLocal,
        ConflictResolution::UseRemote,
    ] {
        let server = DavServer::start();
        let remote = server.client("p");
        let temporary = tempfile::tempdir().unwrap();
        let first = temporary.path().join("desktop");
        let second = temporary.path().join("mobile");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::copy(sample("Lato-Regular.ttf"), first.join("original.ttf")).unwrap();
        let original = parse_font_file(first.join("original.ttf")).unwrap();
        let mut a = FolioDatabase::open(temporary.path().join("desktop.sqlite")).unwrap();
        let mut b = FolioDatabase::open(temporary.path().join("mobile.sqlite")).unwrap();
        exchange(&mut a, &first, &remote).await;
        exchange(&mut b, &second, &remote).await;
        let mut variant = std::fs::read(sample("Lato-Regular.ttf")).unwrap();
        let tables = u16::from_be_bytes(variant[4..6].try_into().unwrap());
        for table in 0..tables as usize {
            let record = 12 + table * 16;
            if &variant[record..record + 4] == b"head" {
                let offset =
                    u32::from_be_bytes(variant[record + 8..record + 12].try_into().unwrap())
                        as usize;
                for salt in 1..=255 {
                    variant[offset + 8] = salt;
                    if ContentFingerprint::from_bytes(&variant).to_hex()
                        < original.fingerprint.to_hex()
                    {
                        break;
                    }
                }
            }
        }
        std::fs::write(first.join("variant.ttf"), variant).unwrap();
        let variant = parse_font_file(first.join("variant.ttf")).unwrap();
        assert_eq!(original.faces[0].identity.id, variant.faces[0].identity.id);
        exchange(&mut a, &first, &remote).await;
        exchange(&mut b, &second, &remote).await;
        let conflict = list_conflicts(b.path()).unwrap().remove(0);
        assert_eq!(
            conflict.local_fingerprint.as_ref(),
            Some(&original.fingerprint.to_hex())
        );
        assert_eq!(
            conflict.remote_fingerprint.as_ref(),
            Some(&variant.fingerprint.to_hex())
        );
        resolve_conflict(b.path(), &conflict.id, resolution).unwrap();
        exchange(&mut b, &second, &remote).await;
        exchange(&mut a, &first, &remote).await;
        let active = list_cloud_fonts(a.path())
            .unwrap()
            .into_iter()
            .filter(|font| !font.deleted)
            .map(|font| font.fingerprint)
            .collect::<BTreeSet<_>>();
        match resolution {
            ConflictResolution::KeepBoth => assert_eq!(active.len(), 2),
            ConflictResolution::UseLocal => assert_eq!(
                active,
                [original.fingerprint.to_hex()].into_iter().collect()
            ),
            ConflictResolution::UseRemote => {
                assert_eq!(active, [variant.fingerprint.to_hex()].into_iter().collect())
            }
        }
        assert!(list_conflicts(b.path()).unwrap().is_empty());
    }
}

// 默认按需、精确单文件任务与多来源位置在独立双设备目录中验收。
#[tokio::test]
async fn on_demand_library_queries_and_file_policies_survive_rebuilds() {
    let server = DavServer::start();
    let remote = server.client("p");
    let temporary = tempfile::tempdir().unwrap();
    let first = temporary.path().join("a/ManagedFonts");
    let second = temporary.path().join("b/ManagedFonts");
    let reference = temporary.path().join("references");
    for directory in [&first, &second, &reference] {
        std::fs::create_dir_all(directory).unwrap();
    }
    for name in ["Lato-Regular.ttf", "Lato-Bold.ttf"] {
        std::fs::copy(sample(name), first.join(name)).unwrap();
    }
    let mut a = FolioDatabase::open(temporary.path().join("a/folio.sqlite")).unwrap();
    let mut b = FolioDatabase::open(temporary.path().join("b/folio.sqlite")).unwrap();
    let report: Arc<dyn Fn(SyncProgress) + Send + Sync> = Arc::new(|_| {});
    let cancel = AtomicBool::new(false);
    synchronize_with_client(&mut a, &first, &profile(), &remote, &cancel, &report)
        .await
        .unwrap();
    let result = synchronize_with_client(&mut b, &second, &profile(), &remote, &cancel, &report)
        .await
        .unwrap();
    assert_eq!(result.downloaded_files, 0);
    assert!(b.load_cached_catalog().unwrap().families.is_empty());
    assert!(!automatic_download(b.path()).unwrap());
    let library = unified_library(&b, &b.load_cached_catalog().unwrap()).unwrap();
    assert_eq!(library.recognized_family_count(), 1);
    assert_eq!(library.catalog.face_count(), 2);
    let face = library
        .catalog
        .faces()
        .find(|face| face.metadata.subfamily_name.as_deref() == Some("Regular"))
        .unwrap();
    let identity = face.identity_id;
    let id = face.id;
    let fingerprint = library.locations[&id].files[0].fingerprint.clone();
    b.set_favorite(identity, true).unwrap();
    let collection = b.create_collection("按需收藏").unwrap();
    b.add_collection_members(collection.id, &[identity])
        .unwrap();
    let index = library.index(&mut b).unwrap();
    let query = folio_query::FontQuery {
        text: Some("Lato".to_owned()),
        limit: Some(1),
        ..Default::default()
    };
    assert_eq!(
        index
            .query_with_location(&query, None, "cloudOnly", None)
            .unwrap()
            .total_matches,
        1
    );
    assert_eq!(
        index
            .query(&folio_query::FontQuery {
                scope: folio_query::QueryScope::Favorites,
                ..Default::default()
            })
            .unwrap()
            .total_matches,
        1
    );
    request_restore(b.path(), &fingerprint).unwrap();
    request_restore(b.path(), &fingerprint).unwrap();
    assert_eq!(
        b.file_policy(&fingerprint)
            .unwrap()
            .transfer_status
            .as_deref(),
        Some("pending")
    );
    let result = synchronize_with_client(&mut b, &second, &profile(), &remote, &cancel, &report)
        .await
        .unwrap();
    assert_eq!(result.downloaded_files, 1);
    let library = unified_library(&b, &b.load_cached_catalog().unwrap()).unwrap();
    assert_eq!(library.catalog.face_count(), 2);
    assert_eq!(
        library
            .locations
            .values()
            .filter(|location| location.local_available)
            .count(),
        1
    );
    let downloaded = library.locations[&id].files[0].local_sources[0]
        .path
        .clone();
    let external = reference.join("same.ttf");
    std::fs::copy(&downloaded, &external).unwrap();
    b.add_root(&reference, true).unwrap();
    b.refresh(RefreshMode::Incremental).unwrap();
    assert_eq!(
        unified_library(&b, &b.load_cached_catalog().unwrap())
            .unwrap()
            .locations[&id]
            .files[0]
            .local_sources
            .len(),
        2
    );
    let mut asset = b
        .list_sync_assets()
        .unwrap()
        .into_iter()
        .find(|asset| asset.fingerprint == fingerprint)
        .unwrap();
    asset.local_path = None;
    let mut legacy: RemoteAsset = serde_json::from_str(&asset.remote_payload).unwrap();
    for face in &mut legacy.faces {
        face.details = None;
    }
    asset.remote_payload = serde_json::to_string(&legacy).unwrap();
    b.upsert_sync_asset(&asset).unwrap();
    set_cloud_only(b.path(), &fingerprint).unwrap();
    let enriched = b
        .list_sync_assets()
        .unwrap()
        .into_iter()
        .find(|asset| asset.fingerprint == fingerprint)
        .unwrap();
    assert!(
        serde_json::from_str::<RemoteAsset>(&enriched.remote_payload)
            .unwrap()
            .faces
            .iter()
            .all(|face| face.details.is_some())
    );
    assert!(external.is_file());
    assert!(!Path::new(&downloaded).exists());
    assert!(
        !list_cloud_fonts(b.path())
            .unwrap()
            .iter()
            .find(|font| font.fingerprint == fingerprint)
            .unwrap()
            .cloud_only
    );
    set_automatic_download(b.path(), true).unwrap();
    let result = synchronize_with_client(&mut b, &second, &profile(), &remote, &cancel, &report)
        .await
        .unwrap();
    assert_eq!(result.uploaded_files, 0);
    assert!(!Path::new(&downloaded).exists());
    b.clear_catalog_cache().unwrap();
    b.refresh(RefreshMode::Incremental).unwrap();
    assert_eq!(
        b.file_policy(&fingerprint).unwrap().download_policy,
        "cloud"
    );
    assert!(
        unified_library(&b, &b.load_cached_catalog().unwrap())
            .unwrap()
            .locations[&id]
            .local_available
    );
    let excluded = first.join("private.ttf");
    std::fs::copy(sample("Inter-Variable.ttf"), &excluded).unwrap();
    a.refresh(RefreshMode::Incremental).unwrap();
    let hash = parse_font_file(&excluded).unwrap().fingerprint.to_hex();
    let twin = first.join("private-twin.ttf");
    std::fs::copy(&excluded, &twin).unwrap();
    a.refresh(RefreshMode::Incremental).unwrap();
    set_upload_excluded(a.path(), &hash, true).unwrap();
    synchronize_with_client(&mut a, &first, &profile(), &remote, &cancel, &report)
        .await
        .unwrap();
    assert!(!list_cloud_fonts(a.path())
        .unwrap()
        .iter()
        .any(|font| font.fingerprint == hash));
    std::fs::copy(sample("SourceSerif4-Regular.otf"), &excluded).unwrap();
    a.clear_catalog_cache().unwrap();
    a.refresh(RefreshMode::Incremental).unwrap();
    let preview = unified_library(&a, &a.load_cached_catalog().unwrap()).unwrap();
    assert!(preview
        .locations
        .values()
        .any(|location| location.state == "excluded"));
    synchronize_with_client(&mut a, &first, &profile(), &remote, &cancel, &report)
        .await
        .unwrap();
    let changed = parse_font_file(&excluded).unwrap().fingerprint.to_hex();
    assert!(a.file_policy(&changed).unwrap().upload_excluded);
    assert!(!list_cloud_fonts(a.path())
        .unwrap()
        .iter()
        .any(|font| font.fingerprint == changed));
    set_upload_excluded(a.path(), &changed, false).unwrap();
    synchronize_with_client(&mut a, &first, &profile(), &remote, &cancel, &report)
        .await
        .unwrap();
    assert!(
        list_cloud_fonts(a.path())
            .unwrap()
            .iter()
            .any(|font| font.fingerprint == changed),
        "policy {:?}; readable {:?}",
        a.file_policy(&changed).unwrap(),
        a.readable_font_files().unwrap()
    );
}

#[tokio::test]
async fn invalid_download_preserves_cloud_directory_and_individual_retry() {
    let server = DavServer::start();
    let remote = server.client("p");
    let temporary = tempfile::tempdir().unwrap();
    let first = temporary.path().join("first");
    let second = temporary.path().join("second");
    std::fs::create_dir_all(&first).unwrap();
    let bytes = std::fs::read(sample("Lato-Regular.ttf")).unwrap();
    std::fs::write(first.join("Lato.ttf"), &bytes).unwrap();
    let hash = ContentFingerprint::from_bytes(&bytes).to_hex();
    let mut a = FolioDatabase::open(temporary.path().join("a.sqlite")).unwrap();
    let mut b = FolioDatabase::open(temporary.path().join("b.sqlite")).unwrap();
    let report: Arc<dyn Fn(SyncProgress) + Send + Sync> = Arc::new(|_| {});
    let cancel = AtomicBool::new(false);
    synchronize_with_client(&mut a, &first, &profile(), &remote, &cancel, &report)
        .await
        .unwrap();
    synchronize_with_client(&mut b, &second, &profile(), &remote, &cancel, &report)
        .await
        .unwrap();
    request_restore(b.path(), &hash).unwrap();
    server.replace_object(&hash, vec![0, 1]);
    synchronize_with_client(&mut b, &second, &profile(), &remote, &cancel, &report)
        .await
        .unwrap();
    assert_eq!(
        b.file_policy(&hash).unwrap().transfer_status.as_deref(),
        Some("failed")
    );
    assert!(b.sync_metadata("last_directory_sync_ms").unwrap().is_some());
    let library = unified_library(&b, &b.load_cached_catalog().unwrap()).unwrap();
    assert_eq!(library.catalog.face_count(), 1);
    assert!(!library.locations.values().next().unwrap().local_available);
    server.replace_object(&hash, bytes);
    request_restore(b.path(), &hash).unwrap();
    let result = synchronize_with_client(&mut b, &second, &profile(), &remote, &cancel, &report)
        .await
        .unwrap();
    assert_eq!(result.downloaded_files, 1);
    assert_eq!(
        b.file_policy(&hash).unwrap().transfer_status.as_deref(),
        Some("done")
    );
    assert!(
        unified_library(&b, &b.load_cached_catalog().unwrap())
            .unwrap()
            .locations
            .values()
            .next()
            .unwrap()
            .local_available
    );
}

// 集合按一个文件传输，字族分页与成员定位使用真实索引。
#[tokio::test]
async fn collection_members_share_one_download_and_keep_distinct_families() {
    let server = DavServer::start();
    let remote = server.client("p");
    let temporary = tempfile::tempdir().unwrap();
    let first = temporary.path().join("a/ManagedFonts");
    let second = temporary.path().join("b/ManagedFonts");
    std::fs::create_dir_all(&first).unwrap();
    std::fs::create_dir_all(&second).unwrap();
    let fonts = [
        std::fs::read(sample("Lato-Regular.ttf")).unwrap(),
        std::fs::read(sample("Inter-Variable.ttf")).unwrap(),
    ];
    let mut bytes = b"ttcf\0\x01\0\0".to_vec();
    bytes.extend_from_slice(&2u32.to_be_bytes());
    bytes.resize(20, 0);
    for (index, font) in fonts.iter().enumerate() {
        let base = bytes.len() as u32;
        bytes[12 + index * 4..16 + index * 4].copy_from_slice(&base.to_be_bytes());
        let mut member = font.clone();
        let count = u16::from_be_bytes(font[4..6].try_into().unwrap()) as usize;
        for table in 0..count {
            let record = 12 + table * 16;
            let offset = u32::from_be_bytes(font[record + 8..record + 12].try_into().unwrap());
            if &font[record..record + 4] == b"head" {
                member[offset as usize + 8..offset as usize + 12].fill(0);
            }
            member[record + 8..record + 12].copy_from_slice(&(offset + base).to_be_bytes());
        }
        bytes.extend(member);
        bytes.resize(bytes.len().next_multiple_of(4), 0);
    }
    std::fs::write(first.join("collection.ttc"), &bytes).unwrap();
    let hash = ContentFingerprint::from_bytes(&bytes).to_hex();
    let mut a = FolioDatabase::open(temporary.path().join("a/folio.sqlite")).unwrap();
    let mut b = FolioDatabase::open(temporary.path().join("b/folio.sqlite")).unwrap();
    let report: Arc<dyn Fn(SyncProgress) + Send + Sync> = Arc::new(|_| {});
    let cancel = AtomicBool::new(false);
    synchronize_with_client(&mut a, &first, &profile(), &remote, &cancel, &report)
        .await
        .unwrap();
    synchronize_with_client(&mut b, &second, &profile(), &remote, &cancel, &report)
        .await
        .unwrap();
    let library = unified_library(&b, &b.load_cached_catalog().unwrap()).unwrap();
    assert_eq!(library.recognized_family_count(), 2);
    let index = library.index(&mut b).unwrap();
    let query = folio_query::FontQuery {
        limit: Some(1),
        ..Default::default()
    };
    let page = index
        .query_with_location(&query, None, "cloudOnly", Some(&hash))
        .unwrap();
    assert_eq!(page.total_matches, 2);
    assert_eq!(page.families.len(), 1);
    let indexes = library
        .locations
        .values()
        .map(|location| location.files[0].face_index)
        .collect::<BTreeSet<_>>();
    assert_eq!(indexes, [0, 1].into_iter().collect());
    request_restore(b.path(), &hash).unwrap();
    let result = synchronize_with_client(&mut b, &second, &profile(), &remote, &cancel, &report)
        .await
        .unwrap();
    assert_eq!(result.downloaded_files, 1);
    let library = unified_library(&b, &b.load_cached_catalog().unwrap()).unwrap();
    assert_eq!(library.catalog.family_count(), 2);
    assert!(library
        .locations
        .values()
        .all(|location| location.state == "both"));
    assert_eq!(list_cloud_fonts(b.path()).unwrap().len(), 1);
}
