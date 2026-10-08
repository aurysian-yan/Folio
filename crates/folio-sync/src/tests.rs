use super::*;

#[test]
fn font_locations_are_independent_of_sync_tasks_and_font_families() {
    let root = tempfile::tempdir().unwrap();
    let managed = root.path().join("ManagedFonts");
    let system = root.path().join("SystemFonts");
    std::fs::create_dir_all(&managed).unwrap();
    std::fs::create_dir_all(&system).unwrap();
    let samples = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/fonts");
    for name in ["Lato-Regular.ttf", "Lato-Bold.ttf"] {
        std::fs::copy(samples.join(name), managed.join(name)).unwrap();
    }
    std::fs::copy(
        samples.join("Lato-Regular.ttf"),
        managed.join("duplicate.ttf"),
    )
    .unwrap();
    std::fs::copy(samples.join("Inter-Variable.ttf"), system.join("Inter.ttf")).unwrap();
    std::fs::copy(samples.join("not-a-font.ttf"), managed.join("damaged.ttf")).unwrap();
    let mut db = FolioDatabase::open(root.path().join("folio.sqlite")).unwrap();
    db.add_root(&managed, true).unwrap();
    db.add_root(&system, true).unwrap();
    db.refresh(folio_storage::RefreshMode::Incremental).unwrap();
    let summary = font_sync_summary(&db, &managed).unwrap();
    assert_eq!(summary.local_only_fingerprints.len(), 2);
    assert_eq!(summary.synced_count, 0);
    assert_eq!(summary.cloud_only_count, 0);

    // 未发布的同步记录仍为仅本地，不能提前计入云字体库。
    std::fs::remove_file(managed.join("damaged.ttf")).unwrap();
    stage_managed_fonts(&mut db, &managed).unwrap();
    assert_eq!(font_sync_summary(&db, &managed).unwrap(), summary);
    assert!(list_cloud_fonts(db.path()).unwrap().is_empty());
    for event in db.list_sync_events().unwrap() {
        db.mark_sync_event_published(&event.id).unwrap();
    }
    let summary = font_sync_summary(&db, &managed).unwrap();
    assert_eq!(summary.synced_count, 2);
    assert!(summary.local_only_fingerprints.is_empty());

    // 本地副本丢失后仅在云端可用，最近删除不计入活动字体。
    for name in ["Lato-Regular.ttf", "duplicate.ttf"] {
        std::fs::remove_file(managed.join(name)).unwrap();
    }
    let summary = font_sync_summary(&db, &managed).unwrap();
    assert_eq!(summary.synced_count, 1);
    assert_eq!(summary.cloud_only_count, 1);
    let mut deleted = db
        .list_sync_assets()
        .unwrap()
        .into_iter()
        .find(|asset| asset.filename == "Lato-Bold.ttf")
        .unwrap();
    deleted.deleted = true;
    db.upsert_sync_asset(&deleted).unwrap();
    assert_eq!(font_sync_summary(&db, &managed).unwrap().synced_count, 0);
}

fn event(id: &str, change: Change) -> (StoredSyncEvent, Change) {
    (
        StoredSyncEvent {
            id: id.to_owned(),
            device_id: id[..32].to_owned(),
            sequence: 1,
            payload: String::new(),
            published: true,
        },
        change,
    )
}

#[test]
fn switching_away_and_back_never_reuses_remote_device_identity() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("folio.sqlite");
    let profile = |server_url: &str| SyncProfile {
        server_url: server_url.to_owned(),
        remote_directory: "Folio".to_owned(),
        username: "user".to_owned(),
        automatic: false,
    };
    save_profile(&path, &profile("https://a.example.test/dav")).unwrap();
    let mut db = FolioDatabase::open(&path).unwrap();
    let first = db.append_sync_event("{}").unwrap();
    drop(db);
    save_profile(&path, &profile("https://b.example.test/dav")).unwrap();
    let mut db = FolioDatabase::open(&path).unwrap();
    let second = db.append_sync_event("{}").unwrap();
    drop(db);
    save_profile(&path, &profile("https://a.example.test/dav")).unwrap();
    let mut db = FolioDatabase::open(&path).unwrap();
    let third = db.append_sync_event("{}").unwrap();
    assert_ne!(first.device_id, second.device_id);
    assert_ne!(first.device_id, third.device_id);
    assert_ne!(second.device_id, third.device_id);
    assert_eq!(third.sequence, 1);
}

#[test]
fn observed_remove_keeps_concurrent_favorite_add() {
    let identity = "11".repeat(16);
    let a = "aa".repeat(16);
    let b = "bb".repeat(16);
    let first = format!("{a}-00000000000000000001");
    let concurrent = format!("{b}-00000000000000000001");
    let changes = vec![
        event(
            &first,
            Change::FavoriteAdded {
                identity_id: identity.clone(),
            },
        ),
        event(
            &format!("{a}-00000000000000000002"),
            Change::FavoriteRemoved {
                identity_id: identity.clone(),
                observed_adds: vec![first],
            },
        ),
        event(
            &concurrent,
            Change::FavoriteAdded {
                identity_id: identity.clone(),
            },
        ),
    ];
    assert_eq!(favorite_add_tags(&changes, &identity), vec![concurrent]);
}

#[test]
fn concurrent_collection_edits_remain_separate_heads() {
    let id = "11".repeat(16);
    let a = "aa".repeat(16);
    let b = "bb".repeat(16);
    let base = format!("{a}-00000000000000000001");
    let local = format!("{a}-00000000000000000002");
    let remote = format!("{b}-00000000000000000001");
    let collection = WireCollection {
        id: id.clone(),
        name: "字体".to_owned(),
        icon: "folder".to_owned(),
        color: "gray".to_owned(),
        created_at_ns: 1,
        updated_at_ns: 1,
    };
    let changes = vec![
        event(
            &base,
            Change::CollectionSet {
                collection: collection.clone(),
                parents: vec![],
            },
        ),
        event(
            &local,
            Change::CollectionSet {
                collection: WireCollection {
                    name: "本地".to_owned(),
                    ..collection.clone()
                },
                parents: vec![base.clone()],
            },
        ),
        event(
            &remote,
            Change::CollectionSet {
                collection: WireCollection {
                    name: "云端".to_owned(),
                    ..collection
                },
                parents: vec![base],
            },
        ),
    ];
    let heads = collection_heads(&changes, &id);
    assert_eq!(heads.len(), 2);
    assert!(heads.contains_key(&local));
    assert!(heads.contains_key(&remote));
}

#[test]
fn local_eviction_and_explicit_global_delete_are_distinct() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("folio.sqlite");
    let file = dir.path().join("font.otf");
    std::fs::write(&file, b"font").unwrap();
    let fingerprint = folio_core::ContentFingerprint::from_bytes(b"font").to_hex();
    let payload = serde_json::to_string(&RemoteAsset {
        fingerprint: fingerprint.clone(),
        filename: "font.otf".to_owned(),
        extension: "otf".to_owned(),
        file_size: 4,
        faces: vec![],
        online_origin: None,
    })
    .unwrap();
    let mut db = FolioDatabase::open(&path).unwrap();
    db.set_sync_metadata("managed_directory", &dir.path().to_string_lossy())
        .unwrap();
    db.upsert_sync_asset(&StoredSyncAsset {
        fingerprint: fingerprint.clone(),
        filename: "font.otf".to_owned(),
        extension: "otf".to_owned(),
        local_path: Some(file.to_string_lossy().into_owned()),
        remote_payload: payload,
        cloud_only: false,
        deleted: false,
    })
    .unwrap();
    stage_change(
        &mut db,
        &Change::FontAdded(RemoteAsset {
            fingerprint: fingerprint.clone(),
            filename: "font.otf".to_owned(),
            extension: "otf".to_owned(),
            file_size: 4,
            faces: vec![],
            online_origin: None,
        }),
    )
    .unwrap();
    assert!(list_cloud_fonts(&path).unwrap().is_empty());
    let event = db.list_sync_events().unwrap().remove(0);
    db.mark_sync_event_published(&event.id).unwrap();
    drop(db);
    set_cloud_only(&path, &fingerprint).unwrap();
    assert!(!file.exists());
    assert!(list_cloud_fonts(&path).unwrap()[0].cloud_only);
    assert_eq!(
        FolioDatabase::open(&path)
            .unwrap()
            .list_sync_events()
            .unwrap()
            .len(),
        1
    );
    request_restore(&path, &fingerprint).unwrap();
    assert!(
        !FolioDatabase::open(&path)
            .unwrap()
            .list_sync_assets()
            .unwrap()[0]
            .cloud_only
    );
    // 旧云记录的路径已被更新内容复用时，移除操作保留新文件。
    std::fs::write(&file, b"updated font").unwrap();
    let db = FolioDatabase::open(&path).unwrap();
    let mut asset = db.list_sync_assets().unwrap().remove(0);
    asset.local_path = Some(file.to_string_lossy().into_owned());
    db.upsert_sync_asset(&asset).unwrap();
    drop(db);
    set_cloud_only(&path, &fingerprint).unwrap();
    assert_eq!(std::fs::read(&file).unwrap(), b"updated font");
    delete_everywhere(&path, &fingerprint).unwrap();
    let db = FolioDatabase::open(&path).unwrap();
    assert_eq!(db.list_sync_events().unwrap().len(), 2);
    assert!(db.list_sync_assets().unwrap()[0].deleted);
}

#[test]
fn older_remote_asset_without_online_origin_is_compatible() {
    let asset: RemoteAsset = serde_json::from_str(
        r#"{"fingerprint":"ab","filename":"font.ttf","extension":"ttf","file_size":4,"faces":[]}"#,
    )
    .unwrap();
    assert!(asset.online_origin.is_none());
}

#[test]
fn online_origin_sidecar_round_trips() {
    let directory = tempfile::tempdir().unwrap();
    let origin = OnlineOrigin {
        provider: "Google Fonts".to_owned(),
        commit: "a".repeat(40),
        family: "Lato".to_owned(),
        style: "常规 · 正体".to_owned(),
        git_oid: "b".repeat(40),
        license: "OFL".to_owned(),
        license_text: "License text".to_owned(),
        source_url: "https://github.com/google/fonts".to_owned(),
        downloaded_via: "官方地址".to_owned(),
    };
    store_online_origin(directory.path(), "font.ttf", &origin).unwrap();
    assert_eq!(
        read_online_origins(directory.path()).unwrap()["font.ttf"],
        origin
    );
}

#[tokio::test]
async fn cancelled_transfer_stops_before_completion() {
    let cancelled = AtomicBool::new(true);
    let pending = std::future::pending::<Result<(), SyncError>>();
    assert!(matches!(
        run_or_cancel(pending, &cancelled).await,
        Err(SyncError::Cancelled)
    ));
}
