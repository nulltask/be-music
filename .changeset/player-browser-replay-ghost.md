---
'@be-music/player-browser': minor
---

A play can show a replay ghost: `PlaySceneSettings.ghost` takes a `GhostSource` (exported from `@be-music/player-browser/host`, with an optional `label` the pacemaker is named after), and `PlaySceneSettings.ghostMode` (`GhostPresentationMode`) picks how it shows:

- `'side-playfield'` (the default): the built-in play view replays it as a second playfield on the 2P side of a 5 / 7 KEY single-play chart, laid out like a double-play chart, with its own notes, key beams, bombs, judgment plate and score.
- `'pacemaker'`: the frame's `scoreTargets` carry the ghost's EX score once it had judged as many notes as the play has (`targetEXScore`, `targetPaceEXScore`, `targetLabel`), which the built-in score graph, the LR2 target numbers and bar graphs (151 / 153, 14 / 15) and the beatoraja target numbers (121-123) read, so it runs on every family and any chart.
- `'lane-overlay'`: the pacemaker plus the ghost's recorded key presses and judgments over the play's own lanes on the built-in view, drawn as outlines in a colour of their own.

The ghost only draws: it plays no sound, takes no input, and leaves the play's judging, records and replay alone. It is left out of replays, course stages and NONSTOP runs.
