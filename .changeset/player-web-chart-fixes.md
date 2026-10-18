---
'@be-music/player-web': patch
---

Chart handling fixes:

- The song list's note count disagreed with the play: it counted a FREE ZONE (channel `17` / `27` of a 5 / 7 / 10 / 14 KEY chart), which nobody judges, and read the lane mode without the chart's extension. It now matches the notes the engine scores.
- `#VOLWAV 0` muted a chart and `#VOLWAV 200` or above amplified it; `#VOLWAV` now applies only for `0 < n < 200`, as in beatoraja.
