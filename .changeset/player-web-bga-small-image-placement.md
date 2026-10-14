---
'@be-music/player-web': patch
---

Place BGA images smaller than 256x256 the way LR2 and beatoraja do: an image whose long edge fits the 256x256 BMS canvas keeps its pixel size on it, centered horizontally and top-aligned, instead of being stretched over the whole BGA rect (e.g. 256x161 frames no longer look squashed). A base or POOR image leaves the rest of the canvas black, so a 1x1 black BMP blanks the BGA again, and a `#BGAxx` sub-region is drawn at its authored `dx dy`. Larger images and videos still fill the rect.
