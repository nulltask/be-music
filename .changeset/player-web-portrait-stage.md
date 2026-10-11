---
'@be-music/player-web': minor
---

Be-music skins that declare a `portraitStage` are drawn on it while the screen is taller than wide, on every screen (select, decide, gameplay, result); 5 / 7 / 9 KEY play gets the portrait playfield in both layout modes, and double play and the keyboard modes stay on the landscape stage. Rotating the device re-lays the current screen out on the next frame, mid-play included, and `PixiSceneHost.getStageOrientation()` tells hosts which stage the active screen uses.
