---
'@be-music/chart-model': minor
---

Give each sample trigger its own playback: `TimedSampleTrigger` gains `sampleGain`, `samplePan`, `samplePlaybackRate`, `sampleAttackSeconds` and `sampleReleaseSeconds`, and an LRX note fills them and its window (`sampleOffsetSeconds` / `sampleDurationSeconds`) from its `vol`, `pan`, `frq`, `atk`, `rls`, `ost` and `len`, stretching the times by plugout's integer `44100 / frq` factor.
