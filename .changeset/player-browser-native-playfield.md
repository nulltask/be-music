---
'@be-music/player-browser': patch
---

Native no longer covers the stage with a full-size Canvas surface during gameplay: its lanes, notes, mines, measure lines, lane covers, judge line, bombs and judgment words are components that each draw on a canvas the size of their part of the stage, and its DOM screens fade with the play screen. The host hands each frame to a skin that sets `gameplay.drawsOnDOM` and creates no gameplay surface for it.
