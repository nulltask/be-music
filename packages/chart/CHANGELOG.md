# @be-music/chart

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
