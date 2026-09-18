# Folio — Architecture (Phase 1)

Status: **Phase 1 — Rust Font Core Foundation**.

This document records the decisions that shape `folio-core`. It is
normative: when code and document disagree, one of them is a bug.

Scope of Phase 1 is deliberately narrow:

```text
Font Assets
    -> Candidate Detection
    -> Parser
    -> FontFace
    -> FontIdentity
    -> FontRevision
    -> Family Grouping
    -> Classification
    -> Catalog
    -> CLI
```

No UI, no platform font registration, no watchers, no database, no
network, no FFI. See `README.md` for the user-facing summary.

---

## 1. Font asset, face, identity, revision, family

The model has five distinct concepts. Confusing any two of them produces the
bugs Phase 1 exists to prevent.

| Concept | Question it answers | Lifetime |
| --- | --- | --- |
| **Font asset** | "Which file or stream did we find?" | Filesystem object |
| **Font face** | "What is declared inside this binary?" | Function of bytes |
| **Font identity** | "Which logical face is this?" | Survives re-exports |
| **Font revision** | "Which exact binary is this?" | One per binary |
| **Font family** | "Which faces belong together visually?" | Grouping of faces |

Concretely:

* `FontSource` is the asset location. One file can contain many faces
  (`.ttc` / `.otc`), so asset != face.
* `ParsedFace` is a face as parsed from exactly one source.
* `FontFace` is a catalog entry: one materialized revision, with all known
  sources merged. Identical bytes found in several places are one face with
  several sources.
* `FontFamily` groups faces by metadata (see §10).
* `Catalog` owns the families and therefore the faces. Classification never
  deletes anything.

A face is keyed by identity + content, not by path: copying a file produces
the same face; re-exporting the font produces a second face that shares the
identity. Phase 1 keeps both so that duplicate detection and revision
detection can be built on it later.

## 2. `FontSource`

```rust
pub enum FontSource {
    LocalFile {
        path: PathBuf,
        face_index: u32,
        file_size: u64,
        modified: Option<SystemTime>,
    },
}
```

`face_index` is `0` for single fonts and the member index for collections.
`file_size` and `modified` are scan-time auxiliary metadata for display and
for future fast paths. They are never used for identity.

`FontSource` is an enum so that later phases can add WebDAV or managed
library locations without touching identity code.

## 3. Why the path belongs to `FontSource`

The path is a property of *where we happened to find bytes*, not of the
font. It is the only piece of the model that can change without the font
changing at all. Keeping it in `FontSource` makes that explicit and keeps
move/rename-safe identifiers trivial to define.

## 4. Why the path is not part of `FontIdentity`

Identity answers "which logical face is this". Two copies of
`MyFont-Regular.otf` in different directories are the same logical face, and
a user who reorganizes their font folder must not see their library
duplicate itself. Identity is therefore derived exclusively from internal
metadata (§6), never from paths, file names or modification times.

## 5. Why the path is not part of `ContentFingerprint`

`ContentFingerprint` answers "which bytes is this". Moving or copying bytes
does not change them. Including the path would make the fingerprint useless
for duplicate detection and for revision comparison across machines. The
fingerprint is the BLAKE3 hash of the complete file content only.

## 6. `FontIdentity` strategy

Deterministic priority order, first usable value wins:

1. **PostScript name** (name ID 6). Strongest single signal, and stable
   across normal re-exports.
2. **Typographic family + subfamily** (name IDs 16/17).
3. **Legacy family + subfamily** (name IDs 1/2). Handles older fonts whose
   legacy family already contains the style, e.g. `MyFont Bold Regular`.
4. **Full name** (name ID 4).
5. **Content fallback**: `BLAKE3(content) + face index`, marked with
   `IdentityKind::ContentFallback`, with a `MetadataProblem` warning.

Rules:

* Names are trimmed and internal whitespace runs are collapsed to one space
  before use, so `"  My Font  Regular "` and `"My Font Regular"` are the
  same identity.
* PostScript names are *not* assumed to exist, to be valid, or to be
  unique. They are simply the first candidate; the fallbacks are defined.
* Identity never depends on the path, the file name, `mtime`, or - except
  for the explicit content fallback - the file hash.
* Pathological fonts where two faces of a collection share all names will
  share an identity but have distinct revisions (the collection index is
  part of the revision).

## 7. `FontRevision` strategy

```text
FontRevisionId = BLAKE3("folio-revision\0" || identity_id || content_fingerprint || discriminator)
```

where `discriminator` is `None` for single fonts and the collection member
index for collections. Consequences:

* Moving or copying a file: revision unchanged.
* Re-exporting the font: revision changed (bytes changed).
* Two members of a collection always differ, even though they share the
  file-level fingerprint and possibly the same identity.
* A revision is the identity of a binary state; `FontFaceId` is a
  domain-separated hash of the revision (see §8). Re-exporting therefore adds
  a second face to the catalog sharing the identity, which is exactly what
  revision and duplicate detection need later.

Phase 1 stores no revision history; it only represents revisions it sees
during a scan.

## 8. Stable ID strategy

All identifiers are 128-bit BLAKE3 digests (the first 16 bytes of the XOF
output) over domain-separated, length-prefixed inputs:

```text
FontFamilyId   = BLAKE3("folio-family\0"   || family_key)
FontIdentityId = BLAKE3("folio-identity\0" || identity_key)
FontRevisionId = BLAKE3("folio-revision\0" || identity_id || fingerprint || discriminator)
FontFaceId     = BLAKE3("folio-face\0"     || revision_id)
```

Every variable-length part is prefixed with its length as little-endian
`u64`, so `("ab", "c")` and `("a", "bc")` can never collide. Domains are
NUL-terminated constants, matching the documented scheme.

* No `Vec` indexes, no database autoincrement, no `DefaultHasher`.
* IDs are printed as 32 lowercase hex characters.
* IDs are deterministic: parsing the same font again yields the same IDs,
  on any machine, in any filesystem order.
* IDs are typed: a `FontFamilyId` cannot be passed where an
  `FontIdentityId` is expected.

## 9. Name table fallback strategy

Folio tracks name IDs 1, 2, 4, 5, 6, 16, 17, 21, 22. For each it keeps
*all* decodable localized strings as `LocalizedName { kind, language,
value }`, so Chinese, Japanese and English names (and others) are never
thrown away. Decoding uses `skrifa`'s localized string iterator, which
handles UTF-16BE, MacRoman, Mac and Windows language IDs, and `name` table
version 1 language tags.

Display values are chosen deterministically:
`en-US` > `en` > language-less > first record in name table order.

Field resolution:

* `family_name` = typographic family (16), else legacy family (1)
* `subfamily_name` = typographic subfamily (17), else legacy subfamily (2)

The legacy values are still stored separately so nothing is lost. If a
font has typographic family but only legacy subfamily, the identity falls
back to the legacy pair (deterministic, documented in code); family
grouping still uses the typographic family.

## 10. Family grouping strategy

1. Group by `family_name` when present.
2. Otherwise group by PostScript name (each such font becomes its own
   family).
3. Otherwise group by full name.
4. Otherwise one `"unnamed"` family per face set.

Grouping uses a hash map keyed by the canonical family string, so it is
linear in the number of faces - no O(N²) pairwise comparison. There is no
filename prefix grouping. Faux-bold or style-suffixed variants that share a
typographic family are grouped together because the metadata says so, not
because their names look similar.

Ordering is deterministic:

* families by case-insensitive display name, then ID;
* faces by style rank (Normal, Oblique, Italic), then weight, then
  subfamily name, then face ID;
* localized names by kind, language, value.

The CLI applies the same order, so scans are reproducible.

## 11. Font format model

```rust
pub enum FontFormat {
    TrueType,            // sfnt, TrueType outlines
    OpenType,            // sfnt, CFF/CFF2 outlines ("OTTO")
    TrueTypeCollection,  // "ttcf", first member uses TrueType outlines
    OpenTypeCollection,  // "ttcf", first member uses CFF/CFF2 outlines
    Woff,                // WOFF 1.0, recognized, planned for v2
    Woff2,               // WOFF 2.0, recognized, planned for v2
}
```

Format is detected from **content** (`sniff_format`), never from the file
extension. A JPEG renamed to `cat.ttf` is rejected as malformed; a WOFF
renamed to `font.ttf` is still recognized as WOFF. Extensions only decide
which files a directory scan considers candidates.

A mixed collection is labeled by its first successfully loaded member;
individual faces keep their own `format`. Mixed collections are extremely
rare and are documented as a limitation rather than guessed at.

## 12. Managed != installable

`FontFormat` describes a container. It says nothing about whether an
operating system can activate or install the font. The domain model
therefore never encodes `format == installable`:

* WOFF/WOFF2 are known formats that Folio will manage, search and display
  (v2) even though macOS and Windows generally cannot install them as
  system fonts.
* Future capability flags (`manageable`, `previewable`, `activatable`,
  `installable`, `convertible`) belong to a separate platform capability
  layer that Phase 1 intentionally does not build.
* The only capability question Phase 1 answers is "can the current parser
  read it", exposed as `FontFormat::is_supported()`.

## 13. WOFF / WOFF2

Planned for **Folio v2**. Phase 1:

* recognizes `wOFF` / `wOF2` magic bytes;
* returns `FontError::UnsupportedFormat { format, planned: "Folio v2" }`;
* the scanner turns that into a `KnownUnsupportedFormat` warning with the
  recognized format attached, counted in
  `ScanStats::unsupported_known_font_files`;
* never reports them as `MalformedFont` and never counts them as failed.

No WOFF parsing, decompression, preview or conversion exists in Phase 1.

## 14. Classification strategy

`FontClassification` is `Normal | SystemLike | Internal`, computed from the
PostScript name and family name only:

* a name starting with `.` -> `Internal` (for example
  `.AppleSystemUIFont`);
* a name containing `lastresort` (case-insensitive) -> `SystemLike`;
* everything else -> `Normal`.

The rules are intentionally minimal. The spec forbids stuffing unverified
hardcoded system font lists into the core. Classification is metadata:
classified faces stay in the catalog and in the stats. The CLI hides
`Internal` faces by default and `--show-internal` reveals them; JSON output
always contains everything.

## 15. Scan failure isolation

* Only unreadable or non-directory scan roots produce a top-level
  `ScanError`.
* A file that cannot be read, is empty, has unknown content, or fails to
  parse produces a structured `ScanIssue` and does not stop the scan.
* A broken face inside a collection produces a `CollectionProblem` issue
  with its `face_index`; the remaining members are still parsed.
* A file with no usable name records still produces a face, a content
  fallback identity and a `MetadataProblem` warning.
* Stats track `files_seen`, `candidate_font_files`, `supported_font_files`,
  `unsupported_known_font_files`, `faces_parsed`, `families_created` and
  `failed_files` independently.

Parse code never calls `unwrap()`/`expect()` in library paths; malformed
input cannot panic.

## 16. Directory scans and explicit file scans

Both entry points are thin wrappers around one pipeline:

```rust
pub enum ScanInput<'a> {
    Directory(&'a Path),
    Files(&'a [PathBuf]),
}
pub fn scan(input: ScanInput<'_>, options: &ScanOptions) -> Result<ScanResult, ScanError>;
```

The only difference is candidate collection:

* **Directory**: `walkdir` (no symlink following), recursive by default,
  candidates filtered by known extensions; files are sorted before
  processing.
* **Explicit files**: every provided path is a candidate regardless of
  extension, because the caller (eventually Finder/Explorer "Open With
  Folio") already made the selection. Paths are deduplicated and sorted.

From that point on, parsing, fingerprinting, identity, revision, grouping,
diagnostics and stats are identical code. A test asserts that scanning two
files directly produces byte-for-byte the same `Catalog` as scanning a
directory containing only those files.

## 17. Why Fontations / Skrifa

* `read-fonts` is the Fontations low-level parser: safe, well-fuzzed,
  zero-copy, and it handles sfnt table directories and `.ttc` collections.
* `skrifa` provides the higher-level pieces this phase needs: localized
  `name` strings with language tags, `fvar` axes and named instances, and
  style/weight/width attributes.

Useful facts verified against the actual dependency sources (read-fonts
0.44, skrifa 0.47):

* `read_fonts::FileRef::new` distinguishes single fonts from `ttcf`
  collections, and `CollectionRef::get(index)` isolates member parsing.
* `skrifa::MetadataProvider::localized_strings` decodes UTF-16BE, MacRoman
  and name-table v1 language tags and exposes BCP-47 language identifiers.
* `skrifa::MetadataProvider::axes()` / `named_instances()` wrap `fvar`.

These types are converted to Folio domain types at the boundary
(`FontWeight`, `FontWidth`, `FontStyle`, `VariableAxis`, `LocalizedName`,
`FontFormat`, ...). No `skrifa` or `read-fonts` type appears in Folio's
public API.

No additional font crates were needed. `ttf-parser` is not used.

## 18. Known limitations (Phase 1)

* The content fallback identity for nameless fonts depends on the binary
  hash, so re-exporting such a font changes its identity. Explicitly marked
  by `IdentityKind::ContentFallback` and a `MetadataProblem` warning.
* Identity trusts PostScript names; fonts with colliding PostScript names
  share an identity. Revisions still differ.
* Family grouping for fonts without family metadata does not try to parse
  style suffixes out of PostScript names; such fonts get one family each.
* Mixed collections are labeled by their first member.
* `usWidthClass` 0 is reported as unknown instead of guessing a width.
* Style detection covers `OS/2` selection flags, `post.italicAngle` and
  `head.macStyle`; italic/oblique variation axes are not interpreted.
* WOFF/WOFF2 parsing is out of scope; see §13.
* TTC/OTC face-level failure isolation is implemented, but the committed
  tests only cover the success path plus the synthetic multi-face fixture
  from `font-test-data`; producing a corrupt collection fixture legally is
  left as a future improvement.
* Localized names are stored for the tracked name IDs only (the face-level
  names listed in §9, plus axis and named-instance names).
* Directory scans only consider files whose extension is a known font
  extension; a valid font with an unknown extension is found only through
  an explicit file scan. Explicit scans ignore extensions entirely.
* Symbolic links are not followed during directory scans, so symlinked
  font files are skipped. Explicit file scans follow symlinks because the
  caller named the file.
* Full-file BLAKE3 is computed for every candidate on every scan. No cache,
  no `mtime`/size shortcut, no conditional hashing.
* Parsing is single-threaded and reads each file fully into memory.

### Future optimizations (explicitly not implemented)

These are recorded so they are not mistaken for missing work:

* metadata cache keyed by fingerprint
* `mtime` + size fast path to avoid re-reading unchanged files
* conditional hashing (hash lazily, only when needed)
* parallel parsing and hashing
* search index for large catalogs
* streaming reads for very large collections

## 19. Platform priority (later phases)

| Priority | Platform | Stack | Notes |
| --- | --- | --- | --- |
| P0 | macOS | SwiftUI, AppKit where needed, Rust core via UniFFI | Full desktop management, activate/deactivate, install, hot reload |
| P1 | Android | Kotlin, Jetpack Compose, MIUIX, Rust core via UniFFI | Portable library, WebDAV, offline cache, DocumentsProvider, ACTION_GET_CONTENT, SAF, USB export |
| P2 | Windows | Tauri 2, React, Tailwind, Rust core as a Cargo dependency | Full desktop management, activation, hot reload |
| P3 | iOS / iPadOS | SwiftUI, UniFFI | Browsing, WebDAV, offline, Files/Share/File Provider |
| P4 | Linux | Tauri, reusing the Windows web UI | Low priority, v2 |

None of these app shells, FFI layers, storage or sync code exists in
Phase 1.
