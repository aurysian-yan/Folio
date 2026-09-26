# Folio

Folio is a cross-device font asset manager. This repository contains
**Phase 2: Local Library Core** — the UI-independent, platform-independent font
catalog, persistent local library state, metadata and query engine, plus an
inspection CLI.

The core discovers font assets, parses them, derives stable identities and
revisions, groups faces into families and reports diagnostics. The storage
crate persists library roots in SQLite and reuses cached parse state so an
unchanged library is not re-read or reparsed. Folio performs **no** font
activation, installation, watching, syncing or platform integration.

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

Phase 2A adds `folio-storage`:

* Persistent **library roots** (durable user state) in a local SQLite database;
  roots are distinct from font sources
* A **rebuildable catalog cache** of per-file parse state, with explicit schema
  migrations and a typed `DatabaseTooNew` guard
* **Incremental refresh**: an unchanged file is a metadata cache hit and is not
  read, hashed or reparsed; a `touch` is rehashed but not reparsed; only real
  content changes are reparsed
* **Global catalog reconstruction** from the cache, identical to a live scan,
  including cross-file, cross-directory and cross-root families
* Overlapping roots, temporarily unavailable roots and incomplete traversals
  without losing cached data; malformed and known-unsupported results are cached
* `load_cached_catalog()` for fast startup without touching the filesystem

Phase 2B adds durable library state and `folio-query`:

* Collections, favorites and explicit recent access, bound to logical font identities
* Transactional schema v2 migration and versioned metadata cache rebuilds
* License, embedding permissions, manufacturer/designer, observed Unicode scripts,
  font categories and OpenType feature metadata
* Unicode-normalized search, multi-facet filtering and library scopes
* Family results with matched faces, deterministic ranking, pagination and facet counts
* Duplicate-source, multiple-revision and metadata-conflict analysis

Not implemented (deliberately out of scope): file watchers, hot reload, platform font registration,
activation/installation, WebDAV/sync, UniFFI/FFI, UI apps, WOFF parsing.

## Build

Rust 1.91 or newer is required by the dependency set; audited with Rust 1.94.1.

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
│   ├── folio-core/     # catalog core (no UI, no platform APIs, no DB)
│   ├── folio-storage/  # SQLite persistence + incremental refresh + library state
│   ├── folio-query/    # in-memory search, facets and health analysis
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
* `PHASE2A_REPORT.md` – Phase 2A verification report
* `PHASE2B_REPORT.md` – library state, metadata and query verification report
* `AGENTS.md` – project rules for the shared Windows/Linux React front end

## Windows/Linux 桌面开发

桌面端使用 React、TypeScript、Vite 和 Tauri 2。Windows 与未来的 Linux 版本
共用 `apps/desktop-ui` 前端，提供字体库浏览、筛选、收藏与云同步界面。

### Windows 环境

安装以下工具：

* Visual Studio 2022 Build Tools，并选择 **Desktop development with C++** 工作负载和 Windows SDK
* Rust stable MSVC 工具链：`rustup default stable-msvc`
* Node.js 20.19+ 或 22.12+，以及 pnpm 11.19.0（版本由根目录 `package.json` 固定）
* WebView2 Runtime（Windows 10/11 通常已预装）

在仓库根目录安装前端依赖并启动桌面端：

```sh
pnpm install
pnpm -C apps/desktop-ui tauri dev
```

构建 Windows 安装包：

```sh
pnpm -C apps/desktop-ui tauri build
```

### Linux 环境

Linux 继续使用同一个 React/Tauri 工程。Debian/Ubuntu 开发环境需要先安装 Tauri
系统依赖：

```sh
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

随后安装 Linux Rust 工具链及 Node.js/pnpm，再运行同样的 `pnpm install` 和
`pnpm -C apps/desktop-ui tauri dev` 命令。

HeroUI is the only default React component library. Fluent UI, Chakra UI, MUI,
Radix, Ant Design and Mantine are excluded for this project. PrimeReact remains
a future fallback only if data-heavy controls cannot be covered without mixing
component systems.

## Planned

* Folio v2: WOFF/WOFF2 support, managed library storage, collection
* Windows desktop app first, then Linux using the shared React UI; Android,
  iOS/iPadOS
* Activate/deactivate, install/uninstall, hot reload, duplicate and
  revision detection, WebDAV sync
