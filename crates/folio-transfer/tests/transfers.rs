use folio_transfer::{OnlineOrigin, TransferService};
use std::{fs, io::Write, path::Path};

fn service(root: &Path) -> TransferService {
    TransferService::open(root.join("folio.sqlite"), root.join("downloads")).unwrap()
}

fn create(service: &TransferService) -> String {
    service
        .create(
            "https://example.com/font?token=secret",
            "font.zip",
            OnlineOrigin {
                provider_id: Some("example".into()),
                provider_name: "字体来源".into(),
                source_page_url: "https://example.com/page?token=secret#auth".into(),
                download_host: "ignored".into(),
            },
        )
        .unwrap()
        .id
}

fn archive(service: &TransferService, id: &str, names: &[&str]) {
    let mut zip = zip::ZipWriter::new(fs::File::create(service.path(id).unwrap()).unwrap());
    for name in names {
        zip.start_file(
            *name,
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored),
        )
        .unwrap();
        zip.write_all(b"test-font-content").unwrap();
    }
    zip.finish().unwrap();
    service.finish(id).unwrap();
}

#[test]
fn queue_survives_reopen_without_persisting_signed_urls() {
    let root = tempfile::tempdir().unwrap();
    let service = service(root.path());
    let id = create(&service);
    service.progress(&id, 42, Some(100)).unwrap();
    drop(service);
    let reopened = self::service(root.path());
    let job = reopened.job(&id).unwrap();
    assert_eq!(job.bytes_done, 42);
    assert_eq!(job.state, "transferring");
    assert_eq!(job.origin.source_page_url, "https://example.com/page");
    assert_eq!(job.origin.download_host, "example.com");
    assert!(!serde_json::to_string(&job).unwrap().contains("secret"));
}

#[test]
fn late_progress_and_completion_cannot_resurrect_cancelled_download() {
    let root = tempfile::tempdir().unwrap();
    let service = service(root.path());
    let id = create(&service);
    service.progress(&id, 2, None).unwrap();
    service.discard(&id).unwrap();
    assert!(service.progress(&id, 3, None).is_err());
    assert!(service.finish(&id).is_err());
    assert!(service.state(&id, "failed", None).is_err());
    assert!(service.state(&id, "queued", None).is_err());
    assert_eq!(service.job(&id).unwrap().state, "cancelled");
    assert!(!service.path(&id).unwrap().parent().unwrap().exists());
}

#[test]
fn callbacks_from_an_earlier_attempt_cannot_replace_a_retry() {
    let root = tempfile::tempdir().unwrap();
    let service = service(root.path());
    let id = create(&service);
    service.progress_for_attempt(&id, 2, None, 0).unwrap();
    service.state(&id, "paused", None).unwrap();
    service.state(&id, "queued", None).unwrap();
    assert_eq!(service.job(&id).unwrap().generation, 1);
    assert!(service.progress_for_attempt(&id, 3, None, 0).is_err());
    assert!(service.state_for_attempt(&id, "failed", None, 0).is_err());
    assert!(service.finish_for_attempt(&id, 0).is_err());
    assert_eq!(service.job(&id).unwrap().state, "queued");
    service.progress_for_attempt(&id, 3, None, 1).unwrap();
}

#[test]
fn archive_traversal_is_rejected_before_extracting_any_entry() {
    for name in [
        "../outside.ttf",
        "/absolute.ttf",
        "C:/font.ttf",
        "folder\\font.ttf",
    ] {
        let root = tempfile::tempdir().unwrap();
        let service = service(root.path());
        let id = create(&service);
        archive(&service, &id, &["valid.ttf", name]);
        assert!(service.inspect_archive(&id).is_err(), "{name}");
        assert!(!service
            .path(&id)
            .unwrap()
            .parent()
            .unwrap()
            .join("entries")
            .exists());
    }
}

#[test]
fn archive_only_extracts_font_candidates_under_generated_names() {
    let root = tempfile::tempdir().unwrap();
    let service = service(root.path());
    let id = create(&service);
    archive(
        &service,
        &id,
        &[
            "folder/font.ttf",
            "script.js",
            "nested.zip",
            "other/FONT.OTF",
        ],
    );
    let entries = service.inspect_archive(&id).unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].name, "folder/font.ttf");
    for entry in entries {
        assert!(Path::new(&entry.path).starts_with(
            root.path()
                .canonicalize()
                .unwrap()
                .join("downloads")
                .join(&id)
                .join("entries")
        ));
    }
    service.state(&id, "completed", None).unwrap();
    service.discard(&id).unwrap();
    assert_eq!(service.job(&id).unwrap().state, "cancelled");
}

#[test]
fn html_and_invalid_font_content_are_never_ready() {
    let root = tempfile::tempdir().unwrap();
    let service = service(root.path());
    let id = create(&service);
    fs::write(service.path(&id).unwrap(), b"<html>sign in</html>").unwrap();
    assert!(service.finish(&id).is_err());
    assert_ne!(service.job(&id).unwrap().state, "ready");
}

#[test]
fn font_detection_uses_content_instead_of_download_filename() {
    let root = tempfile::tempdir().unwrap();
    let service = service(root.path());
    let id = create(&service);
    let sample = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../experiments/mobile/samples/Lato-Regular.ttf");
    fs::copy(sample, service.path(&id).unwrap()).unwrap();
    let job = service.finish(&id).unwrap();
    assert_eq!(job.kind.as_deref(), Some("font"));
    assert_eq!(job.name, "font.ttf");
    assert_eq!(job.content_hash.as_ref().unwrap().len(), 64);
}

#[test]
fn export_names_fit_file_system_limits_without_splitting_unicode() {
    let name = folio_transfer::safe_name(&"字体".repeat(180));
    assert!(!name.is_empty());
    assert!(name.len() <= 180);
    assert!(name.chars().all(|value| value == '字' || value == '体'));
    assert_eq!(folio_transfer::safe_name("../font\r\n.ttf "), "font.ttf");
}

#[tokio::test]
#[ignore = "需要访问公开 HTTPS 字体文件"]
async fn public_https_font_download_passes_dns_transfer_and_content_validation() {
    let root = tempfile::tempdir().unwrap();
    let service = service(root.path());
    let url = "https://raw.githubusercontent.com/google/fonts/main/ofl/lato/Lato-Regular.ttf";
    let job = service
        .create(
            url,
            "download",
            OnlineOrigin {
                provider_id: Some("test".into()),
                provider_name: "公开测试字体".into(),
                source_page_url: "https://github.com/google/fonts/tree/main/ofl/lato".into(),
                download_host: String::new(),
            },
        )
        .unwrap();
    tokio::time::timeout(
        std::time::Duration::from_secs(60),
        service.download(&job.id, url, "{}"),
    )
    .await
    .unwrap()
    .unwrap();
    let job = service.job(&job.id).unwrap();
    assert_eq!(job.state, "ready");
    assert_eq!(job.name, "download.ttf");
    assert!(job.bytes_done > 0);
    let parsed = folio_core::parse_font_file(service.path(&job.id).unwrap()).unwrap();
    assert!(!parsed.faces.is_empty());
    assert_eq!(
        job.content_hash.as_deref(),
        Some(parsed.fingerprint.to_hex().as_str())
    );
}
