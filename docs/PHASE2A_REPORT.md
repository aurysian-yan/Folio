# Folio — Phase 2A Final Report

Date: 2026-09-18. Status: **READY FOR PHASE 2B**.

This report reflects the final implementation after independent source/schema
review and hardening. Findings, initial results and the full evidence map are
in [PHASE2A_AUDIT.md](PHASE2A_AUDIT.md). Contracts are in
[docs/architecture.md](docs/architecture.md), Part II.

## Scope and Boundary

`folio-storage` owns SQLite persistence and incremental refresh. It depends on
`folio-core`; core contains no SQLite/migration dependency. Existing domain
constructors/accessors and `rebuild_catalog` are reused without changing Phase 1
identity, revision, source, grouping, locale or classification algorithms.

`FontIdentityId` is the durable logical identity; `FontRevisionId` identifies a
specific binary revision; `FontFaceId` identifies its catalog materialization.
Future durable logical references use IdentityId. Paths belong to filesystem
sources, not identity, revision or content fingerprints.

No Phase 2B collections, favorites, recents, search, FTS or ranking were added.
No UI/platform APIs, watchers, FFI or sync code was added. Existing frontend,
AGENTS.md and unrelated working-tree changes were preserved. No frontend
installation/build or dependency upgrade was performed during this audit.

## Storage and Migration

Locked storage dependencies remain rusqlite 0.40.2, bundled libsqlite3-sys 0.38.2
and bincode 1.3.3. Synchronous database operations; no async runtime or ORM.

Schema version **1** has two tables:

| Table | Role | Key and deletion behavior |
| --- | --- | --- |
| `library_roots` | Durable user data | Raw 16-byte ID; unique platform/path bytes; never removed by cache clear/Rebuild |
| `source_files` | Rebuildable per-file membership/cache | Internal integer row ID; unique root/platform/path; FK to root with `ON DELETE CASCADE` |

Rows store size, optional nanosecond mtime, BLAKE3 hash, parsed/unsupported/
malformed status, format, versioned payload and diagnostic. Future durable
state belongs to separate durable tables, which are not implemented now.

Migration uses `PRAGMA user_version`, plain CREATE statements and a transaction
including the version bump. Fresh/reopen/future/rollback/negative-version cases
are tested. Future versions fail before schema changes; negative versions fail
before the migration loop. No schema or payload version bump was needed.
Every connection explicitly enables foreign keys and a 2-second busy timeout.
New DBs use default DELETE journaling; WAL is not forced. Connection ownership
can move between threads, but operations must be serialized (`Send`, not `Sync`).

## Root and Path Contracts

Root IDs hash a domain tag plus length-prefixed platform/path bytes to 128 bits.
`add_root` stores an absolute normalized spelling: relative input is anchored
at insertion; redundant separators, `.` and trailing separators are removed;
`..` is preserved to avoid changing symlink meaning. Missing roots are allowed.
Root symlinks retain their spelling/ID; descendant symlinks are not followed.
Candidates are canonicalized. Canonicalization errors report incomplete
traversal and suppress missing-row deletion for that root.

Only same-platform/path conflicts return Existing; other SQL constraints are
errors. Recursive changes take effect on the next refresh, including removal
of nested membership after changing true to false. Overlapping roots retain
independent membership, and final source merging avoids duplicate entries.

Filesystem paths use Unix raw OsStr bytes or Windows UTF-16LE code units with a
platform tag. `display_path` is never a filesystem fallback. Foreign-platform,
empty/NUL and malformed path encodings fail visibly. Existing relative stored
roots are not silently reinterpreted or deleted.

## Payload and Corruption

Payload version **1** uses Folio-owned file DTOs with raw IDs/fingerprints,
names/locales, metadata, axes, instances and parser problems. Neither a whole
Catalog nor third-party parser objects are serialized. CLI JSON, cache DTO,
future sync schema and future FFI ABI are separate contracts.

Bincode fixed-integer encoding remains compatible. Decode is bounded by the
actual blob length, rejects trailing bytes and enforces a 64 MiB metadata
ceiling. SQL length-gates oversized blobs before Rust copying; encoding has
the same ceiling. Invalid size/version conversions, status/format/path/hash
fields and payload/hash mismatch are rejected.

`load_cached_catalog()` is strict and typed. Refresh reports and rebuilds local
bad cache rows when files are readable, without discarding durable roots.
Wrong payload versions are reparsed without deserializing the old format.
General database/durable-root corruption is surfaced. An orphan created by an
external FK-bypassing writer may require explicit cache clear + refresh.

## Incremental and Failure Semantics

1. Valid row + equal size/non-null nanosecond mtime: reuse without font-byte
   reads, hash or parse.
2. Metadata change: stable read/hash; equal content reuses parsing and updates
   source metadata in both returned Catalog and database.
3. New/changed content: parse and replace, including malformed/unsupported outcomes.
4. Complete traversal: delete unseen membership. Incomplete traversal preserves it.

**Metadata reuse is an accepted performance assumption.** Same-size content
changes with preserved/restored mtime can be missed. Rebuild reads/hashes/parses
available candidates for explicit verification, including after such imports
or restores. It cannot verify offline/unreadable files. A regression exercises
this exact limitation and recovery.

mtime conversion is checked, nanosecond-precision and nullable; pre-epoch,
overflow and platform failures disable metadata hits. Stable reads attempt
stat/read/stat at most three times, requiring regular files, available equal
times/sizes and a matching byte count. Instability/read errors keep old payloads
as stale snapshots, clear mtime trust, exclude old faces from that refresh
result, and report specific issues. Offline/incomplete roots retain cached
faces with explicit root/path issues. No atomic filesystem snapshot is claimed.

Known unsupported WOFF/WOFF2 and malformed files are cached deterministically.
Changed invalid content receives its own hash/error, never the old revision.
A legal font revision keeps logical identity but changes RevisionId/FaceId.

## Reconstruction, Transactions and API

File parsed faces -> global duplicate/source merge -> global family grouping
-> Catalog. Identical binaries at distinct paths retain multiple sources;
TTC + standalone, cross-directory and cross-root families round-trip.
Strict load uses one bulk SELECT, with Rust reconstruction rather than N+1.

Filesystem I/O/hash/parse happen outside write transactions. Staged invalid/
stale deletion and upserts commit atomically per root; a failing insert rolls
back preceding deletion/update. Earlier roots may remain committed if a later
root fails. SQLite supplies crash atomicity; no process-kill experiment is claimed.

API: `open`, `path`, `schema_version`, root add/list/get/remove/recursive update,
`clear_catalog_cache`, `load_cached_catalog`, `refresh`, `refresh_root`.
`refresh` combines all roots; `refresh_root` returns only the selected root's
scope. Cached load combines existing snapshots and does not verify freshness.
Stats count root memberships/work; Rebuild alone does not imply changed bytes.

## Final Verification

Actual final results on macOS aarch64, Rust/Cargo 1.94.1:

| Command | Result |
| --- | --- |
| `cargo build --workspace` | PASS |
| `cargo fmt --all --check` | PASS |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS |
| `cargo test --workspace` | **149 passed, 0 failed, 0 ignored** |
| `cargo check -p folio-storage --target x86_64-pc-windows-gnu` | PASS, compilation only |

89 unchanged Phase 1 tests + 60 storage tests. Storage breakdown: unit 12,
audit 17, corruption 3, incremental 8, migration 5, overlap 2, roots 5,
roots_behavior 2, roundtrip 5, doc 1. Initial suite had 125 tests.

## Newly Executed Smoke Results

Controlled temporary library, 7 licensed fixture files:

| Pass | Candidates | Metadata hits | Hash | Content hits | Parse | Changed | Faces | Families | Issues |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Fresh | 7 | 0 | 7 | 0 | 7 | 0 | 5 | 3 | 2 |
| Warm | 7 | 7 | 0 | 0 | 0 | 0 | 5 | 3 | 2 |
| Touch | 7 | 6 | 1 | 1 | 0 | 0 | 5 | 3 | 2 |
| Valid revision | 7 | 6 | 1 | 0 | 1 | 1 | 5 | 3 | 2 |

Revision changes `head.fontRevision` with valid table/sfnt checksums, not an
appended byte. Identity stayed `4722603f834d324643379e69cf2df5e0`;
RevisionId and FaceId changed, as asserted and recorded in the audit.
Both issues are expected WOFF/WOFF2 warnings; no failed/unstable files.

Read-only `/System/Library/Fonts`, fresh temporary DB:

| Pass | Candidates | Metadata hits | Hash | Parse | Faces | Families | Issues |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Cold | 369 | 0 | 369 | 369 | 786 | 377 | 0 |
| Warm | 369 | 369 | 0 | 0 | 786 | 377 | 0 |

## Verification Limits

- macOS non-UTF-8 filesystem path round-trip: **NOT VERIFIED**, filesystem
  rejects fixture creation with EILSEQ. Its guarded test returns early; pure
  Unix raw-byte codec tests pass.
- Windows runtime: **NOT VERIFIED**; Windows cfg code compiles and pure UTF-16
  codec tests pass on the host. No toolchain installation was needed.
- Metadata reuse/races, stale fallback, per-root atomicity, serialized caller
  operations, 64 MiB metadata ceiling, in-memory reconstruction and lack of
  large-library benchmark remain explicit limitations.
- Malformed diagnostics are human-readable strings. No watcher, platform
  activation, UI, FFI, sync or Phase 2B behavior is implemented.

**READY FOR PHASE 2B**
