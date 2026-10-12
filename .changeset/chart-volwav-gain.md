---
'@be-music/chart': minor
---

Add `volWavToLinearGain`, which maps a BMS `#VOLWAV` value to the chart-wide linear gain: `n / 100` for `0 < n < 200` and unity otherwise, the range beatoraja applies.
