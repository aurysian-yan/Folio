//! 针对真实字体目录的刷新冒烟工具。
//!
//! ```sh
//! cargo run -p folio-storage --example refresh_smoke -- <db-path> <font-dir>
//! ```
//!
//! 连续执行两次增量刷新，并以紧凑 JSON 打印各自统计，便于检查第二次是否
//! 走快路径。两次调用之间 touch 或修改字体现可覆盖元数据与内容快路径。

use std::path::PathBuf;
use std::process::ExitCode;

use folio_storage::{AddRootOutcome, FolioDatabase, RefreshMode, RefreshResult};

fn main() -> ExitCode {
    let mut args = std::env::args_os().skip(1);
    let (Some(db_path), Some(font_dir)) = (args.next(), args.next()) else {
        eprintln!("usage: refresh_smoke <db-path> <font-dir>");
        return ExitCode::FAILURE;
    };
    let db_path = PathBuf::from(db_path);
    let font_dir = PathBuf::from(font_dir);

    match run(&db_path, &font_dir) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("refresh_smoke: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run(db_path: &PathBuf, font_dir: &PathBuf) -> Result<(), folio_storage::StorageError> {
    let mut db = FolioDatabase::open(db_path)?;
    match db.add_root(font_dir, true)? {
        AddRootOutcome::Created(root) => {
            println!("added library root {} -> {}", root.id, root.display_path);
        }
        AddRootOutcome::Existing(root) => {
            println!(
                "library root already present {} -> {}",
                root.id, root.display_path
            );
        }
    }

    for pass in 1..=2 {
        let result = db.refresh(RefreshMode::Incremental)?;
        println!("pass {pass}: {}", summary(&result));
    }
    Ok(())
}

fn summary(result: &RefreshResult) -> String {
    let stats = &result.stats;
    format!(
        concat!(
            "{{\"candidate_files\":{candidates},\"metadata_cache_hits\":{metadata},",
            "\"files_hashed\":{hashed},\"content_cache_hits\":{content},",
            "\"files_reparsed\":{reparsed},\"files_added\":{added},",
            "\"files_changed\":{changed},\"files_removed\":{removed},",
            "\"known_unsupported\":{unsupported},\"malformed\":{malformed},",
            "\"failed\":{failed},\"unstable\":{unstable},\"faces\":{faces},",
            "\"issues\":{issues},\"families\":{families}}}"
        ),
        candidates = stats.candidate_files,
        metadata = stats.metadata_cache_hits,
        hashed = stats.files_hashed,
        content = stats.content_cache_hits,
        reparsed = stats.files_reparsed,
        added = stats.files_added,
        changed = stats.files_changed,
        removed = stats.files_removed,
        unsupported = stats.known_unsupported,
        malformed = stats.malformed_files,
        failed = stats.failed_files,
        unstable = stats.unstable_files,
        faces = result.catalog.face_count(),
        issues = result.issues.len(),
        families = result.catalog.family_count(),
    )
}
