# Folio

Folio is a cross-device font asset manager. This repository contains
**Phase 1B: Audited Rust Font Catalog Core** — the UI-independent, platform-
independent catalog core and its inspection CLI.

The core discovers font assets, parses them, derives stable identities and
revisions, groups faces into families and reports diagnostics. It performs
**no** font activation, installation, watching, syncing or platform
integration.

## Current capabilities

* Directory scans (recursive by default) and explicit file-list scans
* TTF and OTF parsing via the Fontations stack (`read-fonts`, `skrifa`)
* TTC/OTC collections: neutral collection container with per-face sfnt format;
  TTC and runtime-generated CFF-only/mixed collections verified
* Variable font detection with `fvar` axes and named instances
* OpenType metadata: names with language tags, weight, width, style,
  version, units per em
* Domain-separated BLAKE3 identifiers:
  `FontFamilyId`, `FontFaceId`, `FontIdentityId`, `FontRevisionId`
  (`FontIdentityId` is the logical reference; `FontFaceId` changes with revision)
* BLAKE3 `ContentFingerprint`; paths never affect identity or revision
* Global metadata-based family grouping across files, directories and collections,
  with Unicode whitespace, NFC and case normalization
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

Rust 1.85 or newer is required by the dependency set; audited with Rust 1.94.1.

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
* `--json` – emit deterministic CLI/debug JSON (not a storage or FFI schema)
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
├── package.json
├── pnpm-workspace.yaml
├── crates/
│   ├── folio-core/     # catalog core (no UI, no platform APIs)
│   └── folio-cli/      # inspection CLI
├── apps/desktop-ui/     # shared Windows/Linux React UI dependency baseline
├── fixtures/fonts/     # legally redistributable test fonts
├── docs/architecture.md
└── rustfmt.toml
```

## Documentation

* `docs/architecture.md` – every core design decision, identity/revision
  strategy, grouping, classification, limitations, future platform order
* `fixtures/fonts/README.md` – fixture provenance and licenses
* `PHASE1_REPORT.md` – final verification report
* `PHASE1_AUDIT.md` – independent findings, regression evidence and final verdict
* `AGENTS.md` – project rules for the shared Windows/Linux React front end

## Desktop UI dependency baseline

The Windows and Linux front end is planned to use React, TypeScript, Vite,
Tauri 2 and HeroUI v3 with Tailwind CSS v4. The repository currently contains
only the dependency manifest at `apps/desktop-ui/package.json`; UI source is
intentionally deferred.

```sh
pnpm install
```

HeroUI is the only default React component library. Fluent UI, Chakra UI, MUI,
Radix, Ant Design and Mantine are excluded for this project. PrimeReact remains
a future fallback only if data-heavy controls cannot be covered without mixing
component systems.

## Planned

* Folio v2: WOFF/WOFF2 support, managed library storage, collection
* Desktop apps (macOS first, then Windows/Linux shared React UI), Android,
  iOS/iPadOS
* Activate/deactivate, install/uninstall, hot reload, duplicate and
  revision detection, WebDAV sync
