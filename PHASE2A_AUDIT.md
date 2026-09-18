# Folio — Phase 2A Independent Audit & Finalization

Date: 2026-09-18. Verdict: **READY FOR PHASE 2B**.

Scope: persistence and incremental catalog only. This audit inspected source,
SQLite schema, dependency manifests/lockfile, tests and actual command output.
The prior report's PASS labels were not used as evidence. No Phase 2B work was
started. No frontend, AGENTS.md, dependency/toolchain installation, core domain
algorithm or Phase 1 test was changed by this audit.

## Initial State

The working tree was already dirty on arrival:

```text
 M Cargo.lock
 M Cargo.toml
 M README.md
 M crates/folio-core/src/attributes.rs
 M crates/folio-core/src/fingerprint.rs
 M crates/folio-core/src/ids.rs
 M crates/folio-core/src/lib.rs
 M crates/folio-core/src/scan.rs
 M docs/architecture.md
?? PHASE2A_REPORT.md
?? crates/folio-storage/
```

Those pre-existing changes were preserved. Before editing code, actual results
were:

| Command | Initial result |
| --- | --- |
| `git status --short` | State above |
| `cargo build --workspace` | Exit 0; dev profile 0.23 s |
| `cargo fmt --all --check` | Exit 0; no output |
| `cargo clippy --workspace --all-targets -- -D warnings` | Exit 0; 0.18 s |
| `cargo test --workspace` | 125 passed, 0 failed; 89 Phase 1 + 36 storage |

Environment: macOS `aarch64-apple-darwin`, UID 501;
`rustc 1.94.1 (e408947bf 2026-03-25)`,
`cargo 1.94.1 (29ea6fb6a 2026-03-24)`.
Concurrent Cargo commands sometimes waited for build/package locks; durations
are observed command output, not benchmarks.

## Audit Findings

### Critical

No remaining critical finding. No loss of durable roots through cache clear or
Rebuild was found. Foreign keys were already explicitly enabled; this audit did
not misreport SQLite's default as an actual bug in Folio.

### Major — fixed

| Finding in initial source | Final behavior | Regression evidence |
| --- | --- | --- |
| Foreign-platform decode substituted `display_path`, which could become a real scan/source path | Typed path error; display text never resolves a file; durable row remains | `foreign_platform_root_never_scans_its_display_path`, codec unit test |
| Relative roots were persisted with working-directory-dependent meaning | Insertion stores an absolute normalized spelling; unknown legacy relative roots fail without deletion | `root_paths_are_absolute_and_trailing_slashes_are_normalized`, durable corruption test |
| Cache payload decode/read lacked an explicit application bound | SQL length gate before Rust blob copy; 64 MiB per-file metadata ceiling; bounded fixed-integer bincode decode and trailing-byte rejection | `bounded_decode_rejects_huge_lengths_invalid_tags_and_trailing_bytes`, oversized SQL blob case |
| Invalid row columns aborted refresh; negative sizes became zero and large versions could wrap to a supported `u32` | Checked conversions and row-local invalidation/rebuild with diagnostics | `corrupted_cache_columns_are_typed_and_self_healing` (16 mutations) |
| Missing or changed row hashes could still support a metadata hit without payload/hash consistency | Required hash, validated length and face fingerprint binding | Same mutation matrix, including null/short/zeroed hash |
| `INSERT OR IGNORE` could hide an ID collision/other constraint and return the wrong existing root | Conflict handling targets only `(path_platform, path_bytes)` | `root_path_conflict_does_not_hide_other_constraints` |
| Canonicalization failure silently fell back to a different path spelling without making traversal incomplete | Diagnostic, skip unresolved candidate, whole-root suppression of unseen-row deletion | Injected canonicalization-failure unit test plus real incomplete traversal integration test |
| Failed/unstable reads kept the old row eligible for a later metadata hit | Old payload remains a stale snapshot; mtime cleared, old face excluded from that result; next refresh must read/hash | Deterministically injected failure and instability with real cache commit/recovery |
| Negative `user_version` could enter an enormous sequence of no-op migration transactions | Reject negative version before migration | `negative_schema_version_is_rejected_without_migration` with `i32::MIN` |

The payload bound is defensive hardening. This audit does not claim to have
proved a specific exploitable allocation attack against every original bincode
slice-deserialization path; it verified the new explicit limits and malicious
length-prefix rejection.

### Minor — fixed or clarified

- A touch-only content hit returned sources with the old mtime even though the
  database stored the new one. The returned catalog now matches strict reload;
  the existing touch regression asserts the actual filesystem mtime.
- Rebuild/payload repair counted an unchanged binary as `files_changed`.
  Changed now requires a different known content hash.
- Cached malformed files omitted `failed_files`; cold and warm observations
  now count the same failure.
- Stable-read comparison now also requires regular files, available timestamps
  and actual byte length matching the final stat. Tests cover three failed
  attempts, short bytes, and a successful retry.
- A 2-second busy timeout is explicit; no WAL policy was introduced. Rusqlite
  previously supplied its own 5-second default, so this was configuration
  clarification, not a claim that no timeout existed.
- The prior description called every refresh result global. The existing
  `refresh_root` behavior is intentionally preserved and documented/tested as
  root-scoped; `refresh` and `load_cached_catalog` combine all roots.
- Content revision coverage now mutates `head.fontRevision` and verifies table
  and sfnt checksums instead of relying on an appended arbitrary byte.

### No Issue / Deliberate Limitation

- Identity, revision and materialized face semantics survived exact round-trip.
  Durable logical references continue to use `FontIdentityId`. Paths occur only
  in filesystem/source context, never identity/revision/fingerprint inputs.
- `folio-core` depends on neither storage nor SQLite. Its existing additive
  raw-ID/fingerprint constructors, width-class accessor and catalog builder
  are domain operations needed by an external crate. Making them `pub(crate)`
  would break real storage callers; no public SQL/DTO API was added to core.
- SQLite migration already used plain CREATE statements and a transaction,
  not `CREATE TABLE IF NOT EXISTS` masking schema mismatch.
- Cache is parsed-file DTO data, never a pre-grouped Catalog blob or serialized
  Fontations/rusqlite internals. CLI JSON, DB DTO, future sync schema and FFI ABI
  remain separate contracts.
- `load_cached_catalog` uses one bulk query and Rust merge/grouping; no per-face
  N+1. Refresh queries/commits per root. No 20,000-face benchmark is claimed.
- A valid font becoming malformed already replaced its old revision. SQL
  assertions now additionally prove malformed status, absent payload and the
  new invalid file's hash; strict reload contains no old face.
- WOFF/WOFF2 remain Known Unsupported, including warm and touch paths.
  Malformed outcomes are cached deterministically and changed bytes retry parsing.
- Tests use temporary databases and licensed fixtures. The system-font smoke
  was an explicit read-only operation; no system fonts were modified/copied
  into the repository. The chmod test ran successfully as UID 501 and restored
  permissions. Phase 1 assertions were not relaxed or edited.

## SQLite / Migration Final Decision

Schema version remains **1**, cache payload version remains **1**. Existing
fixed-integer payload bytes remain compatible; no migration is required for
these validation/refresh changes. `library_roots` is durable user state;
`source_files` is a rebuildable membership/cache table. Cache clear names only
`source_files`. No future durable tables are implemented or swept by generic
schema deletion.

Every `FolioDatabase::open` sets `foreign_keys = ON` and `busy_timeout = 2000` ms.
New databases use default DELETE journaling; existing journal modes are not
forced to change. Reopened-connection tests inspect both PRAGMAs and SQL rows
after deleting roots. For overlapping A/B roots, deleting B removes only B's
membership; A still contributes the source; deleting A removes the last row.

Migration tests cover fresh DB, reopen, future refusal (database bytes remain
identical), early and late DDL conflicts/rollback, and negative versions.
Current-version externally damaged schemas produce typed SQL errors when used;
there is no schema-repair/downgrade mechanism. Connection operations must be
serialized by callers; rusqlite is Send, not Sync. A busy timeout is not a
cross-connection refresh coordination protocol.

## Incremental-cache Correctness Model

Decision **A**: equal size + non-null equal nanosecond mtime + valid cache row
allows Incremental to reuse parsing without reading font bytes or hashing.
This is an explicit performance assumption, not cryptographic correctness.
Same-size writes with restored/preserved timestamps can be missed. The test
`same_size_and_mtime_is_an_explicit_incremental_assumption` demonstrates that
limitation and then proves Rebuild finds the new binary revision.

Rebuild verifies content of available readable candidates through fresh reads,
hashes and parsing. Use it after timestamp-preserving imports/restores or when
explicit content verification is required. Offline/unreadable files cannot be
verified by Rebuild either. Normal warm refresh must keep zero hash/parse work.

Time comes from `Metadata::modified()`. Checked nanosecond conversion returns
None for pre-epoch, overflow or platform conversion failure. None disables the
metadata fast path. No seconds truncation or unsigned wrap is used.

Stat/read/stat retries at most three times, comparing size/time and byte count.
It is not an atomic filesystem snapshot and cannot exclude same-metadata ABA
races. Persistent instability/read failure emits the specific issue, preserves
old payload/hash as stale, clears mtime trust, and excludes the old face from
that refresh result. Strict cached load remains a possibly stale offline
snapshot API; callers must not infer current-source verification from it.

## Root-unavailable and Traversal Behavior

A missing/unreadable root produces a root-level `RootUnavailable`, preserves
durable state and valid cache, and contributes cached faces as stale fallback.
Returning roots recover normally on the next Incremental refresh. An unreadable
subdirectory or failed canonicalization produces `TraversalIncomplete` and
suppresses unseen-row deletion for the whole root. This is intentionally
conservative. Corrupt-row invalidation is distinct from filesystem deletion
and remains allowed with diagnostics while offline.

## Cache-corruption Behavior

Strict load fails visibly with typed storage/path/ID/SQL errors. Refresh can
self-heal readable candidates with bad payload versions, truncated/garbage/
oversized payloads, bad enum tags, invalid status/format/path, out-of-range
size/version and missing/inconsistent hash. It does not deserialize an
unsupported payload version. Invalid rows are staged for deletion and replaced
atomically. New diagnostics identify corruption; it is not a silent cache miss.

SQL projects oversized payloads out before copying to Rust. Decode limit is
the actual blob size, with a 64 MiB hard ceiling also applied to encoding.
The limit covers per-file metadata, not font outlines. All exercised real TTCs
fit it; arbitrarily large legitimate metadata is not promised. This is not a
cryptographic integrity check of every plausible database edit.

Durable root corruption is returned without deleting the root. If an external
writer bypasses FK enforcement and corrupts `source_files.root_id`, the orphan
can fall outside per-root refresh queries. Strict load still reports the bad
ID; explicit cache clear + refresh repairs it while preserving roots (tested).
General SQLite page/file corruption is not repaired automatically.

## Path Handling

Unix raw bytes and Windows UTF-16LE code units are lossless. Display strings
are diagnostic-only. Foreign platform/NUL/empty encodings fail; odd UTF-16 byte
counts fail. Absolute insertion removes `.`/redundant/trailing separators but
preserves `..`; root symlinks retain their selected spelling and ID. Descendant
symlinks are skipped, matching Phase 1. Candidate canonicalization deduplicates
aliases; two distinct paths with identical bytes retain two sources, and hard
links are not collapsed by inode.

Pure codec tests ran on macOS. Installed Windows GNU tools successfully built
the Windows cfg path branch; no toolchain was installed. Windows runtime tests
are **NOT VERIFIED**. The macOS filesystem rejects the non-UTF-8 fixture with
EILSEQ (OS error 92), so filesystem-level non-UTF-8 round-trip is **NOT VERIFIED**;
the Unix-byte codec test passes. The test runner reports that guarded case as
passed even though the filesystem exercise returned early; this report does
not count it as verified filesystem behavior.

## Transaction Behavior

Filesystem enumeration/read/hash/parse occur before the SQLite write transaction.
Invalid/stale deletion and all upserts commit together for each root. A regression
now deletes/updates an existing row, then fails a later FK-constrained insert,
and proves the original size/message/row are restored. There is no destructive
DELETE outside this transaction during refresh. Cache clear is a separate
explicit API. Earlier roots may remain committed if a later root fails; whole
library atomicity is not claimed. SQLite provides crash atomicity; no process
kill, disk fault injection or extra crash journal was implemented.

## Changes Made and Evidence Map

Production edits are confined to `crates/folio-storage/src/{cache,cache_payload,
db,error,ids,path_codec,refresh,root,schema}.rs`. Added `tests/audit.rs`; extended
storage unit tests, migration/corruption/incremental tests and the test-only
checksum-valid revision helper. Updated architecture and Phase 2A reports.

| Request area | Evidence |
| --- | --- |
| 1–4, 22–24: boundaries, IDs, cache, reconstruction | Manifests/lockfile/core source inspection; exact `roundtrip` suite; cross-root TTC + standalone and duplicate-source tests |
| 5–7, 28–30, 32: FK, roots, precise conflicts, connection settings | `audit` roots/SQL/collision/recursive tests; connection unit test |
| 6, 20–21: migration and atomicity | `migration` suite, future byte equality/late conflict test, commit rollback unit test |
| 8–11, 25–27: incremental, timestamps, failure states, stats | `incremental`, `corruption`, bounded read/time tests, smoke and mutation matrix |
| 12–16: offline, traversal, overlap and paths | `roots_behavior`, `overlap`, canonicalization/codec/symlink tests; Windows check |
| 17–19: payload and database corruption | Bounded decoder test, 16 cache mutations, durable corruption and malformed-ID tests |
| 31, 33–35: query/thread/test discipline, Phase 1 | Bulk-query and rusqlite source review; 89 unchanged Phase 1 tests |
| 36–40: actual smoke runs | Observations below |
| 41–45: scope, verification and finalization | Final command results, scoped file review, reports; no Phase 2B code |

## Final Test Count and Command Results

Actual final commands, all exit 0:

| Command | Result |
| --- | --- |
| `cargo build --workspace` | PASS; dev profile 2.78 s |
| `cargo fmt --all --check` | PASS; no output |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS; no warnings; 3.73 s |
| `cargo test --workspace` | **149 passed, 0 failed, 0 ignored** |
| `cargo check -p folio-storage --target x86_64-pc-windows-gnu` | PASS; 3.27 s; compilation only |

Phase 1: CLI unit 1 + CLI integration 3 + core unit 24 + family 4 + hardening 28
+ identity/revision 6 + parser 11 + scanner 11 + core doc 1 = **89**.

Storage: unit 12 + audit 17 + corruption 3 + incremental 8 + migration 5 + overlap
2 + roots 5 + roots_behavior 2 + roundtrip 5 + storage doc 1 = **60**.
Total **149**, up from 125: 24 new tests, with additional assertions in existing
storage tests. One non-UTF-8 filesystem test has the disclosed host guard above.

## Fresh / Warm / Touch / Content-change Smoke Results

Actual command:
`cargo test -p folio-storage --test audit fresh_warm_touch_and_valid_revision_smoke -- --nocapture`.
Seven licensed fixtures in a temporary library: Lato Regular/Bold/Italic,
Source Serif 4 OTF, Inter Variable, WOFF and WOFF2.

| Pass | Candidates | Metadata hits | Hash | Content hits | Parse | Added | Changed | Faces | Families | Issues |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Fresh | 7 | 0 | 7 | 0 | 7 | 7 | 0 | 5 | 3 | 2 |
| Warm | 7 | 7 | 0 | 0 | 0 | 0 | 0 | 5 | 3 | 2 |
| Touch | 7 | 6 | 1 | 1 | 0 | 0 | 0 | 5 | 3 | 2 |
| Valid revision | 7 | 6 | 1 | 0 | 1 | 0 | 1 | 5 | 3 | 2 |

Each pass: known unsupported 2, malformed/failed/unstable/removed/corrupt 0;
no unavailable/incomplete roots. Newly parsed faces: 5 / 0 / 0 / 1.
The two issues are the expected unsupported web fonts.

The revision helper changes `head.fontRevision`, keeps length, and checks every
table checksum plus the sfnt checksum; it does not append garbage. Observed IDs:

```text
IdentityId: 4722603f834d324643379e69cf2df5e0 (unchanged)
RevisionId: 17c9b9ee5e391f3e730a62e266ee1e4e -> c7b9bd88d9e74681daff3b3997ec0291
FaceId:     9afc902e358ac62c06bb3d968d4e3cb2 -> 3c58f990822312be5684e4395158cead
```

Actual system smoke: `cargo run -p folio-storage --example refresh_smoke --
<temporary-db> /System/Library/Fonts`. Database was fresh and deleted afterward;
font directory was only read.

| Pass | Candidates | Metadata hits | Hash | Parse | Added | Faces | Families | Issues |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Cold | 369 | 0 | 369 | 369 | 369 | 786 | 377 | 0 |
| Warm | 369 | 369 | 0 | 0 | 0 | 786 | 377 | 0 |

Both passes: content hits/changed/removed/unsupported/malformed/failed/unstable
all 0. These are new observations, even though they match the prior report.

## Remaining Limitations

- Incremental's size/mtime assumption and stat/read/stat race limits are explicit.
- Offline/incomplete roots contribute stale fallback with root-level issues;
  there is no per-face freshness flag or atomic whole-filesystem snapshot.
- Refresh is synchronous and atomic per root. Callers serialize operations;
  no async worker, multi-connection conflict protocol or watcher is provided.
- `refresh_root` returns only its scope; it is not a whole-library replacement.
- Cache is bounded but still loaded/reconstructed in memory; no large-library
  benchmark, arbitrary hostile-DB authentication or exhaustive fuzz proof.
- Orphan cache memberships after external FK bypass require explicit clear;
  general SQLite corruption and durable corruption are surfaced, not silently repaired.
- Windows runtime and non-UTF-8 filesystem execution remain NOT VERIFIED as
  described. macOS compilation, pure codecs and Windows cross-compilation pass.
- Malformed cache diagnostics remain human-readable strings. Parser capability
  limitations from Phase 1 remain unchanged.

## Final Verdict

**READY FOR PHASE 2B**. No remaining Phase 2A blocker found within the verified
scope. This audit ends at persistence + incremental catalog.
