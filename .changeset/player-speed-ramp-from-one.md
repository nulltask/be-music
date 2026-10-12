---
'@be-music/player': patch
---

`#SPEEDxx` before the first `SP` keyframe now ramps from 1.0 at beat 0 to that keyframe's value, as beatoraja ramps from 1.0 at time 0, instead of holding the first value (Bemuse's reading). Charts authored for beatoraja that open with a `SPEED` change now space their opening notes the way their authors saw them. A keyframe on beat 0 still applies at once.
