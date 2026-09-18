//! CLI 输出、退出状态及 JSON 稳定性验证。

use std::path::PathBuf;
use std::process::Command;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/fonts")
        .join(name)
}

#[test]
fn json_scan_is_complete_and_repeatable() {
    let run = || {
        Command::new(env!("CARGO_BIN_EXE_folio-cli"))
            .arg("scan-files")
            .arg(fixture("Lato-Regular.ttf"))
            .arg(fixture("Inter-Regular.woff"))
            .arg(fixture("Inter-Regular.woff2"))
            .arg("--json")
            .output()
            .unwrap()
    };
    let first = run();
    let second = run();
    assert!(first.status.success());
    assert!(second.status.success());
    assert!(first.stderr.is_empty());
    assert_eq!(first.stdout, second.stdout);
    let value: serde_json::Value = serde_json::from_slice(&first.stdout).unwrap();
    assert_eq!(value["stats"]["unsupported_known_font_files"], 2);
    assert_eq!(value["stats"]["failed_files"], 0);
    assert_eq!(value["stats"]["faces_parsed"], 1);
    let formats: Vec<_> = value["issues"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["format"].as_str().unwrap())
        .collect();
    assert_eq!(formats, ["woff", "woff2"]);
}

#[test]
fn human_report_explains_known_unsupported_web_fonts() {
    let output = Command::new(env!("CARGO_BIN_EXE_folio-cli"))
        .arg("scan-files")
        .arg(fixture("Inter-Regular.woff"))
        .arg(fixture("Inter-Regular.woff2"))
        .output()
        .unwrap();
    assert!(output.status.success());
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("Known but unsupported:"));
    assert!(text.contains("Format: WOFF\n"));
    assert!(text.contains("Format: WOFF2\n"));
    assert!(text.contains("Planned: Folio v2"));
    assert!(text.contains("2 known unsupported files"));
    assert!(!text.contains("error(s)"));
}

#[test]
fn file_as_directory_returns_failure_and_stderr() {
    let output = Command::new(env!("CARGO_BIN_EXE_folio-cli"))
        .arg("scan")
        .arg(fixture("Lato-Regular.ttf"))
        .arg("--json")
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8(output.stderr)
        .unwrap()
        .contains("not a directory"));
}
