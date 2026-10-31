# @be-music/player-ui

## 0.3.0

### Minor Changes

- 410843c: Display decoded title artwork in the Native decide heading while retaining accessible title text and the fallback for missing images.
- 5cc0094: Render per-plane BGA opacity and all NONSTOP stage stacks in Canvas playfields, combining chart opacity, stage crossfades and inherited Canvas alpha while restoring the caller's alpha after drawing.
- 4480fe0: Apply per-plane BGA origins when painting cropped images, preserving chart-authored placement through Canvas skins and NONSTOP stage stacks.

### Patch Changes

- 916e04c: Draw a white centre line down long-note bodies, the long-note shape the built-in skins share, so the Native skin matches Synesthesia and Plain. The line fades out after an early release.
- afc65fb: Show the declared generic key count and keyboard identity in gameplay facts.
- 17a4096: Composite the optional second BGA overlay above the first in shared playfield painting, preserving both in Native and Canvas skins and keeping POOR replacement and overlay modes.
- Updated dependencies: `@be-music/player-skin-sdk@0.6.0`

## 0.2.0

### Minor Changes

- 3e694df: Add `@be-music/player-ui`, Lit Web Components for a player's HTML screens and playfield, with typed presentation properties, semantic events and explicit registration:
  
  - Screens and panels: collection browsing with search (marking a `?` chart filter expression that does not parse and showing why), decide and result screens, and the gameplay HUD panels and play settings, a two-player play's 2P player and a paused indicator included. They lay out from each element's own width, so a narrow column stacks on its own.
  - Playfield components that each draw on a canvas the size of their part of the stage: `be-music-bga` (overlay-mode POOR images above the normal layers), `be-music-lanes`, `be-music-notes` (with mines, measure lines, each side's LIFT and the CONSTANT note fade), `be-music-lane-covers`, `be-music-judge-line`, `be-music-bombs` and `be-music-judgment-display` (the combo in tabular figures under a judgment that keeps it, and a flashing GREAT for a PGREAT), placed on the letterboxed stage by `be-music-playfield`. `resolvePlayfieldParts`, `paintPlayfieldParts` and the `BeMusicPlayfieldCanvasElement` base class are exported.
  - Preview components: `be-music-playback-controls` (play / pause, a thin seek bar that seeks while dragged, time, mute with a volume slider, full screen), `be-music-preview-hud` (a centred play button while paused, a click on the picture to play or pause, the course title and stage progress, controls hidden while the host sets `controlsHidden`), `be-music-preview-select` (chart rows with pictures from `images`, and `courses` with their kinds and stages, disabling courses whose charts are missing) and `be-music-preview-start`, with the `seek-request`, `volume-change` and `fullscreen-request` events, the `formatPlaybackTime`, `resolveSeekTarget` and `resolveGameplayPanels` helpers, the `LibraryCourse` type, and the preview layout (`resolvePreviewBGARect`, `resolvePreviewInfoBox`): the largest BGA right of the lanes with the chart's facts beside or under it, or across the top of a tall stage.
  
  The elements ship headless: their own styles cover layout, sizing and scrolling, and the look comes from a theme. `defineBeMusicElements(registry, { theme })` adds a theme's style sheets to every element (`setBeMusicTheme` sets it afterwards), and the `@be-music/player-ui/themes/basecoat` subpath exports `basecoatTheme`, which styles them with Basecoat from the page's Basecoat tokens. Spacing and type read `--be-music-*` custom properties, the product line over a title is an `eyebrow` slot, and screens expose `header`, `eyebrow`, `title`, `search`, `folder`, `columns`, `progress`, `stat`, `actions`, `chart-panel` and `row-kind` parts. `BeMusicTheme` and `BeMusicElementsOptions` are exported types.

### Patch Changes

- Updated dependencies: `@be-music/player-skin-sdk@0.5.0`
