---
'@be-music/player-engine': minor
---

PRACTICE can now play on another source's gauge under any judge ruleset. `PlayPractice.gauge` takes a source-qualified pick such as `beatoraja:ASSIST-EASY` under LR2 rules, which plays on that source's PRACTICE gauge and TOTAL reading with the judge ruleset's windows, as a qualified gauge pick does (ADR 0019). `splitPracticeGaugePick`, `isPracticeGaugePick` and `qualifyPracticeGaugePick` are exported.
