---
'@be-music/player-web': minor
---

Play NONSTOP courses as one stitched chart, as LR2 does. `createNonstopAssets` (`./collection`) builds the asset source a stitched chart loads from, each stage's files found as that stage would find them, and `createPlayScene`'s `nonstop` setting (the stitch map) plays it on every family:

- Each stage's samples play at its FIT rate and its background sound fades at the seams on LR2's curve, through the engine's audio session.
- Each stage keeps its own base, layer and POOR BGA, and the stacks crossfade over 3 s around each seam, as LR2 mixes its stage BGA layers.
- The BPM readouts (LR2's NOWBPM and the built-in HUD) show each stage's BPM times its FIT rate while the scroll stays at 150 BPM, and each stage is judged with its own `#RANK`.
- LR2 skins move the stage ops (280-289) and title text 10 to a stage that follows a BLANK connection, as LR2 announces it, and the select screen names the selected NONSTOP course's connections on texts 171-179.
- beatoraja themes play a NONSTOP run, and its replay, on their own play skin.
