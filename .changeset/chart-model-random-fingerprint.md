---
'@be-music/chart-model': patch
---

`computeChartFingerprint` is faster on `#RANDOM` / `#SWITCH` charts (about 40% on the heaviest, `_random_s4.bms` 118 → 72 ms), with byte-identical fingerprints: outcomes that change only events reuse the notes already resolved for a lane with the same events, the lane buckets merge in order instead of being re-sorted, and the diff against the top-level content finds the shared runs by comparing fields instead of keying every note. Checked against every chart of a 5,537-chart collection and 400 generated control-flow charts.
