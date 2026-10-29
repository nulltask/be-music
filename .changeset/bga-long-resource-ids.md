---
'@be-music/chart-model': minor
---

Add an optional `allowLongKeys` argument to `parseBmsBGA` so internal mixed-NONSTOP bmson resource references can exceed two characters without truncation. Ordinary BMS parsing keeps its existing two-character normalization.
