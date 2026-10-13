---
'@be-music/player-tui': patch
---

Stop drawing notes far ahead in charts that scroll both ways: the grid ends where the chart first runs past its top, as beatoraja's `LaneRenderer` does, so notes a later negative `#SCROLL` brings back no longer show early.
