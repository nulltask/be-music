---
'@be-music/parser': patch
---

Fix bmson charts with more than 1,295 BPM or STOP changes, or more than 1,295 sound channels, playing the wrong tempos, stops and samples: each event got its own 2-char key, which wrapped round after `ZZ` and overwrote earlier values (a gimmick chart's first STOP lasted 39 minutes instead of 1.1 seconds). BPM and STOP values now share one key per distinct value, and a chart that still needs more than 1,295 keys in one table switches to base-62 keys (`bms.base = 62`).
