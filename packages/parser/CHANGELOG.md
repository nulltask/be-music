# @be-music/parser

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

- Updated dependencies [b2818d0]
  - @be-music/chart@0.5.0
  - @be-music/json@0.3.0
  - @be-music/utils@0.4.0
## 0.2.4

### Patch Changes

- Updated dependencies [202a28b]
  - @be-music/chart@0.4.0

## 0.2.3

### Patch Changes

- b2c4f9b: `decodeBmsText` now implements the full documented encoding-detection pipeline: UTF-16LE / UTF-16BE BOMs are recognized (such charts previously decoded as garbled shift_jis and lost every event), BOM-less files that strictly validate as UTF-8 decode as UTF-8, and remaining files are scored across shift_jis / utf-8 / euc-jp / iso-8859-1 instead of unconditionally falling back to shift_jis.
- b9922cf: Preserve beatoraja bmson long-note type extensions in the IR: `info.ln_type` and per-note `t` (1: LN, 2: CN, 3: HCN).
- 4d5a89e: Accept the real-world control-flow spelling variants `#END IF`, bare `#END`, and `#ELSE IF n` as `#ENDIF` / `#ELSEIF n`. Previously such charts left the `#IF` block unterminated, so a non-matching `#RANDOM` roll silently dropped every line after the misspelled directive.
- cdc42a1: BMS object data lines (`#mmmcc:data`) are now truncated at the first whitespace character. Trailing text no longer fabricates note events (e.g. `junk` becoming `JU`/`NK` objects) or inflates the position denominator of the legitimate tokens before it.
- Updated dependencies [b9922cf]
- Updated dependencies [ca1012c]
  - @be-music/json@0.2.2
  - @be-music/utils@0.3.0
  - @be-music/chart@0.3.2

## 0.2.2

### Patch Changes

- Updated dependencies [73dff9a]
  - @be-music/utils@0.2.1
  - @be-music/json@0.2.1
  - @be-music/chart@0.3.1

## 0.2.1

### Patch Changes

- Updated dependencies [06a2db9]
  - @be-music/chart@0.3.0

## 0.2.0

### Minor Changes

- 632f274: Detect the `#BASE 62` header and decode channel-row IDs case-sensitively under it (`0-9A-Za-z`). Charts that don't declare `#BASE 62` keep the historical 36-base behaviour.

### Patch Changes

- Updated dependencies [632f274]
- Updated dependencies [135f822]
- Updated dependencies [135f822]
  - @be-music/chart@0.2.0
  - @be-music/json@0.2.0
  - @be-music/utils@0.2.0

## 0.1.0

### Minor Changes

- Initial release.

### Patch Changes

- Updated dependencies
  - @be-music/chart@0.1.0
  - @be-music/json@0.1.0
  - @be-music/utils@0.1.0
