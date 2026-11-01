---
'@be-music/player-browser': minor
---

A play can show a replay ghost: `PlaySceneSettings.ghost` takes a `GhostSource` (exported from `@be-music/player-browser/host`), whose replay the built-in play view replays as a second playfield on the 2P side of a 5 / 7 KEY single-play chart, laid out like a double-play chart, with its own notes, key beams, bombs, judgment plate and score. The ghost only draws: it plays no sound, takes no input, and leaves the play's judging, records and replay alone. It is left out of replays, course stages, NONSTOP runs and charts without a free side.
