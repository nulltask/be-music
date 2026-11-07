# @be-music/player-ui

## 0.8.1

### Patch Changes

- Updated dependencies: `@be-music/chart-model@0.10.0`, `@be-music/player-skin-sdk@0.11.1`

## 0.8.0

### Minor Changes

- c60eb63: Add a chart score element and a README dialog.
  
  - Add `<be-music-chart-score>`, which draws a chart as a printed score: its bars in columns, bottom to top, each with its measure number, bar and beat lines, notes, long notes and mines on the play mode's lanes (5 / 7 / 10 / 14 KEY and 9 KEY), and its tempo changes and stops. `layoutChartScore(chart)` lays a resolved chart out bar by bar (measure lengths, BPM changes, stops, long notes across bar lines) with each bar's chart times, and the bars can be picked one or a run at a time (`bar-selection-change`, `chartScoreRangeTimes`). `packChartScoreColumns`, `selectChartScoreBars`, `resolveChartScoreLanes`, `resolveChartScoreColumn` and `chartScoreRowAt` are exported too.
  - `layoutChartScore(chart, { omitEmptyFirstBar: true })` leaves an empty measure 0 out so the score starts at measure 1, with `isChartScoreBarEmpty` and each bar's `soundCount` deciding what is empty. `<be-music-chart-score>`'s `previewing` also takes a run of bars (`{ first, last }`) to outline.
  - `isChartScoreBarEmpty` (and `omitEmptyFirstBar`) now reads a bar as empty when it holds nothing to play: no note, long note or mine. BGM, BGA, tempo changes and stops in a lead-in measure 0 no longer keep it on the score.
  - Add `<be-music-readme-dialog>`, a modal Basecoat dialog that shows a plain text file such as a chart's README in a fixed-width face, with its web and mail addresses as links that open in a new tab (`rel="noopener noreferrer"`). It builds text nodes and anchors from `splitLinkedText`, a new export that splits a text into runs of plain text and links, so the text is never read as HTML. The dialog sends `readme-close` from its close button, Escape and the backdrop, and `scrollTextBy(delta)` scrolls it for a host that takes the keys.
  - `<be-music-chart-details>` no longer shows the README inline under its buttons: `readText` is replaced by `readmeAvailable`, which disables the Readme button on a chart without one.
  - The play screen's difficulty plate shows an estimated difficulty with its mark (`?` from the names, `??` from the note count) and dimmed, the note-count one further (`data-estimated="names" | "notes"`).

### Patch Changes

- Updated dependencies: `@be-music/player-skin-sdk@0.11.0`

## 0.7.1

### Patch Changes

- 16eee5d: The result screen shows an AUTO PLAY or ASSIST tag under a player's verdict, so an AUTO or assisted play's result is no longer mistaken for a plain one.
- Updated dependencies: `@be-music/player-skin-sdk@0.10.0`

## 0.7.0

### Minor Changes

- 816a5d2: Support consistent note sizing and two-player cabinet presentation.

  - Add optional `BeMusicNotesData.whiteLaneWidth`; playfield frames supply it so notes, long-note caps, and mines share a white-key-based height instead of a fixed height.
  - Draw independent players and side-playfield ghosts with separate gauges, scores, and hi-speed panels around a central BGA.
  - Use round joins for gauge and timing graphs to prevent sharp turns from producing miter spikes.
  - Add compact chart details, improve portrait controls and select filters, and keep result information grouped consistently.
  - Keep held cabinet keys filled, animate turntable indicators with chart beats and scratch input direction, and vertically center compact gauge captions. Show AUTO PLAY and GHOST PLAY above each side's judgment, including between hits and with LIFT.

### Patch Changes

- Updated dependencies: `@be-music/player-skin-sdk@0.9.0`

## 0.6.1

### Patch Changes

- 569eb54: The Native playfield tells the long-note kinds apart like the built-in skins:
  
  - An HCN has a zigzag centre line (the other kinds keep it straight), and a back-spin scratch has a chevron on its tail cap, so LN / CN / HCN / BSS read apart without colour.
  - A hell charge note shows a violet HELL colour before it is reached, a bright orange glow with the zigzag flowing into the judgement line while held, and a dim red with the zigzag flowing back up while draining.
  - `BeMusicNotesData` gains an optional `nowMs`, and the paint context also uses `moveTo`, `lineTo`, `closePath`, `fill`, `stroke`, `strokeStyle` and `lineWidth`.
- Updated dependencies: `@be-music/player-skin-sdk@0.8.0`

## 0.6.0

### Minor Changes

- cafe76b: Add a `cabinet` property to `be-music-gameplay-hud`: a landscape play in the standard layout is arranged as the skin SDK's cabinet layout, with the score graph, stage band, players, judgement panel, BPM and tempo, and the play information behind an Info button.

### Patch Changes

- 7ba64b0: The play settings panel names the lowest auto-shift gauge as LR2 does under LR2 rules (GROOVE, and EASY for ASSIST EASY), since gauge auto-shift now works under every ruleset (#933).
- 2ee74d2: The Basecoat theme names the system faces instead of Geist, which no host loaded, so text no longer depends on a locally installed font.
- Updated dependencies: `@be-music/player-skin-sdk@0.7.0`

## 0.5.0

### Minor Changes

- 155bd8d: `be-music-preview-select` and `be-music-preview-start` gain an `autoPlay` property: set, they show an **AUTO** checkbox (in the list's header, under the play button) whose change emits the new `auto-play-change` event. Unset, nothing changes.
- b9bc65c: The preview's lanes now reach down to just above the video controls without running under them: on a phone held upright they stopped well short, and on a phone held sideways (SP or DP) the judgement line sat under the seek bar. `resolvePreviewPortrait` and the new `previewJudgementInset` keep clear only the controls' height on the smallest (320 px) phone and a 16 px gap; `PREVIEW_CONTROLS_CSS_HEIGHT` is exported with it. `be-music-preview-hud` also puts the controls along the bottom of the screen rather than the stage, so a stage letterboxed into the screen keeps them off its lanes.
- c6437bc: `be-music-preview-start` gains a `load` mode (a download icon and "Load") and a `caption` property, a line of small type under the label such as the file the button loads.

## 0.4.0

### Minor Changes

- 1155634: `be-music-preview-hud` shows a **Back** button under the play button of a paused play; it emits `quit-request`.
- 2768ab6: `be-music-preview-hud` gains a `stageTapPauses` property (on by default). Turned off, the stage takes no clicks, so only the controls bar pauses the play; the embed turns it off while the viewer plays.

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
