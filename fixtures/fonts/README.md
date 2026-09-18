# Folio test fixtures

This directory contains the legally redistributable font files used by the
`folio-core` test suite. Nothing here may be replaced by system fonts,
commercial fonts or fonts of unknown origin.

## Files

| File | Format | Purpose | License |
| --- | --- | --- | --- |
| `Lato-Regular.ttf` | TTF (TrueType outlines) | TrueType parsing, Regular style, family grouping | SIL OFL 1.1 (`licenses/Lato-OFL.txt`) |
| `Lato-Bold.ttf` | TTF | Bold weight, family grouping | SIL OFL 1.1 (`licenses/Lato-OFL.txt`) |
| `Lato-Italic.ttf` | TTF | Italic style, family grouping | SIL OFL 1.1 (`licenses/Lato-OFL.txt`) |
| `SourceSerif4-Regular.otf` | OTF (CFF outlines) | OpenType/CFF parsing | SIL OFL 1.1 (`licenses/SourceSerif-OFL.txt`) |
| `Inter-Variable.ttf` | Variable TTF (`wght`, `opsz`) | Variable font detection and axis extraction | SIL OFL 1.1 (`licenses/Inter-OFL.txt`) |
| `Inter-Regular.woff` | WOFF 1.0 | Known-but-unsupported recognition | SIL OFL 1.1 (`licenses/Inter-OFL.txt`) |
| `Inter-Regular.woff2` | WOFF 2.0 | Known-but-unsupported recognition | SIL OFL 1.1 (`licenses/Inter-OFL.txt`) |
| `not-a-font.ttf` | — | Intentionally invalid content with a font extension | Written by the Folio project (public domain) |

## Sources

* Lato: <https://github.com/google/fonts/tree/main/ofl/lato> (Google Fonts
  repository, mirrored through jsDelivr)
* Inter variable: <https://github.com/google/fonts/tree/main/ofl/inter>
* Source Serif 4 OTF: <https://github.com/adobe-fonts/source-serif>, release
  branch (`OTF/SourceSerif4-Regular.otf`)
* Inter WOFF/WOFF2: <https://www.npmjs.com/package/@fontsource/inter>
  (Fontsource build of Inter; the underlying font is SIL OFL 1.1)

## SHA-256 checksums

```
29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031  Inter-Variable.ttf
8a0aace75d33794eece4b28187bfc1df0bbd2888b5d8a56e01788c8d65d16be1  Lato-Bold.ttf
e399c44efe1387100531d26c7e4800c5d12251b890d6654a3098c7c679cb1786  Lato-Italic.ttf
d636e4683231f931eda222d588e944d082bfd3bdba02f928bee461c0f185b251  Lato-Regular.ttf
afb26a2aaab6d2e76680b1322095ac726543f6014f2e2f3a0d756a84db8d230e  not-a-font.ttf
edf160d0d584deee8a3bb2c3371b2a7624ca63580fbe02c57c1f4c91e84d8787  SourceSerif4-Regular.otf
e20fa0b4fd2dd26e4d14b3ac3cc922509c3a63fa5e910e90c614544aa042dd45  Inter-Regular.woff
8909904ab6c872eb994093482a88a28eca2cd95912d7b6fecd72103b0dc07edc  Inter-Regular.woff2
```

## Why there is no committed `.ttc` / `.otc` fixture

Finding a small, clearly licensed collection file is hard. Instead, the
collection tests use the `font-test-data` crate (a dev-dependency of
`folio-core`), which ships `TTC.ttc` taken from the HarfBuzz in-house test
suite. That crate is published by the Fontations project under
`MIT OR Apache-2.0`, so no binary is committed here and the test data stays
legally clean. See `crates/folio-core/tests/parser.rs`.

## Deliberately absent

The following are never committed:

* macOS or Windows system fonts
* user or commercial fonts
* fonts with unknown provenance

Tests that need "system-like" names (for classification) synthesize them at
runtime by patching the same-length PostScript name inside a copy of
`Lato-Regular.ttf`; see `crates/folio-core/tests/common/mod.rs`.
