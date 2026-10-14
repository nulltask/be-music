---
'@be-music/leaderboard-api': patch
---

The chart page no longer shows an LN mode for charts without long notes, where it only misled. Charts now keep whether a play of them had long notes (migration `0008_chart_long_notes`); a later play with long notes sets it, as `#RANDOM` outcomes can differ. Charts registered before keep showing the LN mode until their next play tells.
