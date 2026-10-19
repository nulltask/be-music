---
'@be-music/player': patch
---

The playback event log (`--no-tui`) logged no `#BMP00` POOR image for a chart with any `#POORBGA` value. It now logs `#BMP00` as the POOR image before the first `#xxx06` cue unless `#POORBGA` is `2`, matching the players.
