---
'@be-music/chart-writer': patch
---

Converting a BMS chart to bmson rounded every object to a fixed 240 pulses per beat, so off-grid notes, BPM changes and BGA cues moved, by up to 400 ms on extreme-BPM gimmick charts. Without a `resolution` option, `stringifyBmson` now picks the least multiple of 240 at which every position and measure boundary lands on a whole pulse, capped at 61,440 (positions past the cap round to it, under 0.5 / 61,440 beat). A bmson source and an explicit `resolution` keep their resolution.
