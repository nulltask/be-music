---
'@be-music/chart-writer': minor
---

`stringifyBmson` now reports the BMS directives bmson has no field for through `onDiagnostic`: `stp` (`#STP` stops), `exrank` (`#EXRANKxx` changes) and `speed` (`SPEED` changes). `stringifyBMS` reports the bmson fields BMS has no form for: `ln-end-sound` (beatoraja's `up`) and `sound-continuation` (`c`). Each message carries the count. The output is unchanged.
