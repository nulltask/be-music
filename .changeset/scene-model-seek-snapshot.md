---
'@be-music/player-scene-model': minor
---

`reducePlayState` takes a `seek` event with the engine's `PlaySeekSnapshot`: the play state becomes the one the engine rebuilt at the second sought, its graphs, timings, early / late counts, gauge, EX score, combo and max combo included, so a play that seeks reads as one that judged the same notes live. A frame's `combo`, `maxCombo` and course combo, when it carries them, are the engine's own and win over what the judgments counted.
