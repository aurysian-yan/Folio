# Folio

Folio is a cross-device font asset manager. This repository contains
**Phase 1: Rust Font Core Foundation** — the UI-independent, platform-
independent catalog core and its inspection CLI.

The core discovers font assets, parses them, derives stable identities and
revisions, groups faces into families and reports diagnostics. It performs
**no** font activation, installation, watching, syncing or platform
integration.

## Current capabilities

* Directory scans (recursive by default) and explicit file-list scans
* TTF and OTF parsing via the Fontations stack (`read-fonts`, `skrifa`)
* TTC/OTC collections: multiple faces per file, per-face failure isolation
* Variable font detection with `fvar` axes and named instances
* OpenType metadata: names with language tags, weight, width, style,
  version, units per em
* Stable, domain-separated BLAKE3 identifiers:
  `FontFamilyId`, `FontFaceId`, `FontIdentityId`, `FontRevisionId`
* BLAKE3 `ContentFingerprint`; paths never affect identity or revision
* Metadata-based family grouping (Regular/Bold/Italic, variable fonts)
* Conservative `Normal` / `SystemLike` / `Internal` classification, with
  classified fonts kept in the catalog
* Structured diagnostics and scan statistics; one broken font never fails
  a scan
* WOFF and WOFF2 are recognized as known formats but are **not supported**
  yet (planned for Folio v2)
* `folio-cli` human-readable report and stable JSON output

Not implemented (deliberately out of scope for this phase): UI apps,
platform font registration, activation/installation, file watchers, hot
reload, databases, caching, WebDAV/sync, UniFFI/FFI, WOFF parsing.

## Build

```sh
cargo build --workspace
```

## Test

```sh
cargo test --workspace
```

## Lint and format

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
```

## Scan a directory

```sh
cargo run -p folio-cli -- scan <folder>
```

Useful flags:

* `--no-recursive` – stay on the top level
* `--show-internal` – include faces classified as internal
* `--json` – emit stable structured JSON
* `--verbose` – debug logging on stderr

## Scan explicit files

```sh
cargo run -p folio-cli -- scan-files font1.ttf font2.otf font3.ttc
```

Explicit files do not need known extensions; every provided path is a
candidate. This is the entry point future Finder/Explorer "Open With Folio"
integrations will use.

## Repository layout

```text
Folio/
├── Cargo.toml
├── crates/
│   ├── folio-core/     # catalog core (no UI, no platform APIs)
│   └── folio-cli/      # inspection CLI
├── fixtures/fonts/     # legally redistributable test fonts
├── docs/architecture.md
└── rustfmt.toml
```

## Documentation

* `docs/architecture.md` – every core design decision, identity/revision
  strategy, grouping, classification, limitations, future platform order
* `fixtures/fonts/README.md` – fixture provenance and licenses
* `PHASE1_REPORT.md` – verification report for this phase

## Planned

* Folio v2: WOFF/WOFF2 support, managed library storage, collection
* Desktop apps (macOS first, then Windows), Android, iOS/iPadOS, Linux
* Activate/deactivate, install/uninstall, hot reload, duplicate and
  revision detection, WebDAV sync
