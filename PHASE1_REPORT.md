# Folio — Phase 1 Report

**Phase:** 1 — Rust Font Core Foundation
**Status:** implemented and verified on this machine
**Date:** 2026-09-18
**Environment:** macOS (aarch64-apple-darwin), `rustc 1.94.1 (e408947bf 2026-03-25)`,
`cargo 1.94.1 (29ea6fb6a 2026-03-24)`

This report contains only observed results. Commands were actually executed;
nothing below is inferred from "it should work".

---

## 1. Repository tree

```text
Folio/
├── Cargo.toml                      # workspace: resolver 2, shared dependency versions
├── Cargo.lock
├── .gitignore
├── rustfmt.toml
├── README.md
├── PHASE1_REPORT.md                # this file
├── crates/
│   ├── folio-core/
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── lib.rs              # crate docs, module wiring, re-exports, #![forbid(unsafe_code)]
│   │   │   ├── attributes.rs       # FontWeight, FontWidth, FontStyle, FontVersion, VariableAxis,
│   │   │   │                       # NamedInstance, AxisCoordinate
│   │   │   ├── catalog.rs          # Catalog
│   │   │   ├── classification.rs   # FontClassification + classify_names
│   │   │   ├── error.rs            # FontError, ScanError (thiserror)
│   │   │   ├── face.rs             # FaceMetadata, ParsedFace, ParsedFontFile, FontFace
│   │   │   ├── family.rs           # FontFamily, family key/display, grouping, source normalization
│   │   │   ├── fingerprint.rs      # ContentFingerprint (BLAKE3)
│   │   │   ├── format.rs           # FontFormat, magic sniffing, extension hints
│   │   │   ├── ids.rs              # FontFamilyId/FontFaceId/FontIdentityId/FontRevisionId
│   │   │   ├── identity.rs         # FontIdentity, IdentityKind, identity strategy
│   │   │   ├── names.rs            # LocalizedName, NameKind, name selection/ranking
│   │   │   ├── parser.rs           # parse_font_file / parse_font_data
│   │   │   ├── revision.rs         # FontRevision, revision strategy
│   │   │   ├── scan.rs             # ScanInput/Options/Result/Stats/Issue + pipeline
│   │   │   └── source.rs           # FontSource
│   │   └── tests/
│   │       ├── common/mod.rs       # fixture + synthetic-font helpers
│   │       ├── parser.rs           # (D) parser tests
│   │       ├── identity_revision.rs# (B)(C)(N)(O)(P) fingerprint/identity/revision tests
│   │       ├── family_grouping.rs  # (F) grouping tests
│   │       └── scanner.rs          # (G)(H)(I)(L)(M) scanner tests
│   └── folio-cli/
│       ├── Cargo.toml
│       └── src/main.rs             # scan / scan-files, --json/--show-internal/--no-recursive/--verbose
├── fixtures/
│   └── fonts/
│       ├── README.md               # provenance, licenses, checksums
│       ├── Inter-Regular.woff
│       ├── Inter-Regular.woff2
│       ├── Inter-Variable.ttf
│       ├── Lato-Bold.ttf
│       ├── Lato-Italic.ttf
│       ├── Lato-Regular.ttf
│       ├── SourceSerif4-Regular.otf
│       ├── not-a-font.ttf          # intentionally invalid
│       └── licenses/
│           ├── Inter-OFL.txt
│           ├── Lato-OFL.txt
│           └── SourceSerif-OFL.txt
└── docs/
    └── architecture.md             # all recorded decisions (1-19 in the phase spec)
```

The suggested layout from the phase specification was used unchanged; no
extra empty layers were added. No `font-sync`, `font-platform`, `font-ffi`
or `apps/*` directories exist.

Code size (excluding `target/`): ~2,900 lines of Rust source plus ~690 lines
of integration tests.

## 2. Direct dependencies and their purpose

Workspace-level (see `Cargo.toml`):

| Crate | Version | Used by | Purpose |
| --- | --- | --- | --- |
| `read-fonts` | 0.44.0 | folio-core | Low-level sfnt parser, table directory, `ttcf` collection handling |
| `skrifa` | 0.47.0 | folio-core | Localized `name` strings, `fvar` axes/named instances, attributes |
| `blake3` | 1.8.7 | folio-core | Content fingerprints and all stable IDs |
| `serde` | 1.0.229 | both | Derive `Serialize` for the catalog, diagnostics and JSON output |
| `serde_json` | 1.0.151 | folio-cli (dev: folio-core) | `--json` output; dev-dependency for assertions |
| `thiserror` | 2.0.20 | folio-core | Semantic error types preserving source errors |
| `tracing` | 0.1.44 | both | Core emits debug events; no subscriber in the core |
| `tracing-subscriber` | 0.3.23 | folio-cli | CLI initializes logging (quiet by default, debug with `--verbose`) |
| `clap` | 4.6.7 | folio-cli | Command line parsing |
| `walkdir` | 2.5.0 | folio-core | Deterministic directory traversal, no symlink following |
| `font-test-data` | 0.9.1 (dev) | folio-core tests | Legal TTC test fixture from Fontations (MIT OR Apache-2.0) |
| `tempfile` | 3.27.0 (dev) | folio-core tests | Temporary fixture directories |

Fontations was sufficient for every Phase 1 requirement. No additional font
crate was introduced; in particular `ttf-parser` is not used. No Tokio,
async runtime, HTTP client or database crate is present.

## 3. Domain model

```text
Catalog
└── FontFamily { id, display_name, localized_names, faces: Vec<FontFace> }
    └── FontFace { id, identity_id, revision_id, family_id, format,
                   classification, metadata: FaceMetadata, sources: Vec<FontSource> }

Parser output (per file)
└── ParsedFontFile { path, format, fingerprint, faces: Vec<ParsedFace>, problems }
    └── ParsedFace { id, face_index, format, identity: FontIdentity,
                     revision: FontRevision, metadata: FaceMetadata, source: FontSource }
```

`FontIdentity { id, kind, canonical_name }` and
`FontRevision { id, identity_id, content_fingerprint, face_discriminator }`
are computed values returned by the parser. `FontFace` is the catalog
entity: one materialized revision, merging all sources that share the same
`FontFaceId`. Re-exporting a font produces a new face that keeps the same
`identity_id`; duplicate bytes merge into one face with several sources.

## 4. `FontFormat` design

```rust
pub enum FontFormat {
    TrueType, OpenType, TrueTypeCollection, OpenTypeCollection, Woff, Woff2,
}
```

* `is_supported()`: TrueType, OpenType, TTC, OTC.
* `is_collection()`: TTC, OTC.
* `planned_support()`: WOFF/WOFF2 -> `"Folio v2"`.
* Format is detected from magic bytes (`docs/architecture.md` §11), never
  from the extension. Extensions are used only for candidate detection.
* Per-face `format` exists as well as file-level `format`; a mixed
  collection is labeled by its first member (documented limitation).

## 5. `FontSource` design

```rust
pub enum FontSource {
    LocalFile { path: PathBuf, face_index: u32, file_size: u64, modified: Option<SystemTime> },
}
```

The path lives here and nowhere else. `face_index` is `0` for single fonts
and the member index for collections. `file_size` and `modified` are scan
time auxiliary metadata only; they are never used for identity. The enum
shape leaves room for WebDAV/managed-library sources in later phases
without changing identity code.

## 6. `ContentFingerprint` design

`ContentFingerprint` is the BLAKE3 hash of the complete file bytes. It
contains no path, no file name and no modification time. Every face of a
collection shares the containing file's fingerprint; the collection index
is part of the revision instead. Phase 1 always hashes the full file; no
cache and no mtime/size shortcut exist.

## 7. `FontIdentity` strategy

Deterministic priority (documented in `docs/architecture.md` §6):

1. PostScript name (name ID 6)
2. Typographic family + subfamily (16/17)
3. Legacy family + subfamily (1/2)
4. Full name (4)
5. Content fallback: fingerprint + face index, marked
   `IdentityKind::ContentFallback` and reported as a `MetadataProblem`

Names are trimmed and whitespace-collapsed before hashing. Path, file name
and mtime never participate. PostScript names are treated as a strong but
non-guaranteed signal, hence the explicit ordered fallbacks.

## 8. `FontRevision` strategy

```text
FontRevisionId = BLAKE3("folio-revision\0" || identity_id || fingerprint || discriminator)
```

`discriminator` is absent for single fonts and the member index for
collections. Moving/copying files leaves revisions unchanged; changing
bytes changes them; collection members never collide even when they share
identity and file fingerprint. No revision history is stored in Phase 1.

## 9. Stable ID strategy

```text
FontFamilyId   = BLAKE3("folio-family\0"   || family_key)
FontIdentityId = BLAKE3("folio-identity\0" || identity_key)
FontRevisionId = BLAKE3("folio-revision\0" || identity_id || fingerprint || discriminator)
FontFaceId     = BLAKE3("folio-face\0"     || revision_id)
```

Every variable-length part is length-prefixed (little-endian `u64`), so
concatenation is unambiguous. IDs are 128-bit (first 16 bytes of the XOF
output), printed as 32 hex characters, typed (`FontFamilyId` etc. are
distinct types), deterministic and documented. No vector indexes, no
database autoincrement, no `DefaultHasher`.

## 10. Name table fallback

Tracked name IDs: 1, 2, 4, 5, 6, 16, 17, 21, 22. All decodable localized
strings are stored with their BCP-47 language tag when derivable (UTF-16BE,
MacRoman, Mac/Windows language IDs, `name` v1 language tags through
`skrifa`). Display preference: `en-US` > `en` > language-less > first
record in table order. `family_name` uses typographic family then legacy
family; `subfamily_name` uses typographic subfamily then legacy subfamily.
Legacy values are additionally stored separately. Tests assert that
Chinese/Japanese/other strings are not lost.

## 11. Family grouping

Metadata-based only, never filename-based:

1. family name, else PS name, else full name, else `"unnamed"`.
2. One hash-map pass keyed by the canonical family string -> O(N log N)
   total (the map is a `BTreeMap`), no pairwise O(N²) comparison.
3. Deterministic ordering: families by case-insensitive display name then
   ID; faces by style rank (Normal/Oblique/Italic), weight, subfamily name,
   face ID; localized names by kind, language, value.
4. Variable fonts join their family like any other face.

## 12. Classification

`Normal | SystemLike | Internal`, from PostScript and family names only:

* name starting with `.` -> `Internal` (e.g. `.AppleSystemUIFont`)
* name containing `lastresort` -> `SystemLike`
* otherwise `Normal`

Classification is metadata. Faces are never removed; stats count them and
JSON always includes them. The CLI hides `Internal` faces unless
`--show-internal` is passed. No unverified hardcoded system font catalog
exists.

## 13. Directory scan and explicit files scan

One pipeline (`scan(ScanInput, &ScanOptions)`) with two candidate
collectors:

* `Directory`: `walkdir`, recursive by default, no symlink following,
  candidates filtered by `CANDIDATE_EXTENSIONS`, paths sorted.
* `Files`: every provided path is a candidate regardless of extension,
  deduplicated and sorted.

From candidate collection onward the code path is identical: read, sniff,
parse, fingerprint, identity, revision, grouping, issues, stats. A test
asserts that a two-file directory scan and the equivalent `scan_files` call
produce identical `Catalog`, `issues` and `stats` values.

Failure isolation: only an unreadable/non-directory root fails the whole
scan; each bad file becomes a `ScanIssue`; a bad collection member becomes
a `CollectionProblem` issue without stopping the other members.

## 14. TTF support level

Fully supported and verified: parsing, single-face handling, weight,
width, style, version (`head.fontRevision`), units per em, post table,
OS/2, all tracked name IDs, localized names, variable fonts, family
grouping and classification.

Evidence: `Lato-Regular/Bold/Italic` fixtures, plus 649 system TTF faces in
the smoke test. Tests: `parser.rs`, `family_grouping.rs`.

## 15. OTF support level

Fully supported and verified for CFF-outline OpenType: sfnt `OTTO`
detection, single face, metadata. Evidence: `SourceSerif4-Regular.otf`
fixture and 137 system OTF faces in the smoke test (including
`LastResort.otf`, which is classified `Internal`).

## 16. TTC / OTC support level

* **TTC: verified.** Successfully parses the 2-face `TTC.ttc` fixture from
  the Fontations `font-test-data` crate (harfbuzz provenance), and a real
  6-face `Helvetica.ttc` in the explicit-files smoke test. Each face gets
  its own `face_index`, discriminator, revision and identity; faces group
  into one family with Regular/Bold/Oblique/Light ordering.
* **OTC: NOT VERIFIED.** The code path is identical (a `ttcf` header whose
  first member uses CFF outlines produces `OpenTypeCollection`), but no
  legally redistributable OTC fixture was obtained, so no test or smoke run
  proves it. It is listed as a limitation rather than claimed as verified.

## 17. Variable font support level

Verified:

* `is_variable` detection from `fvar` axes.
* Full axis metadata: tag, min/default/max, hidden flag, preferred name and
  all localized axis names.
* Named instances: subfamily name, optional PostScript name, per-axis user
  coordinates.
* Variable fonts join their family normally.

Evidence: `Inter-Variable.ttf` (`opsz 14..14..32`, `wght 100..400..900`),
asserted in `parser.rs`; 58 variable faces found in the system font smoke
test.

## 18. WOFF / WOFF2 current behavior

* Recognized by magic bytes (`wOFF`, `wOF2`), never by extension.
* `parse_font_data` returns
  `FontError::UnsupportedFormat { format, planned: "Folio v2" }`.
* The scanner records a `KnownUnsupportedFormat` warning with
  `format: Some(Woff | Woff2)`, counted in
  `ScanStats::unsupported_known_font_files`.
* Never reported as `MalformedFont`; never counted as a failed file.
* No parsing, decompression, preview or conversion exists.

Evidence: `Inter-Regular.woff` and `Inter-Regular.woff2` fixtures and
`parser.rs`/`scanner.rs` tests, plus the CLI "Known but unsupported"
section.

## 19. CLI usage

```text
folio-cli scan <path> [--json] [--show-internal] [--no-recursive] [--verbose]
folio-cli scan-files <paths...> [--json] [--show-internal] [--verbose]
```

* Default output is a human readable report: families, faces with
  PostScript name, format, weight, style, version, variable axes, sources;
  a "Known but unsupported" section; an "Issues" section; and a summary
  with files/candidates/supported/unsupported/faces/families and issue
  counts.
* `--json` emits `ScanResult` (catalog + issues + stats) as stable,
  deterministically ordered JSON (verified: two runs diff clean).
* `--show-internal` reveals `Internal` faces; JSON always contains all
  faces.
* `--verbose` enables debug logging on stderr (subscriber configured in the
  CLI only; the core never initializes one and never uses `println!`).

The CLI contains no catalog logic: it only formats `folio_core` data.

## 20. Tests

`cargo test --workspace` -> **57 tests, all passing**:

| Suite | Count | Coverage |
| --- | --- | --- |
| `folio-core` unit tests | 24 | stable IDs, ID domain separation, identity fallback matrix, revision semantics, name ranking, weight/width mapping, classification rules, family keys |
| `tests/identity_revision.rs` | 6 | (B) fingerprint content-only; (C) identity survives changed content; (N)(P) move/rename safety; collection discriminators; ID domain separation |
| `tests/parser.rs` | 11 | (D) TTF/OTF/VF/TTC/illegal; (E) WOFF/WOFF2 known-unsupported; extension-vs-content; empty file; localized names |
| `tests/family_grouping.rs` | 4 | (F) Regular/Bold/Italic grouping, distinct families not merged, directory-layout independence, deterministic order |
| `tests/scanner.rs` | 11 | (G) explicit files share pipeline; (H) failure isolation with mixed directory; (I) internal classification retained; (M) classification; non-recursive; missing root; missing explicit file; duplicate merge; issue ordering |
| `folio-core` doc test | 1 | `scan_directory` usage example |
| `folio-cli` | 0 | CLI is verified through the smoke runs below |

Coverage against phase spec section 32: A, B, C, D, E, F, G, H, I are all
implemented. Acceptance O ("re-export changes revision") is verified by
appending a byte to a fixture copy, which changes the binary while keeping
metadata; this is an intentional simulation with the semantics documented
in the test name and comment.

## 21. Command results

| Command | Result |
| --- | --- |
| `cargo build --workspace` | **PASS** (exit 0) |
| `cargo fmt --all --check` | **PASS** (exit 0, no diff) |
| `cargo clippy --workspace --all-targets -- -D warnings` | **PASS** (exit 0, no warnings) |
| `cargo test --workspace` | **PASS** (57 passed, 0 failed) |

Exact outputs from the final verification run:

```text
$ cargo build --workspace
   Compiling folio-cli v0.1.0 (/Users/aurysian/Folio/crates/folio-cli)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.42s

$ cargo fmt --all --check
(no output)

$ cargo clippy --workspace --all-targets -- -D warnings
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.11s

$ cargo test --workspace
running 0 tests
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
running 24 tests
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
running 4 tests
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
running 6 tests
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
running 11 tests
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
running 11 tests
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
running 1 test
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
```

## 22. Real directory smoke test

Command (release binary, recursive):

```sh
./target/release/folio-cli scan /System/Library/Fonts --json
```

Observed (2.0 s wall clock):

```json
{"candidate_font_files": 369, "faces_parsed": 786, "failed_files": 0,
 "families_created": 377, "files_seen": 371, "supported_font_files": 369,
 "unsupported_known_font_files": 0}
```

* issues: 0
* classification: 114 `Internal` faces (dot-prefixed Apple fonts), 0
  `SystemLike` (the `LastResort` family is `.LastResort`, so the dot rule
  wins; see `docs/architecture.md` §14)
* variable faces: 58
* face formats: 649 TrueType, 137 OpenType

No private or user font names appear here. No font files were copied into
the repository; the scan was read-only.

## 23. Explicit files smoke test

Command (release binary):

```sh
./target/release/folio-cli scan-files \
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf" \
  "/System/Library/Fonts/LastResort.otf" \
  "/System/Library/Fonts/Helvetica.ttc" \
  /tmp/.../font-without-extension \
  --json
```

Observed:

```json
{"candidate_font_files": 4, "faces_parsed": 9, "failed_files": 0,
 "families_created": 4, "files_seen": 4, "supported_font_files": 4,
 "unsupported_known_font_files": 0}
```

* 9 faces: 1 TTF face, 1 OTF face (`LastResort`, classified `Internal`),
  6 faces from `Helvetica.ttc`, and 1 OTF face from a copy with **no file
  extension** (`font-without-extension`), proving extension-free explicit
  scans work.
* The six Helvetica faces were grouped into one family in the order
  Light, Regular, Bold, Light Oblique, Oblique, Bold Oblique, each with its
  collection face index preserved.

## 24. Known limitations

Recorded in full in `docs/architecture.md` §18. Summary:

1. Content-fallback identities (fonts with no usable names) depend on the
   binary hash; re-exporting such a font changes its identity. Explicitly
   marked and warned about.
2. PostScript name collisions produce shared identities (revisions still
   differ).
3. Fonts without family metadata get one family each; no style-suffix
   guessing.
4. Mixed collections are labeled by their first member.
5. `usWidthClass` 0 is reported as unknown.
6. Italic/oblique variation axes are not interpreted; style comes from
   OS/2, `post` and `head`.
7. WOFF/WOFF2 are recognized but unsupported (Folio v2).
8. OTC has no legal fixture: code path present, **NOT VERIFIED**.
9. Corrupt-collection isolation is implemented and unit-covered via the
   collection discriminator tests, but no corrupt `.ttc` fixture is
   committed (producing one legally is a future improvement).
10. Directory scans ignore unknown extensions; extensionless fonts are
    found only via explicit file scans.
11. Symlinks are not followed in directory scans.
12. Full-file BLAKE3 every scan; no cache, no conditional hashing.
13. Single-threaded; each candidate file is read fully into memory.

Future optimizations (recorded, intentionally not implemented): metadata
cache, mtime/size fast path, conditional hashing, parallel parse, search
index, streaming reads.

## 25. Acceptance criteria status

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| A | `cargo build --workspace` | PASS | §21 |
| B | `cargo fmt --check` | PASS | §21 |
| C | `cargo clippy --workspace --all-targets -- -D warnings` | PASS | §21 |
| D | `cargo test --workspace` | PASS | §20/§21, 57 tests |
| E | CLI scans a real directory | PASS | §22 |
| F | CLI scans explicit font files | PASS | §23 |
| G | TTF parses for real | PASS | fixtures + 649 system faces |
| H | OTF parses for real | PASS | fixture + 137 system faces |
| I | Variable font recognized (axes verified) | PASS | §17 |
| J | TTC/OTC with real proof | PARTIAL — TTC PASS, OTC NOT VERIFIED (no legal fixture) | §16 |
| K | Regular/Bold/Italic family grouping | PASS | `family_grouping.rs`, §23 |
| L | Broken font does not fail the scan | PASS | `scanner.rs::directory_scan_isolates_failures` |
| M | Internal fonts classified but kept | PASS | `scanner.rs`, §22 (114 kept) |
| N | Same binary moved -> fingerprint unchanged | PASS | `identity_revision.rs` |
| O | Re-export -> revision changes | PASS | `changed_content_changes_revision_but_not_identity` |
| P | Identity independent of path | PASS | `identity_revision.rs`, §9 |
| Q | WOFF/WOFF2 known-unsupported | PASS | §18, CLI output |
| R | No UI/platform/DB/sync/FFI implementations | PASS | dependency list (§2), source tree (§1), forbidden-topic grep found nothing |

**All Phase 1 acceptance criteria are satisfied except OTC verification
(criterion J), which is explicitly listed as a limitation.**

Phase 1 is complete. No later-phase code (SQLite, CoreText,
activation/installation, watchers, WebDAV, Android, UniFFI, ...) was
started.
