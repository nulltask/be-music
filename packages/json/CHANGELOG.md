# @be-music/json

## 0.2.2

### Patch Changes

- b9922cf: The IR preserves beatoraja bmson long-note type extensions: `info.ln_type` and per-note `t` (1: LN, 2: CN, 3: HCN).
- Updated dependencies [ca1012c]
  - @be-music/utils@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [73dff9a]
  - @be-music/utils@0.2.1

## 0.2.0

### Minor Changes

- 632f274: `parseObjectKey` accepts a base parameter so `#BASE 62` object IDs (`0-9A-Za-z`) round-trip without dropping casing. Charts that don't declare `#BASE 62` keep the historical 36-base behaviour.

### Patch Changes

- Updated dependencies [632f274]
- Updated dependencies [135f822]
- Updated dependencies [135f822]
  - @be-music/utils@0.2.0

## 0.1.0

### Minor Changes

- Initial release.

### Patch Changes

- Updated dependencies
  - @be-music/utils@0.1.0
