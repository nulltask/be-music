---
'@be-music/skin-sdk': minor
---

Add `listScroll` to the select frame and `selectListRows(frame, rowHeight)`, so a select skin's list can follow the finger. `listScroll` is how far the list is pulled toward later entries, in design pixels and under one row, while it is dragged, glides after a swipe or is mid-trackpad-scroll. `selectListRows` lays out the rows at fractional slots and fades the ones sliding past the window's edge. At rest it returns exactly the window, so skins that switch to it look the same until the list moves.
