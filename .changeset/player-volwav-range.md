---
'@be-music/player': patch
---

Fix `#VOLWAV 0` muting a chart and `#VOLWAV 200` or above amplifying it: `resolveChartVolWavGain` now applies `#VOLWAV` only for `0 < n < 200` and plays other values at the original volume, as beatoraja does (LR2 ignores `#VOLWAV`).
