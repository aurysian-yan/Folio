//! 连续同步诊断：观察待重试下载是否在后续轮次完成。
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let password = std::env::var("FOLIO_PROBE_PASS").expect("FOLIO_PROBE_PASS");
    let db_path = std::env::var("FOLIO_PROBE_DB").expect("FOLIO_PROBE_DB");
    let managed = std::env::var("FOLIO_PROBE_MANAGED").expect("FOLIO_PROBE_MANAGED");
    for round in 0..4 {
        let report: Arc<dyn Fn(folio_sync::SyncProgress) + Send + Sync> = Arc::new(|_| {});
        match folio_sync::synchronize(
            &db_path,
            &managed,
            &password,
            Arc::new(AtomicBool::new(false)),
            report,
        )
        .await
        {
            Ok(progress) => println!(
                "round {round}: OK downloaded={} events={}",
                progress.downloaded_files, progress.published_events
            ),
            Err(error) => println!("round {round}: ERR {error:?}"),
        }
    }
    let count = std::fs::read_dir(&managed)
        .map(|entries| entries.filter_map(|e| e.ok()).count())
        .unwrap_or(0);
    println!("managed files = {count}");
}
