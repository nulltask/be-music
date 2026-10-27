---
'@be-music/player-ui': patch
---

Fix the preview screens' buttons under the Basecoat theme, whose fixed button heights cut their content:

- Chart and course rows in `be-music-preview-select` grow with their artwork and text instead of overlapping the next row, and the list keeps its padding when the page resets every element's padding.
- `#STAGEFILE` and `#BANNER` pictures keep their own aspect ratio instead of a 16:9 box.
- On a narrow list a long genre wraps under the title instead of squeezing it out, and the scrollbar no longer covers the level.
- The large Play button of `be-music-preview-start` and the paused play's centred resume button of `be-music-preview-hud` fit their icons.
