---
'@be-music/player': minor
---

Reproduce LR2's negative-BPM reverse-scroll gimmick (#134) in `manualPlay` / `autoPlay`, under every judge ruleset. From the reversal on, LR2's event pump freezes realtime audio (BGM on the reversal tick still plays), presses are judged on the mirrored clock `2R - now` (notes around the reversal stay hittable, empty POORs keep firing for about a second, nothing is swept into a miss past it, and a hold spanning it BADs on release), and a run that ends with scorable notes unjudged is FAILED with the gauge at 0, as LR2 zeroes HP when such a play is left. UI frames carry `displayBeat`, mirrored in chart-position space so the reverse scroll follows the post-reversal tempo, plus `reversalSeconds`; the BPM timeline shows negative values as `|trunc(BPM)|`. Playlogs record `chart.reversalTimeUs` and the simulator applies the same mirrored clock and result, so re-simulations reproduce the live verdicts. Adds `RulesetGauge.drainToZero`.
