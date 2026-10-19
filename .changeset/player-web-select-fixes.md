---
'@be-music/player-web': patch
---

The select screens keep their place:

- When the sort or a filter changes (an LR2 skin's buttons, a be-music skin's play option, or the host's `setPlayOptions`), the cursor stays on the bar it was on, or on the same row, clamped, when the filter takes that bar out. It used to go back to the top of the list.
- A restored place puts the cursor back on the bar it was on even when the list moved under it, brings back the search it was saved with, and restores as far as its folders are still found when one is gone (a library rebuilt by a drop). Backing out of a folder after a restore lands on that folder's bar, where the parent cursors used to be put back on the top.
- The chart preview follows the cursor when a search moves it onto another chart; it kept previewing the chart from before the search.
