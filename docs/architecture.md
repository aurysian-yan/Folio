# Folio architecture

Status: Rust Font Catalog Core (Phase 1B) plus **Phase 2A — Persistent &
Incremental Catalog**. Verification and remaining limits are recorded in
[PHASE1_AUDIT.md](../PHASE1_AUDIT.md) and
[PHASE2A_REPORT.md](../PHASE2A_REPORT.md).

Sections 1–11 below are the audited Phase 1 core decisions. Part II (from §12)
records the Phase 2A persistence and incremental-cache decisions in
`folio-storage`.

## 1. Scope and public boundary

The synchronous core discovers assets, reads metadata, derives IDs, groups
faces globally, and returns a catalog with diagnostics. It does not activate,
install, watch, sync, index, render or store fonts in a database.

The public API is the explicit re-export list in `folio-core/src/lib.rs`.
Implementation modules are private. Callers use:

- `scan_directory`, `scan_files`, or `scan(ScanInput, &ScanOptions)` for catalogs.
- `parse_font_file` for one file and `parse_font_data` for caller-owned bytes.
  The latter's path, file size and modified time are source context only.
- Owned Folio models, typed IDs, attributes, and errors. No parser-specific
  type is required in a public signature or serialized model.

The two parse functions are intentional import/inspection boundaries, not
exports added for testing. Grouping, ID construction and name selection are
private or `pub(crate)`. `classify_names` is a small, pure public policy helper.

## 2. Domain model and ID lifetimes

| Type | Meaning | Lifetime |
| --- | --- | --- |
| `FontSource` | Location of bytes and member index | Changes with location |
| `ContentFingerprint` | Full-file BLAKE3, 256 bits | Changes with bytes |
| `FontIdentity` / `FontIdentityId` | Best metadata-derived logical face | Survives builds with the same identity metadata |
| `FontRevision` / `FontRevisionId` | Identity + full-file content + collection discriminator | One exact binary/member revision |
| `FontFace` / `FontFaceId` | A materialized revision in a catalog, with all its sources | Changes when the revision changes |
| `FontFamily` / `FontFamilyId` | Global metadata-based family group | Determined by its normalized grouping key |

**`FontFace` means a concrete materialized revision, not the persistent logical
face. `FontFaceId` must change when `FontRevisionId` changes.** Two copies of
identical bytes merge into one catalog face with multiple sources. Multiple
revisions of the same identity remain separate catalog faces.

**Long-term logical references use `FontIdentityId`.** This applies to future
collections, favorites, recents, logical UI selection and logical WebDAV font
entries. A future revision-history item or a selection pinned to exact bytes
uses `FontRevisionId`; `FontFaceId` is appropriate for a specific current
catalog row. Future hot reload should resolve the logical identity to the
new revision rather than treat a previous FaceId as permanent. No such
features or persistence schemas are implemented here.

`ParsedFace` contains the full `FontIdentity`, `FontRevision`, metadata and
one source. `FontFace` exposes their IDs and merges sources; `Catalog` owns
families and their faces. This phase does not introduce entity registries.

Paths belong to sources. `ParsedFontFile.path` and diagnostic paths are
operation context, not logical identifiers. Paths, filenames, directory
layout, file size and mtime never participate in identity, fingerprint,
revision, FaceId or family membership.

## 3. Exact ID encoding

`H(domain, parts)` means BLAKE3 with the ASCII domain bytes followed by each
part prefixed by its byte length as a little-endian `u64`. Take the first
16 digest bytes; display as 32 lowercase hex characters. Domains include
the trailing NUL byte shown below. Hash collisions remain theoretically
possible; these are content-derived identifiers, not mathematical proofs.

| ID | Domain | Parts |
| --- | --- | --- |
| Family | `folio-family\0` | UTF-8 family key |
| Identity | `folio-identity\0` | Strategy tag, then each input separately |
| Revision | `folio-revision\0` | Raw 16-byte identity, raw 32-byte fingerprint, 5-byte discriminator |
| Face | `folio-face\0` | Raw 16-byte revision |

Identity parts, by first usable strategy:

1. `["ps", PostScript name]` (name ID 6).
2. `["typo", family, subfamily]` (16 and 17, both required).
3. `["legacy", family, subfamily]` (1 and 2, both required).
4. `["full", full name]` (4).
5. `["content", raw fingerprint, little-endian u32 face index]`.

Every input field is length-prefixed individually. Embedded NULs cannot
make `(A\0B, C)` collide with `(A, B\0C)` through ambiguous concatenation.
Identity strings use Unicode whitespace trimming/collapse and NFC, retaining
case. Raw localized metadata is preserved separately.

A missing typographic subfamily does not combine a typographic family with
a legacy subfamily for identity: the complete legacy pair is tried next.
Display fields can independently fall back from 16 to 1 and from 17 to 2.
Content fallback is explicitly marked and emits a metadata warning; even a
family-only record is insufficient to identify a logical face reliably.

**PostScript names are not globally unique.** Equal normalized PS names
intentionally share an IdentityId even if family/subfamily differs. Different
bytes still produce separate revisions and faces, and family grouping remains
independent. This is a tested limitation; IdentityId is not proof of authorship
or a unique vendor identifier. Metadata renames may change identity.

Phase 1B changes identity encoding and family normalization from the baseline.
Pre-audit IDs must be recomputed. No persisted ID compatibility is promised
with that unfinished baseline.

## 4. Revision and collection semantics

For standalone fonts the discriminator is five zero bytes. For a collection
it is byte `1` followed by the member index as little-endian `u32`. Standalone
and collection index zero are therefore distinct.

Same identity + same content + same discriminator yields the same revision.
Moving or copying bytes preserves revision and FaceId; changed content changes
both. Whole-file hashing means all members share a fingerprint. Editing any
member or changing collection order changes the file fingerprint and can
change every member's revision. An index change also changes the discriminator.
Extraction to a standalone sfnt is a new revision. Stable metadata can preserve
IdentityId across these operations. Per-member semantic content hashing and
revision history are not implemented.

The append-byte test checks this content invariant only. A stronger test edits
`head.fontRevision`, rebuilds table checksums and `checkSumAdjustment`, verifies
all checksums, and parses both complete binaries. It proves equal identity and
different revision without pretending to run a font compiler.

## 5. Global family aggregation

Both scan inputs converge on this sequence:

```text
all candidate files -> all parsed faces -> merge exact FaceIds
                   -> one global family grouping -> sorted Catalog
```

There is no per-file grouping/concatenation stage. A TTC and standalone fonts
from unrelated directories join the same family when their selected family
metadata agrees.

Family keys use the preferred typographic family (16), else legacy family (1).
The key is `family\0` plus Unicode whitespace trim/collapse, NFC, Unicode
lowercase and NFC again. This groups `Inter`, `inter`, ` Inter ` and whitespace
variants. It preserves accents, punctuation, word boundaries and compatibility
characters: `Cafe` != `Café`, `AB` != `A B`, and fullwidth letters are not folded.
No NFKC, accent stripping, transliteration or full case folding is used.

Without a usable family, use `ps\0` + trimmed PS name, then `full\0` + trimmed
full name; these fallback keys remain case-sensitive. With neither, use
`unnamed\0` + the hex IdentityId. Unrelated nameless faces cannot merge into a
single universal unnamed family. No filename-prefix or style-suffix guessing.

Localized aliases are retained, not used to infer transitive equivalence.
Fonts whose preferred family strings differ and lack a common selected name
can remain separate. Conversely, unrelated vendors declaring the same family
name can group together. No authoritative family registry exists in Phase 1.

Family localized names contain only IDs 1, 16 and 21. All other names remain
on the face. The display name comes from the lowest FaceId representative,
independent of source order; membership normalization does not rewrite metadata.

## 6. Names and locales

Tracked face-level name IDs: **1, 2, 4, 5, 6, 16, 17, 21, 22**. Axis names and
named-instance labels also use their referenced name IDs. Skrifa/Fontations
provide string decoding; Folio owns the resulting strings and locale records.

Each `LocalizedName` preserves the decoded value plus `NameLocale` containing
platform ID, encoding ID, raw language ID and an optional original format-1
language tag. Whitespace-only names are omitted. Invalid or unsupported
encodings may produce no decodable string; this is not a byte-preserving name
archive.

Windows and Macintosh language-ID namespaces are distinct. Folio restricts
upstream mapping to the appropriate platform range so Windows ID 0 is not
mislabeled as Mac English, nor Mac 0x0409 as Windows English. Format-1 tags are
read from their indexed language records without the upstream 30-byte limit.

`language` accepts a conservative BCP-47 syntax subset: language, optional
script, optional region, and variants. Unsupported forms (including extensions,
private use and extlang), invalid tags and unknown IDs produce `None`, preserving
raw context. Tags are declarations, not independently verified IANA registry
entries. Platform mapping coverage is incomplete; unknown is preferred to a
guess. UTF-16 English, Japanese, Chinese, MacRoman English/French and format-1
English/Chinese are tested. All possible locales/encodings are **NOT VERIFIED**.

Display selection: `en-US` > `en` > unknown/no language > other. Equal ranks
use the full `LocalizedName` ordering, not parser iteration order. Face and axis
name lists are sorted/deduplicated by kind, language, value and raw locale.

## 7. Format model and capabilities

`FontFormat` is `TrueType | OpenType | Collection | Woff | Woff2`.

- `TrueType`: TrueType-flavored sfnt (`0x00010000` or `true`), including some
  bitmap-only assets; it does not guarantee a `glyf` outline exists.
- `OpenType`: `OTTO` sfnt flavor, normally CFF/CFF2.
- `Collection`: `ttcf` container, used by both TTC and OTC. The file label does
  not depend on the first member, member order or a damaged first member.
- Each parsed/catalog face stores its own sfnt flavor (`TrueType`/`OpenType`).
- `Woff`/`Woff2`: recognized by `wOFF`/`wOF2`, unsupported, planned for Folio v2.

[OpenType explicitly permits mixed-outline collections](https://learn.microsoft.com/en-us/typography/opentype/spec/otff#font-collections).
TTF and OTF metadata parsing, real TTC, generated CFF-only OTC and generated
mixed collections are tested. Externally distributed OTC files and CFF2-specific
behavior are **NOT VERIFIED**. Catalog parsing is not full font validation.

Format is detected from bytes. Extensions only filter directory candidates.
An image named `.woff` is malformed; genuine web-font magic with an unrelated
extension is known-unsupported in an explicit scan. Unsupported files are
warnings with `format` and planned support, counted separately from failed files.
Magic recognition does not validate WOFF headers, decompress or parse web fonts.

Managed assets and installable fonts are different concepts. `is_supported()`
means this version can attempt metadata parsing, not that an operating system
can install, activate or render the asset. Platform capabilities are deferred.

## 8. Scanner, failures and diagnostics

Directory discovery uses `walkdir`, recursive by default, known extensions,
and no following of descendant symlinks. A root symlink can name the selected
directory. Explicit discovery accepts every supplied path regardless of extension
and follows explicitly selected file symlinks. Existing candidate paths are
canonicalized, sorted and deduplicated; unresolved paths retain the supplied
spelling so a read issue can be reported. Hard links remain distinct sources.

Both modes then use `parse_font_file`, the same content parser, global merge,
grouping, issue ordering and stats. Directory inputs passed as explicit files
are nonfatal `FileRead` issues. Ordinary non-files are rejected before reading.
Path/metadata/read operations do not form a transactional filesystem snapshot.

- `ScanError`: only an inaccessible/non-directory root prevents the scan.
- `FontError`: whole-file failure from a direct parse; I/O and opaque
  `ParserError` preserve source errors and context.
- `FaceProblem`: a member failure or incomplete identity metadata at the parser
  result boundary.
- `ScanIssue`: final owned diagnostic DTO, with severity, category, path,
  optional member index/format and message. Source errors are formatted here,
  not in the parser; this DTO does not preserve an error chain for downcasting.

The parser rejects an empty table directory, out-of-bounds table ranges and
an unreadable `head` table when one is present. Missing `head` alone is allowed
(e.g. the observed macOS NISC18030 asset); optional absent metadata remains
`None`. It does not validate every outline, layout subtable, checksum or signature.
There is no proof of panic freedom for all possible malformed input.

Bad collection offsets and out-of-bounds member tables are tested with another
member still valid. They become `CollectionProblem` with the failed index; valid
members survive. When all members fail, the file fails with the first parser
error. Partially usable collections count as supported files, not failed files.

`files_seen` counts regular files during directory discovery; for explicit scans
it counts canonicalized unique inputs, including invalid selections.
`faces_parsed` is before duplicate merging; `Catalog::face_count()` is after it.
WOFF/WOFF2 increment `unsupported_known_font_files`, never `failed_files`.

## 9. Classification

Classification remains conservative metadata policy: a dot-prefixed selected
PS or family name is `Internal`; otherwise a case-insensitive `lastresort`
substring is `SystemLike`; all others are `Normal`. Thus **`.LastResort` is
Internal**. The dot rule's precedence is intentional and tested.

This small heuristic is not proof that a font is OS-owned. It neither deletes
nor drops anything. Catalog and JSON include all faces; only the human CLI view
hides Internal by default. `--show-internal` restores those rows. No system-font
blacklist is introduced.

## 10. Determinism, serialization and performance

Stable unchanged inputs yield byte-identical JSON across repeated scans and
explicit-input permutations. Families sort by lowercase display name then ID;
faces by Normal/Oblique/Italic, weight, lowercase subfamily, then FaceId; sources
sort/deduplicate by their full fields. Issues sort by path, member index,
severity, kind and message. Public ordering does not depend on HashMap iteration.

Serde is a **CLI/debug DTO**, not an FFI ABI, database schema or WebDAV schema.
No parser model is serialized. All path DTOs use lossy UTF-8 display, including
`ParsedFontFile`; they are not round-trip filesystem identifiers. Filesystem
metadata and OS error text can differ across hosts or over time, so cross-host
JSON equality is not promised.

Global merging/grouping uses BTreeMaps and family-name unions use BTreeSets.
The former repeated vector membership checks could become quadratic; they are
removed. Sorting and grouping are O(N log N) plus name/string costs. No 20,000-face
benchmark is claimed. Full-file reads and hashes, single-thread parsing and
full scans are intentional. No cache, concurrency, database or search index.

## 11. Dependencies and later phases

Fontations remains `read-fonts 0.44.0` / `skrifa 0.47.0`. No existing dependency
was upgraded for this audit. `unicode-normalization 0.1.25` supplies tested NFC
rather than a partial custom normalizer; it adds `tinyvec` transitively. The
workspace Rust declaration is 1.85 to match existing dependency requirements;
the actual validation compiler is 1.94.1, not an MSRV execution test.

The Phase 1 core uses no ttf-parser, Tokio, SQLite, HTTP client, Tauri or
UniFFI. Phase 2A adds SQLite only through `folio-storage`. The JavaScript workspace is separate from the Rust workspace and now
contains only a pnpm dependency baseline for the planned shared Windows/Linux
React desktop UI: HeroUI v3 and Tailwind CSS v4. UI source is intentionally
deferred. Tests use `font-test-data 0.9.1` and local licensed fixtures; see
their provenance and license details in
[fixtures/fonts/README.md](../fixtures/fonts/README.md).

Future priorities remain macOS (SwiftUI/AppKit + UniFFI), Android
(Kotlin/Compose/MIUIX + UniFFI), Windows/Linux (Tauri 2 + shared React,
HeroUI v3, Tailwind CSS v4 and direct Cargo), and iOS/iPadOS (SwiftUI +
UniFFI). These are context only; no platform shell, FFI, WebDAV, hot reload or
activation code was added to the Rust core. Phase 2A adds local persistence
on top of the core (Part II); the Phase 1 core itself remains stateless.

---

# Part II — Persistence & Incremental Catalog (Phase 2A)

Phase 2A upgrades Folio from "rescan and reparse every font on every start" to
"a persistent, recoverable, incrementally refreshed local library core".

```text
Library Roots
      |
Filesystem state
      |
SQLite cache  <--- incremental decision ---> hash / parse as needed
      |
Global Catalog reconstruction
```

## 12. `folio-core` / `folio-storage` boundary

`folio-core` stays a pure, stateless font domain library. `folio-storage`
depends on it and is the only crate that knows about SQLite:

```text
folio-core
    ^
folio-storage
```

`rusqlite`, the SQL schema and migrations never leak into the core. Phase 2A
added only persistence-boundary constructors that the core owns
(`from_bytes` on the domain IDs, `ContentFingerprint::from_digest`,
`FontWidth::class`, public `rebuild_catalog`); none change a Phase 1 ID,
fingerprint, revision, grouping or classification algorithm.

## 13. Durable user data vs rebuildable catalog cache

* **Durable user data** — `library_roots`. Deliberate user state; never removed
  by a cache clear or rebuild.
* **Rebuildable catalog cache** — `source_files`. Derivable from the real font
  files; safe to invalidate, clear or rebuild.

Collections, favorites and recents (later phases) will be additional durable
tables; the schema boundary guarantees a cache clear/rebuild cannot reach them.

## 14. `LibraryRoot`

A `LibraryRoot` is a directory the user added to Folio:

```rust
pub struct LibraryRoot {
    pub id: LibraryRootId,
    pub path: PathBuf,
    pub display_path: String,
    pub recursive: bool,
    pub created_at: SystemTime,
    pub path_is_lossless: bool,
}
```

A root is **not** a `FontSource`: a root is a container
(`~/Design/Fonts`), a source is a concrete `file + face_index`. Root membership
never participates in identity or family grouping.

`LibraryRootId` is the first 128 bits of the BLAKE3 XOF over
`"folio-library-root\0" || len(platform):u64le || platform ||
len(path_bytes):u64le || path_bytes`. It is deterministic, so adding the same path twice returns
`AddRootOutcome::Existing` with the same ID and creates no duplicate row.
Changing a root's path is remove + add and yields a new ID. No SQLite row id is
ever exposed as a domain identity.

`add_root` converts relative inputs to an absolute path at insertion, removes
redundant separators, `.` and trailing separators through path components, and
preserves `..` (collapsing it could change symlink meaning). Roots are not
canonicalized: an explicitly selected symlink root keeps its own durable ID;
its discovered files are canonicalized. Missing/offline absolute roots can be
added. `/Fonts` and `/Fonts/` yield one root, while different symlink spellings
can remain separate roots. No case-folding, volume ID or inode-based identity is
claimed. Older relative stored roots are rejected without deletion because
the original working directory cannot be recovered. Use the returned root ID;
`LibraryRootId::for_path` hashes exactly the supplied encoding without normalization.

Insertion uses `ON CONFLICT(path_platform, path_bytes) DO NOTHING`; other
constraint errors propagate. A duplicate add keeps the original recursive
setting; `set_root_recursive` changes it. A complete subsequent non-recursive
refresh removes nested memberships, while memberships of other roots survive.

## 15. SQLite is device-local state

`rusqlite` with bundled SQLite; synchronous, matching the synchronous core. No
Tokio, SQLx, Diesel or ORM. The database is **not** a sync format, so its schema
optimizes local incremental work. Domain IDs stay deterministic across devices.
`FolioDatabase::open` accepts any database `Path`; platform code chooses the location.
Every connection explicitly enables `foreign_keys = ON` and a 2-second busy
timeout. `remove_root` depends on `ON DELETE CASCADE`; reopen/cascade tests
inspect SQL rows directly. No WAL mode is requested: newly created databases
use SQLite's default DELETE journal. Existing journal modes are not forcibly
changed. The rusqlite connection is `Send`, not `Sync`; it can move to another
thread but operations must be serialized by the caller. No actor, async runtime
or global cross-connection refresh lock is supplied. A busy timeout handles
brief write contention, not concurrent filesystem snapshot consistency.

## 16. Migration and version strategy

`PRAGMA user_version` tracks the schema; `CURRENT_SCHEMA_VERSION` is `1`. Opening
migrates `0 -> 1`, leaves the current version untouched, and returns
`StorageError::DatabaseTooNew` for a newer database (never downgrade, overwrite
or drop). Each step runs inside one transaction that also bumps the version, so
a failed migration leaves the previous schema and version intact. The schema is
not "`CREATE TABLE IF NOT EXISTS` as a migration system": step 1 uses plain
`CREATE TABLE`, which is what makes a conflicting pre-existing object fail
safely. Negative versions are rejected before entering the migration loop.
A future-version test compares database bytes before and after refusal; a
late migration conflict proves that preceding table/index creation rolls back.
No schema change was required during the Phase 2A audit. A version-1 database
with externally modified schema can return typed SQL errors; it is not silently
recreated or automatically downgraded.

## 17. Domain ID and path persistence

Phase 1 IDs are stored as raw 128-bit `BLOB`s and the fingerprint as raw 32
bytes; no `AUTOINCREMENT` business identity, no hex text for storage.
`source_files.id` is an internal row id used only for `UPDATE`/`DELETE`. Stored
byte lengths are validated; a wrong length is a typed
`StorageError::InvalidStoredId`.

Paths are stored as a platform tag (`unix` / `windows`) plus lossless
platform-native bytes (raw `OsStr` bytes on Unix, little-endian UTF-16 code
units on Windows), with a separate lossy `display_path`. Host-platform decoding
is exact. Foreign-platform, empty and NUL-containing paths return typed errors;
Windows byte counts must be even. UTF-16 code units, including unpaired
surrogates, are preserved on Windows. `display_path` is never used to locate a
file. Successfully loaded roots have `path_is_lossless == true`; the field is
retained for API compatibility. The database is device-local, so cross-platform
copy is unsupported and durable foreign rows are never silently deleted.

## 18. Cache payload strategy and version

Parsed metadata is stored per file as `CachedFilePayload`, a versioned,
Folio-owned DTO encoded with `bincode`. It contains only Folio domain data —
never `skrifa`/`read-fonts` objects — keeps IDs/fingerprints as raw bytes, and
includes `LocalizedName.locale` so Phase 1 locale records round-trip exactly.
`CACHE_PAYLOAD_VERSION` is stored on every parsed row; a differing version is a
cache miss and triggers a reparse. The whole `Catalog` is never the cache blob,
and the Serde layout is explicitly not a permanent persistence contract.
CLI/debug JSON, cache DTO encoding, future WebDAV schema and future FFI ABI
are separate contracts.

Encoding/decoding uses bincode 1.3.3 fixed-integer layout (compatible with
existing version-1 blobs). Decode rejects trailing bytes and limits consumption
to the actual blob byte count. SQL checks `length(payload)` and projects NULL
instead of copying a blob larger than 64 MiB into Rust. Encoding has the same
64 MiB ceiling. This is per-file metadata only, excluding glyph/outline binary
data, and accommodates the real TTCs exercised here; it is not a guarantee
for arbitrarily huge valid metadata. Exceeding it returns a diagnostic/error,
never truncated metadata. The DTO has no zero-sized unbounded sequences;
malicious vector/string length prefixes fail bounded decode. This is corruption
hardening, not authentication of every possible semantically plausible edit to
a local database. Fingerprints inside each face must match the row hash.

## 19. Per-file cache row

`source_files` holds `root_id`, lossless path, `file_size`, nanosecond
`mtime_ns`, `content_hash`, `status` (`parsed` / `known_unsupported` /
`malformed`), `format`, `payload_version`, `payload` and `error_message`.
`mtime_ns` is nullable; a missing `mtime` simply disables the metadata fast
path. Known-unsupported (WOFF/WOFF2) and malformed results are cached, so an
unchanged non-parsable file is neither re-read nor re-sniffed.
`mtime_ns` derives from `Metadata::modified()` using checked `i64` nanoseconds
since Unix epoch, retaining the precision supplied by the filesystem. Pre-epoch,
out-of-range and failed conversions become `None`, forcing a conservative
cache miss; timestamps are not truncated to seconds or cast to unsigned values.

## 20. Incremental decision tree

1. **Metadata fast path** (incremental only): trusted row, equal size and
   `mtime` -> reuse; no read, hash or parse (`metadata_cache_hits`).
2. **Content fast path**: metadata changed -> read + BLAKE3; equal hash (a
   `touch`) -> update size/`mtime` only and reuse (`files_hashed`,
   `content_cache_hits`).
3. **Reparse**: new or changed -> sniff/parse/replace (`files_reparsed`,
   `files_added` / `files_changed`).
4. **Removal**: unseen rows are deleted only after a complete successful
   traversal.

The explicit correctness model is **A: metadata reuse is a performance
assumption**, not cryptographic proof of unchanged bytes. Trusted means the row
and payload validate, not that the current filesystem bytes were verified.
A tool preserving size and mtime, timestamp collisions, or restoring timestamps
can hide a revision from Incremental. A regression deliberately replaces a valid
font while preserving both fields and proves Rebuild detects it. Use Rebuild
for explicit content verification, after timestamp-preserving imports/restores,
or when cache accuracy is in doubt. It reads/hashes/reparses every available
candidate; it cannot verify offline or unreadable files. Do not hash the whole
library in every Incremental refresh.

Reads use stat/read/stat, at most three attempts. A stable read requires regular
files, available equal modification times, equal sizes, and byte length equal
to the final size. Missing timestamp observations are not considered equal
proofs of stability. Persistent change yields `UnstableFile`; read errors yield
`FileRead`. Old payload/hash remain an explicitly stale snapshot, `mtime_ns`
is cleared to disable a later metadata hit, and the old face is excluded from
that refresh result. `load_cached_catalog()` remains an offline snapshot API
and can return this older face with unknown mtime. Root-level stale fallback
is described below. Neither stat/read/stat nor a whole refresh is an atomic
filesystem snapshot: same-metadata replacement/ABA races remain possible.
There is no watcher or stronger concurrent-writer protocol in Phase 2A.

## 21. Global catalog reconstruction

The cache is file-level state; the catalog is always rebuilt globally via the
core's `rebuild_catalog` (duplicate/source merge, then one global family
grouping). Families are never built per root and concatenated. Candidate paths
are canonicalized during enumeration to match the audited core scanner, so a
stable fixture catalog equals a live scan, including domain IDs and sources.
A canonicalization failure reports `TraversalIncomplete`, suppresses missing-row
deletion for the whole root, and skips that unresolved candidate. It never
silently substitutes a new path key. Descendant symlinks are skipped; explicit
root symlinks are allowed, consistent with Phase 1. Hard links remain distinct
path sources. Loading uses bulk reads and
in-memory relation building, not per-face N+1 queries.

## 22. Overlapping roots

Roots may overlap (`~/Fonts` and `~/Fonts/Project`). Each root keeps its own
scan membership. Equal revisions merge by FaceId and identical source records
are deduplicated; identical bytes at distinct paths retain multiple sources.
A TTC member discriminator remains part of revision identity. Grouping is global
across standalone files, directories, roots and TTC + standalone combinations. Removing an inner root cannot remove a font an outer root
still covers.

## 23. Root availability and incomplete traversal

A missing/unreadable root is not "every font was deleted": the root row and its
cache rows are kept, retained cached faces still contribute to the returned
catalog, and refresh reports `RootUnavailable` without destructive deletion.
Likewise, an incomplete traversal (an unreadable subdirectory) reports
`TraversalIncomplete`, keeps unseen rows and their faces, and removes nothing.
Missing-row deletion happens only after a complete enumeration. The conservative
policy is root-wide, not subtree-aware. Retained faces are stale fallback,
identified by the root/path issue rather than a per-face freshness flag.
Recovery re-enumerates normally. Corrupt cache invalidation is a separate
operation and can remove an unusable row even while its root is offline;
valid cached rows and durable roots are preserved.

## 24. Cache corruption and rebuild

`load_cached_catalog` is strict: a bad payload yields a typed
`StorageError::CorruptCache` rather than a silently incomplete catalog. During
refresh, malformed cache columns are isolated per row; bad versions/payloads,
missing or inconsistent hashes and invalid statuses/formats/paths are reported
(`CacheCorrupt`) and rebuilt when the candidate can be read. Invalid cache rows
are deleted in the same transaction as replacements. Invalid retained payloads
are dropped with a diagnostic so a later available refresh can rebuild them.
Strict load may also return `InvalidStoredId`, `PathCodec` or typed SQLite
conversion errors. Durable root corruption fails explicitly without deletion.
If an external writer bypasses foreign keys and corrupts a cache `root_id`, the
orphan may no longer belong to any root selected for refresh: strict load still
rejects it, and explicit cache clear followed by refresh repairs it. General
SQLite file/page corruption is a typed database error, not auto-repaired.
`clear_catalog_cache()` deletes `source_files` only; roots remain and a rebuild
restores the catalog.

## 25. Transaction strategy

Filesystem scanning, hashing and parsing run outside any write transaction.
Staged upserts/deletes for one root are applied in a single `commit_changes`
transaction; a failure leaves the previous root snapshot unchanged. Deletion
of invalid/stale rows and all replacements occur inside that transaction;
there is no destructive cache delete before it. A regression fails a later
insert after an earlier delete/upsert and checks the old row was restored.
Atomicity is per root, not across all roots: if a later root fails, earlier
committed roots can remain updated. SQLite supplies process-crash atomicity;
no process-kill/disk-fault experiment or extra crash journal is claimed.
A new database is migrated transactionally (§16).

## 26. Diagnostics model

Fatal storage failures and non-fatal refresh issues are distinct. Migration
failure, `DatabaseTooNew` and `CorruptCache` are `StorageError`; a single
unreadable or malformed font is a `RefreshIssue` and never prevents the database
from opening. Issues carry severity, kind, owning root, path, face index, format
and message, and are deterministically sorted. `RefreshStats` proves what
actually happened (metadata hits, hashes, reparses, additions, removals,
unsupported, malformed, unstable, corrupt rows).

Counters describe work/observations per root membership: overlapping roots may
count the same actual file twice, while Catalog merges sources. `candidate_files`
counts enumerated usable canonical candidates; metadata hits do no file read or
hash; `files_hashed` counts one successful stable read, not retry attempts;
`content_cache_hits` is a subset of hashed files. `files_reparsed` counts parser
invocations including unsupported and malformed files; `faces_parsed` counts
newly parsed faces before merging. `files_added` means no decodable prior row
(including structurally corrupt row repair); `files_changed` means a known prior
hash differs, not merely that Rebuild or payload repair parsed again.
`files_removed` counts unseen rows removed after complete traversal, excluding
corruption invalidation. Unsupported/malformed count observed candidates on
both fresh and cached paths; `failed_files` includes malformed, read failures
and unstable files, so `unstable_files` is a subset. Offline retained faces do
not contribute candidate status counts. Counts for unavailable and incomplete
roots are separate. No mutually exclusive sum of all counters is implied.

## 27. Public API

```rust
FolioDatabase::open(path) / path() / schema_version()
add_root(path, recursive) / list_roots() / get_root(id) / remove_root(id)
set_root_recursive(id, recursive)
clear_catalog_cache() / load_cached_catalog()
refresh(RefreshMode) / refresh_root(id, RefreshMode)
```

`RefreshMode = Incremental | Rebuild`. `RefreshResult` carries a reconstructed
`Catalog`, deterministic `Vec<RefreshIssue>` and `RefreshStats`. `refresh()`
combines all roots; `refresh_root(id, ...)` intentionally returns only that
selected root's catalog and updates no other root. It must not replace an
application's whole-library catalog. Use `refresh()` for a whole-library result,
or `load_cached_catalog()` to merge the database snapshots without I/O. This
scope distinction is documented and tested; the original API behavior is retained.
`StorageError` is typed and preserves source errors. The core exposes no SQL and
the app never assembles SQL, scanning and parsing itself.

## 28. Phase 2A / later-phase boundary

Phase 2A stops before collections, favorites, recents, search/FTS and ranking
(later phases), filesystem watchers/hot reload, platform font APIs, UI, FFI,
WebDAV/cloud sync and managed library. No search or collection tables exist.
Durable tables remain separate from `source_files`, so future durable data
cannot be removed by a cache clear or rebuild.

## 29. Verification

The final independent audit ran 149 workspace tests (89 existing Phase 1 and
60 storage tests, including doc tests), plus controlled and system-font smoke
runs. A warm refresh reports zero hashes and zero reparses. Windows GNU target
compilation passed using the installed toolchain; Windows runtime behavior is
not verified. macOS rejects the non-UTF-8 filesystem fixture with EILSEQ; pure
Unix-byte and UTF-16-code-unit codecs pass. See
[PHASE2A_AUDIT.md](../PHASE2A_AUDIT.md) and
[PHASE2A_REPORT.md](../PHASE2A_REPORT.md) for commands, findings and exact counts.

---

# Part III — Library State & Query（Phase 2B）

本节定义 Phase 2B 的当前行为；前两部分保留 Phase 1 / 2A 的历史设计与验证。
当前 schema 为 **2**，cache payload 为 **2**。

## 30. 模块边界

```text
folio-core ← folio-storage（SQLite、迁移、刷新、持久状态）
     ↑
folio-query（内存索引、搜索、筛选、健康分析）
```

`folio-core` 增加 `library` 共享 DTO 与 `metadata` 字体元数据。
`folio-query` 的运行依赖只有 core、Serde、thiserror，不依赖 SQLite 或存储
schema；测试和冒烟示例通过 dev-dependency 使用 storage。该边界使平台共享
同一套查询语义，又能纯内存测试。未引入 FTS、异步数据库、泛型 Repository
或新的平台接口。

新增 `unicode-script = 0.5.8` 使用其 Unicode 数据，避免手写 Script 表；
`getrandom = 0.4.3` 复用 lockfile 已有版本，提供随机 Collection ID 所需
128 位字节。没有引入 UUID 框架，也没有更换 Fontations 解析器。

## 31. 持久状态与 ID

新增四张持久表：

| 表 | 主键 | 数据与删除边界 |
| --- | --- | --- |
| `collections` | 随机 16 字节 CollectionId | 原始名称、规范化唯一名称、创建及更新时间 |
| `collection_members` | CollectionId + FontIdentityId | 只依赖 Collection，可随所属集合级联删除 |
| `favorites` | FontIdentityId | 存在即收藏 |
| `recent_fonts` | FontIdentityId | 最近主动访问的 UTC Unix 纳秒时间 |

Collection ID 使用操作系统随机源产生不透明 128 位值，既不由名称计算，也不
公开 SQLite rowid；重命名不改变 ID。碰撞或随机源失败返回错误，不覆盖已有
记录。集合保持扁平结构，没有嵌套或智能规则。

原样保存 display name。唯一键采用 **NFC → Unicode 小写 → NFC → Unicode
空白 trim / collapse**。保留标点、重音和兼容字符差异；不做 NFKC、拼音、
音译或语言相关大小写折叠。`Café` 与 `CAFE + combining acute` 相同，`Cafe`
与 `Café` 不同。名称为空、规范化冲突和未知 CollectionId 分别有 typed error。

所有长期字体引用使用 **FontIdentityId**。RevisionId 与 FaceId 随二进制修订
变化，路径属于来源，不能用于用户状态主键。四张新表没有指向 source_files
或 cached Face 的 FK，因此 cache clear、Rebuild、删除 root、字体移动及修订
更新不会删除收藏、最近访问或集合成员。真正改变 Identity 后旧引用继续保留，
不按名称猜测迁移。

集合成员与收藏的批量操作使用一次事务；重复加入或移除是幂等操作。
删除集合只级联删除其成员。集合创建时间不变；重命名及实际成员变化更新
updated_at。Recent 仅由 `record_recent` 更新，没有 access_count；查询、读取
目录、刷新与状态快照不产生访问记录。时间使用 checked i64 纳秒转换；时钟
无法表示时返回 InvalidTimestamp，不 panic、不截断为秒。更新取旧时间与
当前时间的较大值，时钟回拨不会倒退；相同时间按 ID 稳定排序。

## 32. 未解析引用与离线快照

`list_collection_members`、`list_favorites`、`list_recent` 总是保留合法 ID，
无论当前是否有字体。`resolve_identities(ids, catalog)` 提供 resolved 状态；
每种受限查询 Scope 返回 `unresolved_scope_items`。未解析引用不是 corruption。

**resolved 表示可在传入 Catalog 找到，并不表示文件当前可读。** 这保留了
Phase 2A 的约定：RootUnavailable 返回保留的陈旧缓存目录，旧 Face 仍可被
查询。若缓存已清空、文件在完整遍历后被确认删除，或调用方提供仅含可用字体
的目录，引用变为 unresolved；重新出现后按同一 Identity 自动 resolve。
没有通过改变 Phase 2A 的目录行为来伪造“离线即无字体”。

测试同时覆盖：离线保留陈旧缓存、离线清空缓存后 unresolved、重新上线恢复，
以及收藏/集合/Recent 在上述过程中不丢失。仅有旧 v1 载荷且 root 离线时，
无法解码的载荷原行保留，当前目录不包含它，用户状态仍可读取。

## 33. Schema 与 cache 版本

迁移保留原有 `0 → 1`，增加真实 `1 → 2` SQL 步骤；新表、索引及版本提升
处在同一事务。v2 重开不执行迁移，更高版本仍由 DatabaseTooNew 拒绝。
v1 的 root 与 source_files 不在迁移中改写或删除。

`tests/fixtures/schema_v1.sql` 与 `lato_payload_v1.bin` 由 Phase 2A 提交
`09e46e6` 实际生成后导出，不是把 v2 数据库改版本号来模拟。测试验证迁移
前后 root ID、旧 blob 原样保留、晚期建表失败完整回滚及后续重建路径。

FaceMetadata 新增 `FontEnrichment`，bincode 布局改变，因此
CACHE_PAYLOAD_VERSION 提升到 2。扩展值是 Folio 自有、可序列化的 DTO，
不含 Fontations 对象。版本检查先于解码；严格缓存读取返回 CacheIncompatible。
刷新将已知 v1 载荷报告为 CacheIncompatible，随后从可读源重建，不计入
CacheCorrupt。根不可用时保留原行；根可遍历时作废旧解析载荷，删除与替换
仍在原有短事务内提交。无法解码的旧数据不会走 metadata/hash reuse。
这次升级作废的载荷在重新发现时按缓存缺失计入 files_added。

载荷上限、损坏隔离、指纹校验、外部平台路径拒绝与 Phase 2A 事务边界保持。
新元数据参与 payload 往返，后续相同 size + mtime + 有效缓存仍然不读、不
hash、不 parse。`clear_catalog_cache` 继续只删除 source_files。

## 34. 字体元数据

保留 name ID 0、7、8、9、10、11、12、13、14 的全部 localized records，
包括语言及原始 locale；通过现有 `NameKind::Other(id)` 表达。显示首选值
沿用 en-US、en、未知语言、其他语言的确定性排序，原始记录不被替换。

`FontEnrichment` 包含 copyright、trademark、description、LicenseInfo、
FoundryInfo、EmbeddingPermissions、ScriptCoverage、OS/2 declared ranges、
PANOSE / family class、FontCategory、monospace / color 和 feature_tags。

LicenseInfo 保存 description、URL、detected_kind。识别完整 OFL / Apache 2
标题、标准许可 URL 或 MIT 标题/完整授权片段，多个被识别种类并存时保守归
Custom；无许可信息为 Unknown。它只表达字体元数据中的许可标识，不宣称
“免费商用”，不从 fsType 推断许可，也不提供法律判定。

EmbeddingPermissions 独立保存 OS/2 版本、raw flags、usage、no_subsetting、
bitmap_only。usage 区分 Installable、Restricted、PreviewAndPrint、Editable、
Invalid；v0–2 多权限位按旧版最宽许可处理，v3+ 多位视为无效；v0–1 忽略尚未
定义的高位语义，所有位仍保留原值。依据
[OpenType OS/2 fsType 规范](https://learn.microsoft.com/en-us/typography/opentype/spec/os2#fstype)。

FoundryInfo 分别保存 manufacturer、designer、vendor_id、vendor_url、designer_url。
不把 manufacturer、foundry 与 achVendID 当成同一身份，也没有 vendor 数据库。
Facet 使用 manufacturer 的规范化稳定键，返回独立 display label；相同键的
多种显示拼写选择字典序最小者，确保输入顺序变化不影响结果。

ScriptCoverage 来自 Fontations 选出的 cmap 字符映射，排除 glyph 0 与
非 Unicode scalar。使用 Unicode Script 属性聚合非 Common / Inherited /
Unknown 的脚本及 codepoint_count；名称使用 Unicode 技术全称，例如 Latin、
Han、Hiragana。不是完整语言支持测评，不把 name table 的语言当覆盖范围，
不把 Han 等同简体/繁体中文，也不把 Latin 当所有拉丁文字语言的保证。
不应用 Script_Extensions，不统计 variation-selector 映射，也未提取 OpenType
language-system tags。OS/2 Unicode Range 与 Code Page Range 原始位独立保留，
不会替代 cmap 观察。

Category 优先 fixed-pitch 信号（post.isFixedPitch 或 Latin text PANOSE 的
monospaced proportion），其次采用 PANOSE 类别与 serif-style，再回退 OS/2
family class。没有可靠信号返回 Unknown，不检查文件名或含 Sans 的家族名。
Core 不包含“黑体/宋体”等 UI 别名。

Feature 支持实际 axes 得到的 Variable、现有 FontStyle 的 Italic / Oblique、
Monospace、Color 与 GSUB/GPOS FeatureList 中的 OpenType tags。Tags 排序
去重，不执行 shaping。Color 表示可读取 COLR/SVG/CBDT/sbix 表的声明信号，
不保证特定渲染器能够呈现。原有 axes 与 named instances 保持。

## 35. 索引、搜索与排序

`FontQueryIndex::build(&Catalog, &LibraryStateSnapshot)` 构建自有内存文档，
检查重复 Family / Face ID 与 Face 的 family_id 一致性。查询不打开文件、
不访问 SQLite、不重新计算脚本和元数据。Catalog 刷新后重建索引；仅用户状态
变化时可 `update_state`，不重复规范化搜索字段。

索引字段包括 Family 显示名称、Face 的本地化 family/subfamily、Full Name、
PostScript Name、subfamily、basename、manufacturer、designer、vendor ID、
license kind / description 和字体 description。绝对文件路径不参与搜索。
使用与集合键相同的 NFC / Unicode lowercase / whitespace normalization，
只修改索引副本。

文本以 whitespace 分 token，每个 token 都必须命中同一 Face 的某个字段，
允许 token 分布于不同字段。支持 exact / prefix / substring，没有正则、
布尔表达式、fuzzy、拼音或罗马化。

每 token 取最高命中字段分数：family 900，PS/Full 650，本地化 PS/Full 600，
subfamily 500，本地化 family 450、本地化 subfamily 400，厂商/设计师/vendor
300，许可种类 250，basename 200，description/license text 100；exact 加 30，
prefix 加 20。Family 显示名称与完整查询 exact/prefix/substring 分别加
100000/80000/60000。家族分数取实际匹配 Face 的最大值。

默认有文本按 Relevance，无文本按 Name，Recent Scope 优先按匹配 Face 的
最近访问时间降序。可显式选择 Name / Relevance / Recent。所有主排序相同
时用规范化家族名称及 FamilyId 打破平局；Face / Identity 列表按 ID 排序去重。
`offset` / `limit` 在稳定家族排序后应用，total_matches 为分页前家族数。

## 36. Facets、Scope 与来源

独立 Facet groups：Category、Script、License、Foundry、Weight、Width、
Feature、LibraryRoot、State。**同组多值 OR，跨组 AND，全部 Face-level 条件
必须由同一个 Face 同时满足。** 不允许 Family 内一个 Bold Normal 与另一个
Regular Italic 拼凑成 Bold Italic。文本与 Scope 也在该 Face 上判断。

Weight 直接复用 FontWeight numeric value，Width 复用 FontWidth；summary
将 weight 以无损十进制字符串表示，将 width 以 1–9 class 表示。Script 值为
观察到的 Unicode Script 全称；Feature OpenType 值为字体声明的精确 tag。
License Facet 只使用 LicenseKind，不把整段许可当标签。

Scope 支持 All、Favorites、Recent、Collection(CollectionId)。未知集合返回
CollectionNotFound；存在但为空的集合返回空结果。Scope 的 unresolved IDs
在文本、Facet 与分页之前计算，不会因筛选“消失”。

Storage 在一次读事务内提供 LibraryStateSnapshot，包含收藏、Recent、所有
集合成员及每个 root 的 Face 归属，没有逐 Face SQL 查询。过期且不能解码的
载荷不贡献 root Face；一般损坏仍返回错误。

`LibraryRootKey` 是 core 拥有的查询边界键，与 storage 的 LibraryRootId
原始 16 字节一一对应，使用 `root.id.into()` 转换。这保留 Phase 2A ID 与
路径编码 API，同时让 Query 不依赖 SQLite 或平台路径编码。归属按 FaceId
而非 IdentityId，防止一个修订位于 Root A、另一个位于 Root B 时串配。
Overlapping roots 用集合合并，Root A OR Root B 不重复家族或来源。

State 只包含实际可得的 Favorite、Recent、DuplicateSources、MultipleRevisions、
MetadataConflict；没有虚构 Activated、Installed 或 Synced。

## 37. 健康分析与 Facet Summary

`analyze_catalog` 按 Identity 聚合，返回确定性 CatalogHealth / IdentityHealth。
DuplicateSources 表示一个具体 materialized revision 有多个实际 Source；
MultipleRevisions 表示同一 Identity 有多个 RevisionId，两者不等同。
不同修订间 family、subfamily、manufacturer 的非空规范化值不一致时报告
MetadataConflict，并返回冲突字段及值；缺失信息或单纯 version string/head
revision 改变不算冲突。检测不更改 Phase 1 身份算法，不删除或自动选择修订。

FamilyMatch 返回 family_id、显示名称、实际匹配 FaceId / IdentityId、score
和匹配身份的最新 Recent 时间。健康状态可直接用于 State Facet。

Facet summary 统计 **当前所有条件过滤后、分页前的匹配结果**，计数单位为
Family。同一家族同一值只计一次；只统计实际匹配 Face 贡献的值，不把家族内
不匹配 Face 的属性算入。使用有序映射/集合输出稳定顺序，没有 disjunctive
faceting，也不表达取消某一筛选后的预测数量。

## 38. 性能与交付边界

索引构建对所有字段规范化一次，并预先分析健康状态；空间与 Face 数及元数据
文本总长度相关。查询线性扫描候选 Face，文本匹配在预规范化字段上执行，
summary/结果用有序集合聚合，排序约 O(F log F)。没有每次输入重新 parse 或
重建 SQLite 连接，也没有复杂增量倒排索引。

20k 冒烟使用实际解析元数据复制为 20k 个独立 Face/Family，覆盖索引、空查询、
多 token 和跨 Facet 查询，时间不作为 CI assertion。长许可文本会显著增加
建索引和 substring 成本，全匹配且包含完整 Facet summary 的查询也更贵。
具体主机观测及验证范围见 [PHASE2B_REPORT.md](../PHASE2B_REPORT.md)。

Phase 2 到此封版：具备本地持久目录、增量刷新、用户状态、元数据、搜索、
筛选与健康分析。未实现 CoreText、平台安装/激活、watcher、Hot Reload、FFI、
WebDAV、managed library 或任何平台 UI，未修改前端依赖基线。
