---
'@be-music/player-ui': minor
---

Add playfield components that each draw on a canvas the size of their part of the stage: `be-music-lanes`, `be-music-notes` (with mines and measure lines), `be-music-lane-covers`, `be-music-judge-line`, `be-music-bombs` and `be-music-judgment-display`, placed on the letterboxed stage by `be-music-playfield`. Export `resolvePlayfieldParts`, `paintPlayfieldParts` and the `BeMusicPlayfieldCanvasElement` base class, and show a paused indicator in the gameplay HUD.
