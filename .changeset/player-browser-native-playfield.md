---
'@be-music/player-browser': patch
---

Native no longer places a stage-sized canvas: its BGA, lanes, notes, mines, measure lines, lane covers, judge line, bombs and judgment words are components that each draw on a canvas the size of their part of the stage, and its DOM screens fade with the play screen. The host hands each frame to a skin that sets `gameplay.drawsOnDOM` and creates no gameplay surface for it. A scene whose screens are all DOM reports `drawsOnCanvas: false`, and `PixiSceneHost` takes its canvas out of the page while it is active; touch lanes follow the fingers on the native gameplay screen instead.
