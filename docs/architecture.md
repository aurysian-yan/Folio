# Folio architecture — Phase 1B

Status: Rust Font Catalog Core, finalized within Phase 1. Verification and
remaining limits are recorded in [PHASE1_AUDIT.md](../PHASE1_AUDIT.md).

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

The Rust lockfile contains no ttf-parser, Tokio, SQLite, HTTP client, Tauri or
UniFFI. The JavaScript workspace is separate from the Rust workspace and now
contains only a pnpm dependency baseline for the planned shared Windows/Linux
React desktop UI: HeroUI v3 and Tailwind CSS v4. UI source is intentionally
deferred. Tests use `font-test-data 0.9.1` and local licensed fixtures; see
their provenance and license details in
[fixtures/fonts/README.md](../fixtures/fonts/README.md).

Future priorities remain macOS (SwiftUI/AppKit + UniFFI), Android
(Kotlin/Compose/MIUIX + UniFFI), Windows/Linux (Tauri 2 + shared React,
HeroUI v3, Tailwind CSS v4 and direct Cargo), and iOS/iPadOS (SwiftUI +
UniFFI). These are context only; no platform shell, FFI, WebDAV, persistence,
hot reload or activation code was added to the Rust core. Phase 1B ends at the
catalog core.
