# @be-music/skin-sdk

## 0.1.0

### Minor Changes

- 872c26c: Add `@be-music/skin-sdk`, the package be-music skins for the browser player are written against. It imports no rendering framework: the player hands a skin a canvas and plain per-frame data, and the skin draws with whatever it brings (the Canvas 2D API, raw WebGL / WebGPU, PixiJS, three.js, …).
  
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
  - @be-music/chart@0.4.0
  - @be-music/player@0.7.0
  - @be-music/audio-renderer@0.2.4
