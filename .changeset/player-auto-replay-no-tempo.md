---
'@be-music/player': patch
---

An AUTO play re-driven as a replay (`replayInputs` set, as for a replay of an AUTO-played log) recorded the speed and the tempo changes it was re-driven at as `play.tempo` / `play.tempoChanges`, which marked its re-recorded log as a practice play: like a manual replay, it now records neither.
