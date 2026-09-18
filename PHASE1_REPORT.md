# Folio — Phase 1 Final Report

Phase: **1B — Independent Audit, Hardening & Finalization**.
Date: 2026-09-18. Verdict: **READY FOR PHASE 2**.

This report supersedes the initial Phase 1 claims. The full independent findings,
original command results, regressions and remaining limits are in
[PHASE1_AUDIT.md](PHASE1_AUDIT.md). The original state is preserved in the local
Git baseline commit `3b5c14d`. No Phase 2 work was started.

## Verified commands

Environment: macOS aarch64, Rust 1.94.1, Cargo 1.94.1.

| Command | Observed result |
| --- | --- |
| `cargo build --workspace` | PASS, exit 0 |
| `cargo fmt --all --check` | PASS, exit 0, no formatting differences |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS, exit 0, no warnings |
| `cargo test --workspace` | PASS, 89 passed, 0 failed, 0 ignored |

The pre-change workspace independently passed 57 tests. New regressions initially
produced 9 failures against the original production code; those are fixed.
Final coverage: core unit 24, family 4, hardening 28, identity/revision 6, parser
11, scanner 11, doctest 1, CLI unit 1 and CLI executable 3.

## Final domain decisions

- `FontIdentityId` identifies the metadata-derived logical face and is the ID
  for long-term logical references. Equal PS names intentionally share identity;
  this is a documented/tested limitation, not a global uniqueness guarantee.
- `FontRevisionId` identifies exact file content for that identity and, for
  collections, its member index. Moving bytes preserves it; changing bytes or
  member discriminator changes it.
- `FontFaceId` identifies a materialized revision in a catalog and changes with
  revision. Equal revisions merge their sources; distinct revisions are retained.
- `FontFamilyId` derives from global metadata grouping, never source paths.
  Names use whitespace normalization, NFC and Unicode lowercase; unrelated
  fully unnamed faces are isolated by identity.
- Identity components are now independently length-prefixed before hashing.
  This fixes ambiguous embedded separators; pre-audit IDs must be recomputed.

The public API is the explicit crate-root exports. Parse entry points remain
public; implementation modules and helpers are private. All serialized types
belong to Folio. Serde output is a CLI/debug DTO, **not an FFI ABI, database
schema or WebDAV schema**. Full rules are in
[docs/architecture.md](docs/architecture.md).

## Acceptance evidence

| Area | Final status and evidence |
| --- | --- |
| TTF | SUPPORTED & VERIFIED: Lato fixtures and real system scan |
| OTF | SUPPORTED & VERIFIED: Source Serif 4 CFF fixture and system OTTO assets |
| Variable TTF | VERIFIED: Inter axes and Regular named-instance coordinates |
| TTC | SUPPORTED & VERIFIED: real Fontations/HarfBuzz fixture, Helvetica TTC, generated Lato collection |
| OTC | SUPPORTED & VERIFIED for runtime-generated complete CFF-only collections; externally distributed OTC NOT VERIFIED |
| Mixed collections | VERIFIED: full TT/CFF members in both orders, neutral `Collection` container |
| Damaged collection members | VERIFIED: bad first/last member offsets, bad table range, all-members-failed behavior |
| WOFF / WOFF2 | VERIFIED AS KNOWN-UNSUPPORTED: genuine assets, magic sniffing, diagnostics, stats, JSON and human CLI |
| Family aggregation | VERIFIED: several standalone files, different directories, collection members, collection + standalone |
| Locales | VERIFIED for English, Windows CJK, MacRoman English/French, format-1 tags, invalid/unknown locale preservation; exhaustive mapping NOT VERIFIED |
| Identity/revision | VERIFIED: copies/path independence, changed bytes, checksum-valid head revision edit, PS collisions, collection reordering/discriminators |
| Failure isolation | VERIFIED: mixed valid TTF/OTF/TTC, ordinary files, corrupt font, WOFF2, missing files, accidental directories, permissions |
| Determinism | VERIFIED: serialized mixed scans over eight input permutations, repeated CLI processes, repeated full real-directory JSON |
| Classification | VERIFIED: Internal retained in catalog/JSON; human hiding and `--show-internal`; `.LastResort` precedence |

`FontFormat::Collection` describes both TTC/OTC, with per-face sfnt format.
Neither a format label nor successful catalog parsing implies platform
activation, installability, outline validity or rendering support.

## Fresh smoke results

Commands actually run with the final debug binary:

```sh
target/debug/folio-cli scan /System/Library/Fonts --json
target/debug/folio-cli scan-files \
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf' \
  /System/Library/Fonts/LastResort.otf \
  /System/Library/Fonts/Helvetica.ttc --json
target/debug/folio-cli scan fixtures/fonts --json
```

| Metric | System directory | Explicit files | Fixtures |
| --- | ---: | ---: | ---: |
| Files seen | 371 | 3 | 13 |
| Candidate font files | 369 | 3 | 8 |
| Supported font files | 369 | 3 | 5 |
| Known unsupported files | 0 | 0 | 2 |
| Faces | 786 | 8 | 5 |
| Families | 377 | 3 | 3 |
| Failed files | 0 | 0 | 1 |
| Issues | 0 | 0 | 3 |

All exit 0. The fixture failure and warnings are intentional: one invalid file,
one WOFF and one WOFF2. System scan: 649 TrueType-flavored faces, 137 OTTO faces,
58 variable faces, 114 Internal faces retained. Explicit scan includes six
Helvetica TTC faces. Repeated full-system JSON is byte-identical. Human system
and fixture scans also ran successfully. A chmod-000 CLI smoke under UID 501
verified a nonfatal file-read issue with OS permission-denied context.

## Fixtures and dependencies

All seven committed font binaries match fetched upstream bytes; all eight
recorded fixture hashes match. No font binary changed. The actual Adobe Source
Serif notice and a separate Fontsource Inter-web notice are now included.
Fontations TTC data is a dev-dependency asset, not a copied repository binary;
its upstream hash and embedded FontTools notice were independently checked.
See [fixture provenance](fixtures/fonts/README.md).

`read-fonts 0.44.0`, `skrifa 0.47.0` and `font-test-data 0.9.1` remain unchanged.
NFC uses `unicode-normalization 0.1.25` with transitive `tinyvec`; no existing
versions were upgraded. Rust 1.85 is the corrected declared dependency floor,
but execution on 1.85 is NOT VERIFIED. The resolved dependency set contains no
ttf-parser, Tokio, SQLite, HTTP client, Tauri, notify or UniFFI.

## Limits and stop point

Remaining limits include metadata-name collisions, content-fallback identity,
collection-wide revision churn, incomplete locale coverage, no inferred
translated-family aliases, no full font validator, no CFF2-specific or external
OTC verification, no cross-platform/MSRV run and no 20,000-face benchmark.
All are described precisely in the audit and architecture documents.

Phase 1's required foundation is ready. No SQLite, search index, CoreText,
SwiftUI, Android, Windows font APIs, hot reload, WebDAV, FFI or other later-phase
feature has been implemented. Work stops at Phase 1B.
