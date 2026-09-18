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
