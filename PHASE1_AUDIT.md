# Phase 1B — Independent Audit, Hardening & Finalization

Date: 2026-09-18. Host: macOS, aarch64-apple-darwin.
Compiler: `rustc 1.94.1 (e408947bf 2026-03-25)`.
Cargo: `1.94.1 (29ea6fb6a 2026-03-24)`.
Scope: Rust catalog core, CLI, fixtures, tests and documentation only.

## 1. Initial State

The existing report was read as a set of claims, followed by independent
inspection of all core/CLI source, test files, manifests, lockfile, fixture
notices and architecture documentation. Before any source modification:

| Command | Actual result |
| --- | --- |
| `cargo build --workspace` | PASS, exit 0; dev profile finished in 0.17 s |
| `cargo fmt --all --check` | PASS, exit 0, no output |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS, exit 0; finished in 0.12 s |
| `cargo test --workspace` | PASS, 57 tests, 0 failed |

Initial suites: 24 core unit, 4 family, 6 identity/revision, 11 parser,
11 scanner, 1 doctest; zero CLI tests. Concurrent Cargo processes briefly
waited for package/build locks; none failed.

There was initially no Git repository. At the user's request a local `main`
repository was initialized and **`3b5c14d`** committed the exact pre-audit
baseline. The initial report is preserved in that commit. The already-written
test helper was restored as an uncommitted change after the baseline commit.

Passing the original tests did not establish the report's stronger claims.
The first independent regression run compiled against the original production
code: **16 tests, 7 passed, 9 failed**. Its full output remains locally at
`target/phase1b/regression-before.txt` (ignored build evidence).

## 2. Audit Findings

### Critical

None found within the audited Phase 1 scope. This is not a claim of exhaustive
fuzzing, complete font validation or proof of parser safety for arbitrary bytes.

### Major

| Finding | Evidence and consequence | Resolution |
| --- | --- | --- |
| Family keys only trimmed whitespace | Equivalent case, decomposed Unicode and internal-space variants formed 6 families instead of the expected 4 | NFC, whitespace collapse and Unicode lowercase for family keys; raw strings retained |
| All fully unnamed faces used `unnamed` | Two unrelated nameless fonts merged into 1 family | Fallback family key includes IdentityId |
| Locale namespaces conflated upstream | Mac 0x0409 was labeled en-US; Windows 0 could become Mac English; `not_a_tag` was exported as a BCP-47 language | Platform-aware mapping guard, conservative tag syntax, preserved raw locale |
| A loaded table directory was treated as sufficient member validation | An out-of-range member table was accepted, so the corrupt member remained in the catalog | Validate all table ranges and any present `head`; retain valid siblings |
| Collection format followed the first usable member | Mixed TT/CFF collections were labeled TTC or OTC according to order | Neutral `Collection` file format with per-face sfnt format |
| Identity fields were concatenated before length-prefix hashing | `(A\0B, C)` and `(A, B\0C)` produced identical logical IDs | Hash individually length-prefixed strategy and name fields |
| Source-specific font notices were incomplete/mismatched | Source Serif notice differed from the byte-matched Adobe release; Inter web files were paired only with the variable font's notice | Exact Adobe notice replaced; exact Fontsource web-font notice added |

### Minor

- Family `localized_names` included subfamily, PS and version names. It now
  includes only family-related IDs 1, 16 and 21.
- Per-family and per-font `Vec::contains` name deduplication could become
  quadratic as unique names accumulated. BTreeSets replace those loops.
- Duplicate spelling/symlink aliases were separate explicit candidates.
  Existing candidate paths are now canonicalized and deduplicated in both modes.
- `ParsedFontFile.path` used serde's UTF-8-only PathBuf serialization while
  source/issue paths were lossy. All public path DTOs now use the same policy.
- The declared Rust 1.82 floor contradicted already-resolved dependencies
  requiring 1.85. The declaration was corrected without upgrading them.
- Public implementation modules unnecessarily duplicated the root API surface.
  Modules are now private; explicit root exports remain available.
- Documentation claimed localized CJK verification and damaged-member coverage
  without tests demonstrating those cases. Evidence levels have been rewritten.
  The old style description also overstated `post.italicAngle`: it supplies an
  oblique angle after OS/2 declares Oblique; it does not independently select style.

### No Issue / deliberate limitations

- Both scan modes already shared the post-discovery pipeline and grouped all
  faces globally. This architecture was retained and more strongly tested.
- FaceId as a materialized revision is coherent. Its misleading potential was
  addressed by explicit lifetime documentation rather than another entity layer.
- Fingerprints and IDs were path-independent; revisions were content-dependent.
- PS-name collisions intentionally share identity, but not binary revisions.
  This is now tested with conflicting family/subfamily metadata and documented.
- Direct parse errors preserve I/O/parser sources. ScanIssue is a final DTO
  boundary, where formatting messages is intentional, not early parser erasure.
- `.LastResort` remains Internal because dot-prefix policy wins. Catalog/JSON
  retention and human-view filtering are independently tested.
- WOFF/WOFF2 magic-based known-unsupported behavior was correct. No web-font
  parsing, decompression or conversion was added.

## 3. Changes Made

Test names below are in `crates/folio-core/tests/hardening.rs` unless noted.
All semantic changes have regression coverage.

| Files | Reason | Regression evidence |
| --- | --- | --- |
| `src/family.rs`, core/workspace manifests | Correct grouping normalization, unnamed fallback, name union and its complexity | `normalized_families_merge_without_erasing_meaningful_differences`, `unrelated_nameless_faces_do_not_share_a_family`, `family_localized_names_contain_only_family_names` |
| `src/identity.rs`, `src/ids.rs` | Unambiguous metadata hashing; NFC without case folding logical names | `identity_name_pair_encoding_is_unambiguous`, existing identity/revision suites |
| `src/names.rs`, `src/lib.rs` | Correct platform locale interpretation, preserve raw values, stable ordering and narrow exports | `windows_and_mac_language_ids_are_not_interchangeable`, `format_one_tags_keep_valid_languages_and_reject_invalid_labels`, `raw_locales_and_original_name_strings_survive_serialization`, `every_tracked_name_id_is_preserved_and_typographic_names_win` |
| `src/parser.rs`, `src/format.rs` | Accurate collection container and actual member validation | `collection_container_does_not_claim_the_first_members_outline`, `corrupt_collection_offsets_isolate_first_or_last_member`, `corrupt_member_table_range_is_not_silently_accepted`, `all_broken_collection_members_fail_only_their_file` |
| `src/parser.rs`, `src/scan.rs` | Shared file reading, non-file rejection and alias deduplication | `canonical_path_aliases_are_one_candidate`, `explicit_symlink_aliases_merge_but_directory_symlinks_are_skipped`, `misleading_extensions_and_web_magic_use_the_shared_pipeline`, `permission_errors_are_isolated_and_keep_io_sources` |
| `src/face.rs` | Revision-specific FaceId docs and robust path serialization | `non_utf8_paths_do_not_break_public_json`; existing copy/revision tests |
| `tests/common/mod.rs`, `tests/hardening.rs` | Full-font collection packaging, localized name tables, valid checksum-preserving revision mutation | `real_table_revision_with_valid_checksums_keeps_identity`, collection/global-grouping and language tests |
| `tests/scanner.rs`, `tests/identity_revision.rs` | Strengthen mixed failure isolation and equal-identity TTC discriminator evidence | Mixed directory now includes TTF, OTF, TTC, ordinary files, broken TTF and WOFF2; existing TTC members assert equal IdentityId but different RevisionId |
| CLI `tests/cli.rs` and `src/main.rs` test module | Exercise actual executable JSON/human/error output and Internal filtering | 3 executable tests plus `internal_visibility_only_changes_the_human_report` |
| `fixtures/fonts/licenses/*`, fixture README | Match notices to actual distributions; independently check hashes and TTC provenance | All 7 font binaries match upstream bytes; all 8 recorded fixture hashes match; no font binary changed |
| Architecture, README and reports | Finalize lifetimes, API boundaries, tested behavior and limits | Source review plus command/smoke records below |

Intermediate checks were not concealed: an early Clippy run rejected two
non-octal zero permission literals; they were changed to `0o0`. A new test's
attempt to create a non-UTF-8 filename failed on this macOS filesystem with
`Illegal byte sequence`; it now tests in-memory parser-path JSON and diagnostic
JSON without claiming the filesystem can create such a filename.

An initial hardening experiment required every face to have `head`. The first
fresh real-system scan then returned 785 faces and rejected NISC18030.ttf with
“the head table is missing”. Inspection showed this was too strict for a catalog
of readable assets. The final rule permits absent `head`, validates it when
present, and rejects empty directories/out-of-range tables. A regression test
covers retained metadata without `head`; the final scan again includes all
786 faces. This correction came from new smoke evidence, not the old report.

## 4. Domain Model Final Decision

| ID | Final meaning | Changes on rebuild? | Intended reference |
| --- | --- | --- | --- |
| FontIdentityId | Logical face inferred from prioritized metadata | Usually no, when identity metadata remains the same | Long-term logical collections/favorites/recents/selection/font entries |
| FontRevisionId | Exact identity + full-file content + member discriminator | Yes when bytes/discriminator change | Exact binary/member revision and future revision-history reference |
| FontFaceId | Catalog row materializing one revision, merging its sources | Yes when revision changes | A concrete current catalog entry |

Keeping FaceId revision-specific lets one catalog retain multiple versions and
merge duplicate bytes without confusing a logical face with its current binary.
Paths remain solely source/operation context. **Future persistent logical
references must use IdentityId, not FaceId.** No database, FFI or sync schema is
introduced. Serde remains a CLI/debug representation only.

Identity input fields are individually length-prefixed, domain-separated and
normalized as documented in architecture. This fixes the baseline encoding;
**pre-audit IDs must be recomputed**. PS collisions remain deterministic and
explicit, and content-fallback identity cannot survive arbitrary byte changes.
Collection reordering changes revisions even if logical identity survives.

## 5. Family Aggregation Verification

| Scenario | Status | Evidence |
| --- | --- | --- |
| Several standalone files -> one family | VERIFIED | Lato Regular/Bold/Italic integration test |
| Standalone files in different directories | VERIFIED | `grouping_ignores_directory_layout` |
| Multiple faces in one collection | VERIFIED | Two real TTC members; runtime-composed Lato collection; six Helvetica members in smoke scan |
| Collection + standalone in different directories | VERIFIED | Lato Regular/Bold TTC under `a/` and Italic TTF under `b/` yield one family, three faces |
| Reasonable name normalization | VERIFIED | NFC composition, Unicode spaces and case; accent, width and word-boundary negative cases |
| Localized metadata retained | VERIFIED | Shared preferred English family with Chinese/Japanese variants retains both localized records |

There is one global grouping pass after all parsing and duplicate merging.
There is no path-based membership rule. Fonts that lack a shared preferred
family string are not merged through speculative translated aliases.

## 6. Formats

“Supported” below means metadata catalog parsing, not complete validation,
rendering, installation or activation.

| Format | Final status | Actual evidence / boundary |
| --- | --- | --- |
| TTF | SUPPORTED & VERIFIED | Three Lato fixtures; 649 system faces using this sfnt flavor |
| OTF | SUPPORTED & VERIFIED | Source Serif 4 CFF fixture; 137 system faces using OTTO |
| TTC | SUPPORTED & VERIFIED | Fontations/HarfBuzz TTC, runtime Lato TTC, real Helvetica TTC; corrupt first/last member and table-range isolation |
| OTC | SUPPORTED & VERIFIED — generated CFF-only collection | Full Source Serif binaries packaged with correct collection offsets; mixed TT/CFF tested in both orders. Externally distributed OTC: NOT VERIFIED |
| WOFF | KNOWN UNSUPPORTED | Real Inter WOFF magic, parser diagnostic, stats and human/JSON CLI; parsing NOT IMPLEMENTED |
| WOFF2 | KNOWN UNSUPPORTED | Real Inter WOFF2 magic, parser diagnostic, stats and human/JSON CLI; decompression/parsing NOT IMPLEMENTED |

Variable TTF is VERIFIED with Inter: axes, ordered axis names and Regular named
instance coordinates (`wght=400`, `opsz=14`). CFF2-specific parsing and every
possible font feature are NOT VERIFIED.

## 7. Final Commands

All four commands were run again after production fixes. Outputs are kept
locally under ignored `target/phase1b/final-*.txt`.

| Command | Result |
| --- | --- |
| `cargo build --workspace` | PASS, exit 0 |
| `cargo fmt --all --check` | PASS, exit 0, no output |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS, exit 0, no warnings |
| `cargo test --workspace` | PASS, 89 tests, 0 failed, 0 ignored |

Final suite breakdown: CLI unit 1, CLI executable 3, core unit 24, family 4,
hardening 28, identity/revision 6, parser 11, scanner 11, doctest 1. Net increase:
32 tests, plus strengthened assertions in existing tests.

The first independent regression run's nine failures were grouping normalization,
unnamed grouping, family-name filtering, locale platform separation, invalid
format-1 tags, corrupt table ranges, collection labeling, ambiguous identity
parts and canonical path alias deduplication. All now pass.

`cargo metadata --locked --offline` was inspected across the complete resolved
package set. Fontations versions remain 0.44.0/0.47.0; dev fixture crate remains
0.9.1. No ttf-parser, Tokio, database, HTTP client, Tauri, notify or UniFFI dependency
is present. Only the justified NFC library (unicode-normalization 0.1.25 and
its tinyvec dependency) was added; existing versions were not upgraded.
`git diff --check` passes; committed font binaries are unchanged.

## 8. Smoke Tests

These results are newly executed after hardening, using the current debug binary.
The old release-binary report was not reused.

```sh
target/debug/folio-cli scan /System/Library/Fonts --json
target/debug/folio-cli scan-files \
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf' \
  /System/Library/Fonts/LastResort.otf \
  /System/Library/Fonts/Helvetica.ttc --json
target/debug/folio-cli scan fixtures/fonts --json
target/debug/folio-cli scan /System/Library/Fonts
target/debug/folio-cli scan fixtures/fonts
```

| Metric | System directory | Explicit system files | Repository fixtures |
| --- | ---: | ---: | ---: |
| Files seen | 371 | 3 | 13 |
| Candidates | 369 | 3 | 8 |
| Supported files | 369 | 3 | 5 |
| Known unsupported files | 0 | 0 | 2 |
| Parsed/catalog faces | 786 | 8 | 5 |
| Families | 377 | 3 | 3 |
| Failed files | 0 | 0 | 1 |
| Issues | 0 | 0 | 3 |

The fixture failure is the deliberately invalid `not-a-font.ttf`; the other
issues are the two expected known-unsupported warnings. All CLI processes exit
0 and produce no stderr for these scans. Human output includes the expected
unsupported section and totals.

The system scan includes 58 variable faces and 114 Internal faces retained in
JSON. Explicit scanning includes six Helvetica TTC members, one TTF and one OTF;
one face is Internal. The full system-directory scan was repeated and JSON
compared byte-for-byte: identical. The mixed fixture test repeats eight explicit
input rotations and compares whole serialized results with directory output;
the CLI test independently compares two process outputs.

A separate CLI smoke with a temporary fixture chmod 000 under UID 501 returned
one `file_read`, one failed file and `Permission denied (os error 13)`, while the
scan process completed normally. Core tests also verify the underlying I/O
source and unreadable-root error behavior. No system font was copied, modified,
activated or committed. Local JSON/human outputs and summary are saved in
`target/phase1b/`.

## 9. Remaining Limitations

- PS names can collide; family names can collide across vendors. Identity is a
  deterministic metadata heuristic, not an authoritative global registry.
- Identity changes when identifying metadata changes, and content fallback
  changes with bytes. Pre-audit IDs are not retained after the encoding fix.
- Whole-file collection fingerprints and member indices make revisions sensitive
  to unrelated member edits/reordering. No per-face semantic hashing.
- No inferred equivalence between different translated preferred family names.
- Locale mapping is incomplete and the accepted BCP-47 syntax subset is limited;
  unsupported/unknown contexts are preserved raw, not assigned guessed tags.
- CFF2-specific behavior, externally distributed OTC, exhaustive malformed-input
  fuzzing and all name encodings are NOT VERIFIED. Generated OTC and actual TTC
  member isolation are verified only to the cases stated above.
- This is a metadata parser, not an outline/layout/checksum/signature validator.
  No absolute panic-freedom claim is made. Optional metadata can be absent.
- No 20,000-face benchmark, Linux/Windows execution or Rust 1.85 execution test
  was performed. The 1.85 floor reflects dependency declarations only.
- Directory scans filter extensions and skip descendant symlinks; explicit scans
  are required for extensionless/unknown-extension fonts. Hardlinks are separate
  sources; filesystem operations are not a transactional snapshot.
- Paths serialize lossily and OS diagnostic messages/metadata are host-specific.
  JSON is not a persistence format, FFI contract or cross-host byte identity.
- Style uses OS/2 and head flags; post provides a declared oblique angle. Slant
  variation axes and post-angle-only style inference are not implemented.
- Full-file memory reads/hashing and synchronous scans remain intentional.
  WOFF/WOFF2 parsing and all later-phase platform/product features are absent.

## 10. Phase 1 Final Verdict

**READY FOR PHASE 2**

The required Phase 1 acceptance criteria now have direct source/test/command
and real-machine evidence. The discovered correctness and fixture-notice issues
are fixed. Remaining limitations are explicit and are not Phase 1 blockers.
This verdict authorizes no implementation by itself: work stops at Phase 1B.
