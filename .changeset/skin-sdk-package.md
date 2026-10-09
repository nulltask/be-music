---
'@be-music/skin-sdk': minor
---

Add `@be-music/skin-sdk`, the package be-music skins for the browser player are written against. It imports no rendering framework: the player hands a skin a canvas and plain per-frame data, and the skin draws with whatever it brings (the Canvas 2D API, raw WebGL / WebGPU, PixiJS, three.js, …).

- Skin contract: `BeMusicSkin` and its surface and frame types (gameplay, select, result), `defineBeMusicSkin`, `validateBeMusicSkin`, and `BE_MUSIC_SKIN_API_VERSION`. A skin declares its metadata (id, semantic version, author), the canvas context it wants, optional `setup` / `teardown` hooks for its own renderer, and one `draw` per screen.
- Stage and layout: `wideStage` and its BGA placement, `resolveGameplayLayout`, `resolveLaneRuns`, the lane geometry the player lays lanes out with (IIDX lane widths, the double-play gap, keyboard modes), and `resolveBeMusicLaneKind`.
- Play state and sound: judgement words, moments (count-in, combo milestones, the clear line, full combo, combo break), effect levels, the loading caption, and `audioDrive` / `bandLevel` over the `BeMusicAudioFrame` analysis.
- Song and result facts: the song entry types, select-row facts, result lamp and track rows, plus tabular figure layout and motion helpers.
