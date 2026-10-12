---
'@be-music/audio-renderer': minor
---

Reproduce LR2's negative-BPM timing (#134): a negative `#BPMxx` referenced through channel 08 was dropped (the previous tempo continued); the timing resolver now integrates it at `Math.abs(bpm)` like LR2 does, so note times stay monotonic, and exposes the first negative event as `TimingResolver.reversal` (`TempoReversalPoint`: `{ beat, seconds }`). `renderJson` drops triggers at or after the reversal, matching LR2's frozen event pump. `#BPMxx 0` and undefined slot references stay dropped.
