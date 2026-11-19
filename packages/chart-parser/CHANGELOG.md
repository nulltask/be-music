# @be-music/chart-parser

## 0.8.0

### Minor Changes

- 7f6108a: Use `@be-music/chart-parser/core` to parse chart text and bytes without resolving the Node filesystem adapter. The root entry still provides `parseChartFile` and the existing parser exports.
- 398f2dd: The LRX parser reads BGA transforms (`sx`…`dh`, `a` `r` `g` `b`, `bld`, `rot`, `ctr`, `acc`, keyframe `cn`) and layers 203 and 204 into `lrx.bga`, as plugout reads them, and reading Be-Music JSON back keeps them.
- f5490bd: Read LRX charts (plugout4 -ARCADE EDITION-). `parseLRX` / `parseLRXBytes` convert an `.lrs` sequence with its `.lrh` header and `.lrm` BGA file onto BMS channels, keeping the LRX note and header values; `resolveLRXHeaderPath` and `resolveLRXMoviePath` name the files beside the `.lrs`. `parseChartFile` reads `.lrs` files with their siblings, and Be-Music JSON keeps the LRX values on a round trip.
- 880f8c2: Read Nanasi Groove 2 `.n2s` charts (Toy Musical 3). `parseN2SBytes` opens the encrypted "ZEXA" container and parses the PMS file inside as `parseBMSBytes` would; `readN2SArchive` lists a container's files and `isN2SArchive` recognizes one. `parseChartFile` dispatches `.n2s` files to it. The package now depends on `fflate` for the container's zlib streams.

### Patch Changes

- 71e61f9: Speed up BMS parsing by reducing allocations when reading object lines and scanning for WAV headers.
- e9cb57e: Preserve the later BMS normal-note object at a shared position when resolving or round-tripping charts with source line order.
- be797a5: A `#WAVxx` after a slot's `#EXWAVxx` now redefines it, as nanasigroove 1.552 does: the later line wins, also across control flow, where the two now share one definition. Before, a valid `#EXWAVxx` always won.
- d486332: Use only the last active BMS LNOBJ declaration as the long-note end marker. This can change the notes and fingerprint of charts with repeated declarations.
- 212d164: An LRX chain or hidden note records its lane in `lrx.lane`. Background sounds outside plugout's BGM mixer group (all but the BGM columns' notes with a non-zero `dmg`) are flagged `lrx.keyVolume`. Reading Be-Music JSON back keeps both. An LRX chain note with no note before it on its lane is a judged lane note, as plugout judges it.
- f45dc22: Speed up LRX parsing and read the chart’s video path from the header when available.
- 4ee342f: Speed up everything that compares or walks a parsed chart's events, such as sorting and timing: events read from BMS, bmson and Be-Music JSON now share the object shapes of the parser's plain events again. Optional fields such as `bmsLineOrder` and `bmson` were spread in, which gave the events several hidden classes and made event comparisons up to three times slower.
- 47aa2cd: Reduce BMS parsing work by building events directly from their object streams and checking header overrides only when branch headers are pending.
- Updated dependencies: `@be-music/chart-model@0.12.0`, `@be-music/chart-source@0.9.0`, `@be-music/shared-utils@0.8.0`

## 0.7.2

### Patch Changes

- a15f307: Report nonfatal chart warnings, and keep a positive `#STOPxx` over a later zero or negative one.
  
  - Report nonfatal warnings when reading legacy bmson or a chart with an unknown or malformed mode hint.
  - A zero or negative `#STOPxx` no longer replaces a positive definition of the same ID made earlier in the file, as in LR2, which stores only values above 0.
- Updated dependencies: `@be-music/chart-model@0.11.0`, `@be-music/chart-source@0.8.0`

## 0.7.1

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.10.0`

## 0.7.0

### Minor Changes

- cd2a0bd: Read pomu `#SONGxx`, the obsolete name of `#TEXTxx`, into `bms.songText`, including inside `#RANDOM` / `#SWITCH` branches and with base-62 keys. Older Be-Music JSON that kept `#SONGxx` in `metadata.extras` is moved into it on load.

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.9.0`, `@be-music/chart-source@0.7.0`

## 0.6.0

### Minor Changes

- 31ad44a: Read boolean bmson up fields and retain them through Be-Music JSON so consumers can distinguish LN end sounds from ordinary taps.
- c314b06: Read and preserve bmson info.title_image, including through Be-Music JSON normalization.
- bcf7edc: Preserve beatoraja bmson BGA sequences, end markers and conditional image sets through raw input and Be-Music JSON normalization, including events with no ordinary image id, which keep the id absent instead of reading it as `0`.
- 3187914: Preserve nonexecuted bmson fields on valid normalized root, info, channel, note, timing and BGA nodes, including hidden-note damage, through Be-Music JSON without changing playback semantics.

### Patch Changes

- 515407d: Reject null, malformed and unsupported bmson versions before interpreting chart data, and support stable 1.0.0 with optional SemVer build metadata. Read a missing-version legacy v0.21 chart by converting its fields and timing as Bemuse does, instead of treating it as the modern format; a missing version on a chart with only 1.0.0 fields is rejected as ambiguous.
- 32c7fb5: Retain every bmson sound, key and mine channel and every distinct BPM, STOP and SCROLL value beyond the two-character BMS key capacity; preserve long keys through Be-Music JSON reloads.
- 8926505: Read nanasi `#EXBPMxx` as an alias of `#BPMxx`. Channel `08` tempo changes that only `#EXBPMxx` defined were dropped as undefined references, so such charts kept the previous tempo. The alias is stored and written back as `#BPMxx`, follows the file-order rule for its index and applies inside control-flow branches; Be-Music JSON that kept it in `metadata.extras` migrates into `resources.bpm` unless `#BPMxx` defines the index.
- 7ea3be3: Validate and preserve optional intrinsic sample gain through Be-Music JSON round trips, including case-sensitive base-62 slot ids.
- adfaf40: Preserve repeated OPTION declarations and their vendor arguments instead of retaining only the last line. Resolve conditional and unconditional declarations in original order, and retain the ordered program through Be-Music JSON.
- a69f267: Use the shared generic lane table for `generic-Nkeys` bmson with 1–70 keys. Out-of-range or malformed `generic-` hints are read as unknown hints (`beat-7k` where the lanes fit, as beatoraja does) instead of clamping them or routing extra columns into unrelated channel families.
- Updated dependencies: `@be-music/chart-model@0.8.0`, `@be-music/chart-source@0.6.0`, `@be-music/shared-utils@0.7.0`

## 0.5.0

### Minor Changes

- aba15df: Add `parseBMSBytes` and keep the leading bytes of each `#WAV` file name (`bms.wavNameBytePrefixes`), by which LR2 groups a chart's sounds into families for EXTRA MODE and SP TO DP.

### Patch Changes

- a82ec63: Preserve extended bmson resource keys, source-audio slice coordinates and explicit TOTAL units when reading Be-Music JSON for stitched NONSTOP charts.
- Updated dependencies: `@be-music/chart-model@0.7.0`, `@be-music/chart-source@0.5.0`, `@be-music/shared-utils@0.6.0`

## 0.4.0

### Minor Changes

- 559897f: Rename the package from `@be-music/parser` to `@be-music/chart-parser` to identify its role consistently. Update imports and package filters to the new name.

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.6.0`, `@be-music/chart-source@0.4.0`, `@be-music/shared-utils@0.5.0`

## 0.3.0

### Minor Changes

- 8a051a5: Parse BMS and bmson using shared chart semantics and canonical Be-Music JSON names.
  
  - Support explicit RANDOM/SWITCH outcomes with `resolveBMSControlFlowWithDraws` and reject outcomes that do not belong to the chart.
  - Decode EUC-KR Korean charts and honor EUC-KR/CP949 charset declarations.
  - Read BASE declarations anywhere in a BMS file, with the last valid declaration taking precedence.
  - Read bmson keyboard modes, wheel lanes, mines, hidden notes and scroll events with their specified lane mappings.
  - Reuse BPM/STOP keys and support base-62 tables when needed, avoiding overwritten events in large bmson charts.
  - Improve BMS parsing speed while preserving chart content and encoding detection.
  
  Migration: use `parseBMS`, `resolveBMSControlFlow` and `resolveBMSControlFlowWithDraws`. Former Be-Music JSON keys remain accepted on input, with canonical keys taking precedence; external format spellings are unchanged.

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.5.0`, `@be-music/chart-source@0.3.0`, `@be-music/shared-utils@0.4.0`
## 0.2.4

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.4.0`

## 0.2.3

### Patch Changes

- b2c4f9b: `decodeBmsText` now implements the full documented encoding-detection pipeline: UTF-16LE / UTF-16BE BOMs are recognized (such charts previously decoded as garbled shift_jis and lost every event), BOM-less files that strictly validate as UTF-8 decode as UTF-8, and remaining files are scored across shift_jis / utf-8 / euc-jp / iso-8859-1 instead of unconditionally falling back to shift_jis.
- b9922cf: Preserve beatoraja bmson long-note type extensions in the IR: `info.ln_type` and per-note `t` (1: LN, 2: CN, 3: HCN).
- 4d5a89e: Accept the real-world control-flow spelling variants `#END IF`, bare `#END`, and `#ELSE IF n` as `#ENDIF` / `#ELSEIF n`. Previously such charts left the `#IF` block unterminated, so a non-matching `#RANDOM` roll silently dropped every line after the misspelled directive.
- cdc42a1: BMS object data lines (`#mmmcc:data`) are now truncated at the first whitespace character. Trailing text no longer fabricates note events (e.g. `junk` becoming `JU`/`NK` objects) or inflates the position denominator of the legitimate tokens before it.
- Updated dependencies: `@be-music/chart-source@0.2.2`, `@be-music/shared-utils@0.3.0`, `@be-music/chart-model@0.3.2`

## 0.2.2

### Patch Changes

- Updated dependencies: `@be-music/shared-utils@0.2.1`, `@be-music/chart-source@0.2.1`, `@be-music/chart-model@0.3.1`

## 0.2.1

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.3.0`

## 0.2.0

### Minor Changes

- 632f274: Detect the `#BASE 62` header and decode channel-row IDs case-sensitively under it (`0-9A-Za-z`). Charts that don't declare `#BASE 62` keep the historical 36-base behaviour.

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.2.0`, `@be-music/chart-source@0.2.0`, `@be-music/shared-utils@0.2.0`

## 0.1.0

### Minor Changes

- Initial release.

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.1.0`, `@be-music/chart-source@0.1.0`, `@be-music/shared-utils@0.1.0`
