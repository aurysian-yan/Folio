use super::*;

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
    let fingerprint = "ab".repeat(32);
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
