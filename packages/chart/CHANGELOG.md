# @be-music/chart

## 0.4.0

### Minor Changes

- 202a28b: Recognize the 24-key (Keyboardmania) lane channels, so charts authored past the classic nine columns classify and extract like any other playable chart.
  
  `ChartPlayVariant` gains `'24'` and `'48'`. `resolveChartPlayVariant` now checks the extended lane channels (`1A..1Z` / `2A..2Z`) before every other rule and returns `'48'` when the chart also uses the 2P side, `'24'` otherwise — ahead of the `.pms` extension, the `#PLAYER 3` + `17` POPN-9 signature, and the "full `11..19` 1P keyboard" rule, each of which a 24-key chart would otherwise trip.
  
  The `<side><lane>` channel predicates accept the extended `A`-`Z` lane codes alongside the classic `1`-`9`: `isPlayableChannel` (`1X` / `2X`), `isLandmineChannel` (`DX` / `EX`), `isBmsLongNoteChannel` (`5X` / `6X`), and `isPlayLaneSoundChannel`. `mapBmsLongNoteChannelToPlayable` maps the extended long-note columns onto their playable counterparts (`5A` → `1A`, `6O` → `2O`).

## 0.3.2

### Patch Changes

- Updated dependencies [b9922cf]
  - @be-music/json@0.2.2

## 0.3.1

### Patch Changes

- @be-music/json@0.2.1

## 0.3.0

### Minor Changes

- 06a2db9: `resolveChartPlayVariant` now detects PMS-STD / POPN-9 charts authored as `.bme` / `.bms` instead of falling through to IIDX heuristics.

  - BME POPN-9 — `#PLAYER 1` + every channel `11..19` populated maps to `'9'` (IIDX 7K never lights all nine columns).
  - PMS-STD on any extension — any of channels `22..25` AND no traditional IIDX 2P channels (`21` / `26..29`) maps to `'9'`.

## 0.2.0

### Minor Changes

- 632f274: Thread the chart's `#BASE 62` object-ID base through every `parseInt` / `toString` site so serialised charts round-trip without dropping casing. Charts that don't declare `#BASE 62` keep the historical 36-base behaviour.

### Patch Changes

- Updated dependencies [632f274]
  - @be-music/json@0.2.0

## 0.1.0

### Minor Changes

- Initial release.

### Patch Changes

- Updated dependencies
  - @be-music/json@0.1.0
