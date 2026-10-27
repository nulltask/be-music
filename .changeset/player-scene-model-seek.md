---
'@be-music/player-scene-model': minor
---

`reducePlayState` takes a `seek` event with the engine's `PlaySeekSnapshot`: the play state becomes the one the engine rebuilt at the second sought (graphs, timings, early / late counts, gauge, EX score, combo and max combo), so a play that seeks reads as one that judged the same notes live, and a frame's own `combo`, `maxCombo` and course combo win over what the judgments counted. `ReplayViewCursor.seek(timeUs)` returns the recorded view at a seek target, even within the previous change interval, so hosts can reapply it.
Play results carry a `practice` flag and omit replay data when they are practice, and live course-stage outcomes are carried apart from replays so a practice course builds its result without a course replay.
