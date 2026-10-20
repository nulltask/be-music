# @be-music/player-skin-sdk

## 0.4.0

### Minor Changes

- 9a0c3f9: Use chart-based names for chart facts, images, and best records, including `ChartStats`, `BeMusicChartBestRecord`, `chartBestRecord`, and `courseBestRecord`. Rename judgment types and consume result data through `chart` and `replay`. Keep `BeMusicStage` unchanged; previous renamed API spellings are removed.
  
  Rename the package from `@be-music/skin-sdk` to `@be-music/player-skin-sdk` to identify its role consistently. Update imports and package filters to the new name.

### Patch Changes

- Updated dependencies [dca9a2f]
- Updated dependencies [dca9a2f]
- Updated dependencies [9a0c3f9]
- Updated dependencies [9a0c3f9]
  - @be-music/chart-model@0.6.0
  - @be-music/chart-source@0.4.0
  - @be-music/player-engine@0.10.0
  - @be-music/player-scene-model@0.2.0

## 0.3.0

### Minor Changes

- b2818d0: Expose shared player-scene-model library entries, play options, play/results and course data to custom skins.
  
  - Support course bars and records, keyboard-wheel lanes, 24/48-key filters, additional sort modes, touch-scroll rows and in-place search state.
  - Provide chart facts from the resolved chart, shared clear-lamp/rank vocabulary and result presentation for single plays, course stages and complete runs.
  - Add deterministic hold-spark effects.
  - Validate required font-load declarations and report missing skin metadata instead of failing during loading.
  
  Migration: use chart entries (`entry.chart`, `folder.charts`) and the shared library types from `@be-music/player-scene-model`. Use canonical abbreviation spellings and shared result/record types. The developing skin API revision is `0`; existing revision-1 declarations remain accepted.

### Patch Changes

- Updated dependencies [b2818d0]
  - @be-music/chart-model@0.5.0
  - @be-music/chart-source@0.3.0
  - @be-music/player-engine@0.9.0
  - @be-music/player-scene-model@0.1.0
## 0.2.0

### Minor Changes

- 7260b23: Skins now receive everything they need to match what LR2 and beatoraja skins can show. Every addition is optional or opt-in, so existing skins keep working unchanged.
  
  - Gameplay runtime: `song`, `lastJudgeDeltaMs` / `judgeTimings` (positive = late), `judgeWindows`, `laneCovers`, `visibleMs`, `greenNumber`, `minBpm` / `maxBpm` / `mainBpm`, `songLengthMs` / `songElapsedMs`, `failedAtMs` / `allNotesDoneAtMs` / `outroAtMs`, `gaugeRiseAtMs` / `gaugeMaxAtMs`, and `scoreHistory` / `gaugeHistory`.
  - Gameplay frame: `measureLines` and `bga` behind the new opt-in `drawsMeasureLines` / `drawsBga` flags, `drawsLaneCover`, per-lane press / release / hold times, long-note `mode` / `state`, `autoplay` on notes, and the `judge` behind each bomb.
  - Select frame: `playOptions` / `playOptionChoices` with `setPlayOption`, `cyclePlayOption`, and `toggleReadme` actions, `pointer`, `songRecord(song)`, and `hit` returning whether the pointer is over the rect. `BeMusicPlayOptions` and its value unions now live in the SDK.
  - Result data: `lamp`, `gaugeType`, `judgeRuleset`, `fast` / `slow`, and `judgeTimings`, with `binJudgeTimings` for timing histograms.
  - An optional decide screen (`skin.decide`), skin settings (`skin.settings`, resolved with `resolveBeMusicSkinSettings` and checked by `validateBeMusicSkin`), and `songImage(song, kind)` on every frame.
- 3f1b6b3: The gameplay runtime gains `songGenre`, and `bpm` is now documented as the BPM at the playhead.
- d2f7f82: Gameplay frames now carry mine notes: `frame.mines` lists each one as `{ kind, x, w, y }`, and a skin that sets `gameplay.drawsMines: true` draws them itself. Skins that leave it unset keep the player's built-in mine drawing, so existing skins still show mines.
- 9a79565: Add a portrait stage, so a skin can draw phones and tablets held upright on a 9:16 canvas instead of a 16:9 one shrunk into a thin band.
  
  - `BeMusicSkin.portraitStage` (optional): the canvas a skin draws on while the screen is taller than wide. `tallStage` is the built-in one, 480×854 (`wideStage` on its side), with its BGA in a 206 px square at the top left.
  - `resolveBeMusicStage(skin, screen, chart?)` picks the stage for a screen; gameplay keeps the landscape stage for charts too wide for portrait (double play, 24 / 48 KEY; see `supportsPortraitLayout`).
  - On a portrait stage `resolveGameplayLayout` lays the lanes across the stage's width in its lower part, in both the standard and the touch mode, keeps the BGA above them, and reports `orientation: 'portrait'` on the layout. `resolveGameplayLaneGeometry` takes the stage as an optional fifth argument.
  - `BeMusicSurface.orientation` and `BeMusicSelectSkin.portraitLayout` (optional), plus `resolveStageOrientation`, `resolveBeMusicSelectLayout`, `resolvePortraitLaneLayout`, `PORTRAIT_PLAYFIELD`, `TALL_STAGE_WIDTH`, `TALL_STAGE_HEIGHT`, `TALL_STAGE_BGA`, and the `BeMusicStageOrientation` type.
- 7f01985: Add a touch gameplay layout, so a host can give touch-screen players finger-sized lanes and skins receive them through the layout they already read.
  
  - `resolveGameplayLayout` takes an optional `layoutMode: 'standard' | 'touch'` (default `'standard'`, unchanged geometry). In `'touch'` the lanes spread from the stage's left margin to the judgement tally's column with every key one width (at most 72 px) and a scratch 1.4 keys wide, the lanes run from y 48 (below the header band) to a judgement line at y 330 (above the bottom HUD band), so no built-in HUD panel covers them, and `bga` is `undefined`. The 24 / 48 KEY modes keep the standard layout.
  - `BeMusicGameplayLayout` gains an optional `mode` reporting the layout the host resolved.
  - New helpers: `resolveGameplayLaneGeometry` (lane rects, bounds, and judgement line for either mode), `resolveTouchLaneLayout`, `supportsTouchLayout`, and the `TOUCH_PLAYFIELD` constants, plus the `GameplayLayoutMode` type.

### Patch Changes

- Updated dependencies [73fd398]
  - @be-music/player-engine@0.8.0

## 0.1.0

### Minor Changes

- 872c26c: Add `@be-music/player-skin-sdk`, the package be-music skins for the browser player are written against. It imports no rendering framework: the player hands a skin a canvas and plain per-frame data, and the skin draws with whatever it brings (the Canvas 2D API, raw WebGL / WebGPU, PixiJS, three.js, …).
  
  - Skin contract: `BeMusicSkin` and its surface and frame types (gameplay, select, result), `defineBeMusicSkin`, `validateBeMusicSkin`, and `BE_MUSIC_SKIN_API_VERSION`. A skin declares its metadata (id, semantic version, author), the canvas context it wants, optional `setup` / `teardown` hooks for its own renderer, and one `draw` per screen.
  - Stage and layout: `wideStage` and its BGA placement, `resolveGameplayLayout`, `resolveLaneRuns`, the lane geometry the player lays lanes out with (IIDX lane widths, the double-play gap, keyboard modes), and `resolveBeMusicLaneKind`.
  - Play state and sound: judgement words, moments (count-in, combo milestones, the clear line, full combo, combo break), effect levels, the loading caption, and `audioDrive` / `bandLevel` over the `BeMusicAudioFrame` analysis.
  - Song and result facts: the song entry types, select-row facts, result lamp and track rows, plus tabular figure layout and motion helpers.

### Patch Changes

- Updated dependencies [202a28b]
- Updated dependencies [d9958ac]
- Updated dependencies [f24ed8b]
- Updated dependencies [202a28b]
- Updated dependencies [750c47d]
- Updated dependencies [b3fa635]
- Updated dependencies [2d7652c]
- Updated dependencies [0103435]
- Updated dependencies [9505684]
- Updated dependencies [1589105]
- Updated dependencies [1c6e7aa]
- Updated dependencies [08e62d0]
- Updated dependencies [41f5efb]
- Updated dependencies [40f1050]
  - @be-music/chart-model@0.4.0
  - @be-music/player-engine@0.7.0
  - @be-music/chart-audio-renderer@0.2.4
