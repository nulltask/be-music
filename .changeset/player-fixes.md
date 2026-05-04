---
'@be-music/player': patch
---

- Carry the BMS `#BANNER` into the chart-selection prompt so
  the TUI's per-chart banner cell renders the correct image
  for the highlighted entry instead of falling back to the
  song-level `#STAGEFILE`.
- Resume cleanly after a `Space` pause that overlaps a `#STOP`
  segment. Previously the playhead would freeze for the rest
  of the stop's duration on resume because the stop-clock
  baseline wasn't being rolled forward across the pause.
