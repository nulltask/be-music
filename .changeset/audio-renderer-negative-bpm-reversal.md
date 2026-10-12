---
'@be-music/audio-renderer': minor
---

Reproduce LR2's negative-BPM timing (#134): a negative `#BPMxx` referenced through channel 08 was dropped (the previous tempo continued); the timing resolver now integrates it at `Math.abs(bpm)` like LR2 does, so note times stay monotonic, and exposes the first value with `trunc(bpm) < 0` as `TimingResolver.reversal` (`TempoReversalPoint`: `{ beat, seconds }`), so `-1 < BPM < 0` only slows the chart down, as in LR2. Tempo points from negative values carry `displayBpm` (`|trunc(bpm)|`, LR2's NOWBPM), read through the new `TimingResolver.displayBpmAtBeat`. New helpers: `mirrorBeatAtTempoReversal` (LR2's chart-position display mirror) and `firesBeforeTempoReversal` (LR2's frozen event pump, with BGM / BPM / BGA on the reversal tick still firing). `renderJson` drops the triggers LR2 never fires. `#BPMxx 0` and undefined slot references stay dropped.
