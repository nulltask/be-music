---
'@be-music/audio-renderer': patch
---

Fix `renderJson` / `renderChartFile` rendering a `#VOLWAV 0` chart silent and amplifying `#VOLWAV 200` or above: `#VOLWAV` now applies only for `0 < n < 200`, as in beatoraja and the player.
