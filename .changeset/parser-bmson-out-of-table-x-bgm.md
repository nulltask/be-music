---
'@be-music/parser': patch
---

Fix a bmson note whose `x` is outside the `mode_hint` lane table (for example `x` 9 under `beat-7k`, or `x` 4 under `generic-3keys`) landing on lane 1 as an extra playable note: it is now a BGM note, so its sound plays without a lane note, as in beatoraja.
