# @be-music/chart-parser

## 0.6.0

### Minor Changes

- ceb5fcc: Read boolean bmson up fields and retain them through Be-Music JSON so consumers can distinguish LN end sounds from ordinary taps.
- 410843c: Read and preserve bmson info.title_image, including through Be-Music JSON normalization.
- c6f70f4: Preserve beatoraja bmson BGA sequences, end markers and conditional image sets through raw input and Be-Music JSON normalization, including events with no ordinary image id, which keep the id absent instead of reading it as `0`.
- c3b783a: Preserve nonexecuted bmson fields on valid normalized root, info, channel, note, timing and BGA nodes, including hidden-note damage, through Be-Music JSON without changing playback semantics.

### Patch Changes

- e4d00c9: Reject null, malformed and unsupported bmson versions before interpreting chart data, and support stable 1.0.0 with optional SemVer build metadata. Read a missing-version legacy v0.21 chart by converting its fields and timing as Bemuse does, instead of treating it as the modern format; a missing version on a chart with only 1.0.0 fields is rejected as ambiguous.
- e66f84f: Retain every bmson sound, key and mine channel and every distinct BPM, STOP and SCROLL value beyond the two-character BMS key capacity; preserve long keys through Be-Music JSON reloads.
- 2cfc7ae: Read nanasi `#EXBPMxx` as an alias of `#BPMxx`. Channel `08` tempo changes that only `#EXBPMxx` defined were dropped as undefined references, so such charts kept the previous tempo. The alias is stored and written back as `#BPMxx`, follows the file-order rule for its index and applies inside control-flow branches; Be-Music JSON that kept it in `metadata.extras` migrates into `resources.bpm` unless `#BPMxx` defines the index.
- 3e1855e: Validate and preserve optional intrinsic sample gain through Be-Music JSON round trips, including case-sensitive base-62 slot ids.
- 07a8c75: Preserve repeated OPTION declarations and their vendor arguments instead of retaining only the last line. Resolve conditional and unconditional declarations in original order, and retain the ordered program through Be-Music JSON.
- afc65fb: Use the shared generic lane table for `generic-Nkeys` bmson with 1–70 keys. Out-of-range or malformed `generic-` hints are read as unknown hints (`beat-7k` where the lanes fit, as beatoraja does) instead of clamping them or routing extra columns into unrelated channel families.
- Updated dependencies: `@be-music/chart-model@0.8.0`, `@be-music/chart-source@0.6.0`, `@be-music/shared-utils@0.7.0`

## 0.5.0

### Minor Changes

- 29e69c6: Add `parseBMSBytes` and keep the leading bytes of each `#WAV` file name (`bms.wavNameBytePrefixes`), by which LR2 groups a chart's sounds into families for EXTRA MODE and SP TO DP.

### Patch Changes

- 69df53c: Preserve extended bmson resource keys, source-audio slice coordinates and explicit TOTAL units when reading Be-Music JSON for stitched NONSTOP charts.
- Updated dependencies: `@be-music/chart-model@0.7.0`, `@be-music/chart-source@0.5.0`, `@be-music/shared-utils@0.6.0`

## 0.4.0

### Minor Changes

- dca9a2f: Rename the package from `@be-music/parser` to `@be-music/chart-parser` to identify its role consistently. Update imports and package filters to the new name.

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.6.0`, `@be-music/chart-source@0.4.0`, `@be-music/shared-utils@0.5.0`

## 0.3.0

### Minor Changes

- b2818d0: Parse BMS and bmson using shared chart semantics and canonical Be-Music JSON names.
  
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
