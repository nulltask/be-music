---
'@be-music/audio-renderer': minor
---

Render LR2's negative-BPM reversal (#134): a negative `#BPMxx` now plays at `Math.abs(bpm)` instead of being dropped, and `renderJson` leaves out the triggers LR2's frozen event pump never fires (everything behind the reversal, and on its tick all but BGM / BPM / BGA). Re-export `mirrorBeatAtTempoReversal`, `firesBeforeTempoReversal` and `TempoReversalPoint` from `@be-music/chart` alongside the timing resolver, whose `reversal` and `displayBpmAtBeat` come from there.
