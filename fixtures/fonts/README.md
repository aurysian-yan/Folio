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
| `Inter-Regular.woff` | WOFF 1.0 | Known-but-unsupported recognition | SIL OFL 1.1 (`licenses/Inter-Web-OFL.txt`) |
| `Inter-Regular.woff2` | WOFF 2.0 | Known-but-unsupported recognition | SIL OFL 1.1 (`licenses/Inter-Web-OFL.txt`) |
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

## Independent provenance audit (2026-09-18)

All seven committed font binaries were fetched from their stated sources and
compared byte-for-byte and by SHA-256. All matched; no binary was replaced.
Lato and Inter-variable OFL files also matched their corresponding Google
Fonts source files exactly.

The Source Serif binary matches Adobe's `release/OTF/SourceSerif4-Regular.otf`.
The previous license file came from a different distribution and omitted that
release's Adobe copyright and reserved name notice. `SourceSerif-OFL.txt` now
contains the exact [Adobe release license](https://raw.githubusercontent.com/adobe-fonts/source-serif/release/LICENSE.md),
including the reserved name “Source”; SHA-256:
`c21d7293d87b6d7ab1d0229a2f55b77f33a7613a6a4e66f6693d68d7d8d09464`.

Both Inter web fixtures exactly match the `inter-latin-400-normal` files in
[`@fontsource/inter@5.2.8`](https://www.npmjs.com/package/@fontsource/inter/v/5.2.8).
They use the package's own [OFL notice](https://cdn.jsdelivr.net/npm/@fontsource/inter@5.2.8/LICENSE),
now preserved separately in `Inter-Web-OFL.txt`, including its 2016 copyright;
SHA-256: `3b0a5fca3d17942cde889069889dedbbbd075e9b599968c82a95f4d944e9b345`.
The 2020 Inter-variable notice is retained for the variable TTF.

The binaries are unmodified upstream releases redistributed with their
corresponding copyright/OFL notices. The OFL permits bundling with software
under its conditions; the font assets retain OFL rather than the workspace's
Rust package license. Lato also has a reserved font name. See the full notices
and [official OFL text](https://openfontlicense.org/open-font-license-official-text/).

## Collection fixtures

`font-test-data 0.9.1` is a Cargo dev-dependency, not a copied collection in this
repository. Its packaged `test_data/ttc/README.md` attributes `TTC.ttc` to
HarfBuzz's `test/shape/data/in-house/fonts/TTC.ttc`; these bytes were independently
compared with [the upstream file](https://github.com/harfbuzz/harfbuzz/blob/main/test/shape/data/in-house/fonts/TTC.ttc).
SHA-256: `a8521588045ed5f1f8b07eecaac06ed3186c644655bfac00dd4507cd316fbdc5`.

The crate includes MIT and Apache-2.0 notices. Its package license alone is not
a license audit of every bundled font: both TTC members additionally declare
FontTools (2015) with “No rights reserved” in name ID 0 and a FontTools license
URL in ID 14. The [FontTools license](https://github.com/fonttools/fonttools/blob/main/LICENSE)
is MIT. This fixture is obtained through Cargo and written only into temporary
test directories; no TTC binary is committed here.

Additional tests assemble complete TTC, CFF-only OTC and mixed collections from
the committed Lato and Source Serif binaries at runtime. The helper writes the
collection header, aligns members, relocates table offsets and clears collection
head checksum adjustments. It does not generate outlines or merely change a
magic number. Damaged-member tests then corrupt a member offset or table range
while leaving another complete member intact.

The revision test edits `head.fontRevision`, rebuilds sfnt table checksums and
the file checksum adjustment, and asserts their validity. Name/locale tests
replace the name table. These derivatives exist only locally during tests;
they are not distributed as font products or committed binary fixtures.
Classification tests similarly modify temporary copies only.

## Deliberately absent

No macOS/Windows system fonts, user fonts, commercial fonts or fonts of unknown
origin are committed. System smoke scans are read-only. No WOFF parser,
conversion tool, decompressor or font compiler is included.
