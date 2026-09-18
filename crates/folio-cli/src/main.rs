//! `folio-cli` is the human inspection tool for the Folio font core.
//!
//! It performs no font logic of its own: everything comes from
//! [`folio_core`].

use std::io::{self, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use folio_core::{
    scan_directory, scan_files, FontClassification, FontFace, FontFormat, IssueKind, ScanIssue,
    ScanOptions, ScanResult,
};

#[derive(Parser)]
#[command(
    name = "folio-cli",
    version,
    about = "Inspect font catalogs with the Folio font core"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Scan a directory for fonts.
    Scan {
        /// Directory to scan.
        path: PathBuf,
        /// Emit machine readable JSON instead of a report.
        #[arg(long)]
        json: bool,
        /// Include faces classified as internal.
        #[arg(long)]
        show_internal: bool,
        /// Do not descend into subdirectories.
        #[arg(long)]
        no_recursive: bool,
        /// Enable debug logging on stderr.
        #[arg(long)]
        verbose: bool,
    },
    /// Scan an explicit list of font files.
    ScanFiles {
        /// Font files to scan. Extensions are not required to be known.
        #[arg(required = true)]
        paths: Vec<PathBuf>,
        /// Emit machine readable JSON instead of a report.
        #[arg(long)]
        json: bool,
        /// Include faces classified as internal.
        #[arg(long)]
        show_internal: bool,
        /// Enable debug logging on stderr.
        #[arg(long)]
        verbose: bool,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match cli.command {
        Command::Scan {
            path,
            json,
            show_internal,
            no_recursive,
            verbose,
        } => {
            init_tracing(verbose);
            let options = ScanOptions {
                recursive: !no_recursive,
            };
            match scan_directory(&path, &options) {
                Ok(result) => emit(
                    &format!("Folio scan: {}", path.display()),
                    &result,
                    json,
                    show_internal,
                ),
                Err(error) => fail(&error),
            }
        }
        Command::ScanFiles {
            paths,
            json,
            show_internal,
            verbose,
        } => {
            init_tracing(verbose);
            let label = format!("Folio scan (explicit files): {} paths", paths.len());
            match scan_files(&paths, &ScanOptions::default()) {
                Ok(result) => emit(&label, &result, json, show_internal),
                Err(error) => fail(&error),
            }
        }
    }
}

fn init_tracing(verbose: bool) {
    let level = if verbose {
        tracing::Level::DEBUG
    } else {
        tracing::Level::WARN
    };
    let _ = tracing_subscriber::fmt()
        .with_max_level(level)
        .with_target(false)
        .with_writer(io::stderr)
        .try_init();
}

fn fail(error: &dyn std::fmt::Display) -> ExitCode {
    eprintln!("folio-cli: {error}");
    ExitCode::FAILURE
}

fn emit(label: &str, result: &ScanResult, json: bool, show_internal: bool) -> ExitCode {
    if json {
        match serde_json::to_string_pretty(result) {
            Ok(json) => {
                println!("{json}");
                ExitCode::SUCCESS
            }
            Err(error) => fail(&error),
        }
    } else {
        let stdout = io::stdout();
        let mut out = stdout.lock();
        match write_report(&mut out, label, result, show_internal) {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => fail(&error),
        }
    }
}

fn write_report(
    out: &mut impl Write,
    label: &str,
    result: &ScanResult,
    show_internal: bool,
) -> io::Result<()> {
    writeln!(out, "{label}")?;
    writeln!(out)?;

    let mut hidden_faces = 0usize;
    for family in &result.catalog.families {
        let visible: Vec<&FontFace> = family
            .faces
            .iter()
            .filter(|face| {
                let keep = show_internal || face.classification != FontClassification::Internal;
                if !keep {
                    hidden_faces += 1;
                }
                keep
            })
            .collect();
        if visible.is_empty() {
            continue;
        }

        let name = family
            .display_name
            .clone()
            .unwrap_or_else(|| "(unnamed)".to_owned());
        writeln!(out, "{name}")?;
        writeln!(out)?;
        for face in visible {
            write_face(out, face)?;
        }
    }

    if hidden_faces > 0 {
        writeln!(
            out,
            "Hidden: {hidden_faces} internal face(s); use --show-internal"
        )?;
        writeln!(out)?;
    }

    let unsupported: Vec<&ScanIssue> = result
        .issues
        .iter()
        .filter(|issue| issue.kind == IssueKind::KnownUnsupportedFormat)
        .collect();
    if !unsupported.is_empty() {
        writeln!(out, "Known but unsupported:")?;
        writeln!(out)?;
        for issue in unsupported {
            writeln!(out, "  {}", issue.path.display())?;
            if let Some(format) = issue.format {
                writeln!(out, "    Format: {}", format.label())?;
            }
            if let Some(planned) = issue.format.and_then(FontFormat::planned_support) {
                writeln!(out, "    Planned: {planned}")?;
            }
        }
        writeln!(out)?;
    }

    let other_issues: Vec<&ScanIssue> = result
        .issues
        .iter()
        .filter(|issue| issue.kind != IssueKind::KnownUnsupportedFormat)
        .collect();
    if !other_issues.is_empty() {
        writeln!(out, "Issues:")?;
        for issue in other_issues {
            let face = issue
                .face_index
                .map(|index| format!(" (face {index})"))
                .unwrap_or_default();
            writeln!(out, "  {}{face}: {}", issue.path.display(), issue.message)?;
        }
        writeln!(out)?;
    }

    let errors = result
        .issues
        .iter()
        .filter(|issue| issue.severity == folio_core::IssueSeverity::Error)
        .count();
    let warnings = result
        .issues
        .iter()
        .filter(|issue| issue.severity == folio_core::IssueSeverity::Warning)
        .count();

    writeln!(out, "Summary:")?;
    writeln!(out, "{} files", result.stats.files_seen)?;
    writeln!(
        out,
        "{} candidate font files",
        result.stats.candidate_font_files
    )?;
    writeln!(
        out,
        "{} supported font files",
        result.stats.supported_font_files
    )?;
    writeln!(
        out,
        "{} known unsupported files",
        result.stats.unsupported_known_font_files
    )?;
    writeln!(out, "{} faces", result.stats.faces_parsed)?;
    writeln!(out, "{} families", result.stats.families_created)?;
    if errors > 0 {
        writeln!(out, "{errors} error(s)")?;
    }
    if warnings > 0 {
        writeln!(out, "{warnings} warning(s)")?;
    }
    Ok(())
}

fn format_version(value: f64) -> String {
    let rounded = (value * 10_000.0).round() / 10_000.0;
    let mut text = format!("{rounded}");
    if text.contains('.') {
        while text.ends_with('0') {
            text.pop();
        }
        if text.ends_with('.') {
            text.pop();
        }
    }
    text
}

fn write_face(out: &mut impl Write, face: &FontFace) -> io::Result<()> {
    writeln!(out, "  {}", face.display_subfamily())?;
    if let Some(name) = &face.metadata.postscript_name {
        writeln!(out, "    PostScript: {name}")?;
    }
    writeln!(out, "    Format: {}", face.format.label())?;
    if let Some(weight) = face.metadata.weight {
        writeln!(out, "    Weight: {weight}")?;
    }
    if let Some(width) = face.metadata.width {
        if (width.ratio() - 1.0).abs() > f32::EPSILON {
            writeln!(out, "    Width: {}", width.ratio())?;
        }
    }
    match face.metadata.style {
        folio_core::FontStyle::Italic => writeln!(out, "    Style: Italic")?,
        folio_core::FontStyle::Oblique { angle } => writeln!(out, "    Style: Oblique {angle:?}")?,
        folio_core::FontStyle::Normal => {}
    }
    if let Some(revision) = face.metadata.font_version.head_revision {
        writeln!(out, "    Version: {}", format_version(revision))?;
    }
    if face.metadata.is_variable {
        writeln!(out, "    Variable: yes")?;
        for axis in &face.metadata.variable_axes {
            let hidden = if axis.hidden { " hidden" } else { "" };
            writeln!(
                out,
                "      {} {}..{}..{}{hidden}",
                axis.tag, axis.min_value, axis.default_value, axis.max_value
            )?;
        }
    }
    let multiple = face.sources.len() > 1;
    for source in &face.sources {
        let label = if multiple { "Sources" } else { "Source" };
        writeln!(
            out,
            "    {label}: {} (face {})",
            source.path().display(),
            source.face_index()
        )?;
    }
    writeln!(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn internal_visibility_only_changes_the_human_report() {
        let path =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/fonts/Lato-Regular.ttf");
        let mut result = scan_files(&[path], &ScanOptions::default()).unwrap();
        result.catalog.families[0].faces[0].classification = FontClassification::Internal;
        let mut hidden = Vec::new();
        let mut shown = Vec::new();
        write_report(&mut hidden, "Folio", &result, false).unwrap();
        write_report(&mut shown, "Folio", &result, true).unwrap();
        let hidden = String::from_utf8(hidden).unwrap();
        let shown = String::from_utf8(shown).unwrap();
        assert!(hidden.contains("Hidden: 1 internal face(s)"));
        assert!(!hidden.contains("PostScript: Lato-Regular"));
        assert!(shown.contains("PostScript: Lato-Regular"));
        assert!(!shown.contains("Hidden:"));
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(
            json["catalog"]["families"][0]["faces"][0]["classification"],
            "internal"
        );
        assert_eq!(result.catalog.face_count(), 1);
    }
}
