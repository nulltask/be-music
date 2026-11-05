---
'@be-music/player-scene-model': minor
---

An AUTO play's result was indistinguishable from a manual play's. `PlayResult` now carries `autoPlay` for a full AUTO play (a course run takes it from its stages' replays), and the new `isAutoPlayResult` reads it, falling back to the recorded replay's mode.
