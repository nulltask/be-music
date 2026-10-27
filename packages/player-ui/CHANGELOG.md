# @be-music/player-ui

## 0.2.0

### Minor Changes

- 3e694df: Add `@be-music/player-ui`, Lit Web Components for a player's HTML screens and playfield, with typed presentation properties, semantic events and explicit registration:
  
  - Screens and panels: collection browsing with search (marking a `?` chart filter expression that does not parse and showing why), decide and result screens, and the gameplay HUD panels and play settings, a two-player play's 2P player and a paused indicator included. They lay out from each element's own width, so a narrow column stacks on its own.
  - Playfield components that each draw on a canvas the size of their part of the stage: `be-music-bga` (overlay-mode POOR images above the normal layers), `be-music-lanes`, `be-music-notes` (with mines, measure lines, each side's LIFT and the CONSTANT note fade), `be-music-lane-covers`, `be-music-judge-line`, `be-music-bombs` and `be-music-judgment-display` (the combo in tabular figures under a judgment that keeps it, and a flashing GREAT for a PGREAT), placed on the letterboxed stage by `be-music-playfield`. `resolvePlayfieldParts`, `paintPlayfieldParts` and the `BeMusicPlayfieldCanvasElement` base class are exported.
  - Preview components: `be-music-playback-controls` (play / pause, a thin seek bar that seeks while dragged, time, mute with a volume slider, full screen), `be-music-preview-hud` (a centred play button while paused, a click on the picture to play or pause, the course title and stage progress, controls hidden while the host sets `controlsHidden`), `be-music-preview-select` (chart rows with pictures from `images`, and `courses` with their kinds and stages, disabling courses whose charts are missing) and `be-music-preview-start`, with the `seek-request`, `volume-change` and `fullscreen-request` events, the `formatPlaybackTime`, `resolveSeekTarget` and `resolveGameplayPanels` helpers, the `LibraryCourse` type, and the preview layout (`resolvePreviewBGARect`, `resolvePreviewInfoBox`): the largest BGA right of the lanes with the chart's facts beside or under it, or across the top of a tall stage.
  
  The elements ship headless: their own styles cover layout, sizing and scrolling, and the look comes from a theme. `defineBeMusicElements(registry, { theme })` adds a theme's style sheets to every element (`setBeMusicTheme` sets it afterwards), and the `@be-music/player-ui/themes/basecoat` subpath exports `basecoatTheme`, which styles them with Basecoat from the page's Basecoat tokens. Spacing and type read `--be-music-*` custom properties, the product line over a title is an `eyebrow` slot, and screens expose `header`, `eyebrow`, `title`, `search`, `folder`, `columns`, `progress`, `stat`, `actions`, `chart-panel` and `row-kind` parts. `BeMusicTheme` and `BeMusicElementsOptions` are exported types.

### Patch Changes

- Updated dependencies [74127d3]
- Updated dependencies [a83e326]
- Updated dependencies [01cd4cd]
- Updated dependencies [29e69c6]
- Updated dependencies [f994ec4]
- Updated dependencies [6fc13f5]
- Updated dependencies [a8896a9]
- Updated dependencies [2e435b9]
  - @be-music/player-skin-sdk@0.5.0
