---
'@be-music/skin-sdk': minor
---

Add a portrait stage, so a skin can draw phones and tablets held upright on a 9:16 canvas instead of a 16:9 one shrunk into a thin band.

- `BeMusicSkin.portraitStage` (optional): the canvas a skin draws on while the screen is taller than wide. `tallStage` is the built-in one, 480×854 (`wideStage` on its side), with its BGA in a 206 px square at the top left.
- `resolveBeMusicStage(skin, screen, chart?)` picks the stage for a screen; gameplay keeps the landscape stage for charts too wide for portrait (double play, 24 / 48 KEY; see `supportsPortraitLayout`).
- On a portrait stage `resolveGameplayLayout` lays the lanes across the stage's width in its lower part, in both the standard and the touch mode, keeps the BGA above them, and reports `orientation: 'portrait'` on the layout. `resolveGameplayLaneGeometry` takes the stage as an optional fifth argument.
- `BeMusicSurface.orientation` and `BeMusicSelectSkin.portraitLayout` (optional), plus `resolveStageOrientation`, `resolveBeMusicSelectLayout`, `resolvePortraitLaneLayout`, `PORTRAIT_PLAYFIELD`, `TALL_STAGE_WIDTH`, `TALL_STAGE_HEIGHT`, `TALL_STAGE_BGA`, and the `BeMusicStageOrientation` type.
