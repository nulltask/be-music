# @be-music/chart-model

## 0.7.0

### Minor Changes

- 69df53c: Resolve extended bmson resource keys, source-audio slice coordinates and explicit TOTAL units so stitched mixed-format NONSTOP charts retain their playback data.
- f994ec4: Export the shared `resolvePoorBGAMode` parser so browser and terminal BGA rendering use the same chart policy.

### Patch Changes

- a83e326: Use `____` in internal names for the That-Which-Must-Not-Be-Named lane layouts and mode detection.
- c52d77d: `computeChartFingerprint` is faster on `#RANDOM` / `#SWITCH` charts (about 40% on the heaviest, `_random_s4.bms` 118 → 72 ms), with byte-identical fingerprints: outcomes that change only events reuse the notes already resolved for a lane with the same events, the lane buckets merge in order instead of being re-sorted, and the diff against the top-level content finds the shared runs by comparing fields instead of keying every note. Checked against every chart of a 5,537-chart collection and 400 generated control-flow charts.
- Updated dependencies [69df53c]
- Updated dependencies [29e69c6]
- Updated dependencies [2e435b9]
  - @be-music/chart-source@0.5.0
  - @be-music/shared-utils@0.6.0

## 0.6.0

### Minor Changes

- dca9a2f: Rename the package from `@be-music/chart` to `@be-music/chart-model` to identify its role consistently. Update imports and package filters to the new name.

### Patch Changes

- Updated dependencies [dca9a2f]
- Updated dependencies [dca9a2f]
  - @be-music/chart-source@0.4.0
  - @be-music/shared-utils@0.5.0

## 0.5.0

### Minor Changes

- b2818d0: Provide a shared chart-resolution API for timing, judging, playback, rendering and fingerprinting.
  
  - Add `resolveChart` with lazily computed playable notes, long notes, mines, invisible notes, sample triggers, tempo changes, bar lines, BGA cues, scroll and speed changes, judge-rank inputs and TOTAL.
  - Expose timing resolvers, sample-trigger helpers and timeline builders through `@be-music/chart-model`.
  - Define shared play-mode layouts for 5, 7, both 9-key layouts, 10, 14, 24 and 48 keys, including scratch, FREE ZONE and keyboard-wheel mappings.
  - Evaluate RANDOM and SWITCH control flow from explicit `RandomDraws` so playback, replay and verification use the same branches.
  - Add chart and play fingerprints with canonical fingerprint documents. Chart fingerprints preserve control-flow alternatives; play fingerprints identify the selected branches.
  - Match LR2 negative-BPM reversal timing and display values, keep the last duplicated BMS STOP at a position, and preserve authored bmson bar lines.
  - Reduce sorting work when resolving long notes.
  
  Migration: use the canonical uppercase-abbreviation exports and fields. Timing and timeline APIs previously imported from the audio renderer or player now come from this package. Fingerprint version `bmfp0` remains a development format.

### Patch Changes

- Updated dependencies [b2818d0]
  - @be-music/chart-source@0.3.0
  - @be-music/shared-utils@0.4.0
## 0.4.0

### Minor Changes

- 202a28b: Recognize the 24-key (Keyboardmania) lane channels, so charts authored past the classic nine columns classify and extract like any other playable chart.
  
  `ChartPlayVariant` gains `'24'` and `'48'`. `resolveChartPlayVariant` now checks the extended lane channels (`1A..1Z` / `2A..2Z`) before every other rule and returns `'48'` when the chart also uses the 2P side, `'24'` otherwise — ahead of the `.pms` extension, the `#PLAYER 3` + `17` POPN-9 signature, and the "full `11..19` 1P keyboard" rule, each of which a 24-key chart would otherwise trip.
  
  The `<side><lane>` channel predicates accept the extended `A`-`Z` lane codes alongside the classic `1`-`9`: `isPlayableChannel` (`1X` / `2X`), `isLandmineChannel` (`DX` / `EX`), `isBmsLongNoteChannel` (`5X` / `6X`), and `isPlayLaneSoundChannel`. `mapBmsLongNoteChannelToPlayable` maps the extended long-note columns onto their playable counterparts (`5A` → `1A`, `6O` → `2O`).

## 0.3.2

### Patch Changes

- Updated dependencies [b9922cf]
  - @be-music/chart-source@0.2.2

## 0.3.1

### Patch Changes

- @be-music/chart-source@0.2.1

## 0.3.0

### Minor Changes

- 06a2db9: `resolveChartPlayVariant` now detects PMS-STD / POPN-9 charts authored as `.bme` / `.bms` instead of falling through to That-Which-Must-Not-Be-Named heuristics.

  - BME POPN-9 — `#PLAYER 1` + every channel `11..19` populated maps to `'9'` (That-Which-Must-Not-Be-Named 7K never lights all nine columns).
  - PMS-STD on any extension — any of channels `22..25` AND no traditional That-Which-Must-Not-Be-Named 2P channels (`21` / `26..29`) maps to `'9'`.

## 0.2.0

### Minor Changes

- 632f274: Thread the chart's `#BASE 62` object-ID base through every `parseInt` / `toString` site so serialised charts round-trip without dropping casing. Charts that don't declare `#BASE 62` keep the historical 36-base behaviour.

### Patch Changes

- Updated dependencies [632f274]
  - @be-music/chart-source@0.2.0

## 0.1.0

### Minor Changes

- Initial release.

### Patch Changes

- Updated dependencies
  - @be-music/chart-source@0.1.0
