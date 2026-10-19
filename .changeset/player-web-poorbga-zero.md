---
'@be-music/player-web': patch
---

A chart with `#POORBGA 0` (or any `#POORBGA` value) showed no POOR image on a miss before its first `#xxx06` cue, though it had a `#BMP00`. `#BMP00` is now the POOR image unless `#POORBGA` is `2`, which hitkey's command memo defines as "never show a POOR image"; `0`, `1`, a value that does not parse and an out-of-range one keep it, as LR2 always does.
