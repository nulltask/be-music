# @be-music/player-ui-vue

## 0.3.1

### Patch Changes

- Updated dependencies: `@be-music/player-ui@0.8.1`

## 0.3.0

### Minor Changes

- 0f3c127: Wrap the chart score element, and follow the README dialog.
  
  - Add the `BeMusicChartScore` wrapper for `<be-music-chart-score>`, with its `layout`, `selection`, `previewing`, `columnBeats`, `beatHeight` and `disabled` props and `onBarSelectionChange`.
  - `BeMusicChartScore`'s `previewing` prop takes a run of bars (`{ first, last }`) as well as one bar.
  - `BeMusicChartDetails` takes `readmeAvailable` in place of `readText`, following `<be-music-chart-details>`: the README shows in the host's dialog instead of under the buttons.

### Patch Changes

- Updated dependencies: `@be-music/player-ui@0.8.0`

## 0.2.7

### Patch Changes

- Updated dependencies: `@be-music/player-ui@0.7.1`

## 0.2.6

### Patch Changes

- Updated dependencies: `@be-music/player-ui@0.7.0`

## 0.2.5

### Patch Changes

- Updated dependencies: `@be-music/player-ui@0.6.1`

## 0.2.4

### Patch Changes

- Updated dependencies: `@be-music/player-ui@0.6.0`

## 0.2.3

### Patch Changes

- Updated dependencies: `@be-music/player-ui@0.5.0`

## 0.2.2

### Patch Changes

- Updated dependencies: `@be-music/player-ui@0.4.0`

## 0.2.1

### Patch Changes

- Updated dependencies: `@be-music/player-ui@0.3.0`

## 0.2.0

### Minor Changes

- cf6ed23: Add `@be-music/player-ui-vue`, typed Vue wrappers for the `@be-music/player-ui` Web Components that forward object properties, typed emits and element refs and register the elements before client mount, among them the playfield components (`BeMusicBGA`, `BeMusicLanes`, `BeMusicNotes`, `BeMusicLaneCovers`, `BeMusicJudgeLine`, `BeMusicBombs`, `BeMusicJudgmentDisplay`, `BeMusicPlayfield`) and the preview components (`BeMusicPlaybackControls`, `BeMusicPreviewHUD`, `BeMusicPreviewSelect` with `images` and `courses`, `BeMusicPreviewStart`).

### Patch Changes

- Updated dependencies: `@be-music/player-ui@0.2.0`
