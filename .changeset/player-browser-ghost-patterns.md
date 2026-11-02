---
'@be-music/player-browser': minor
---

A replay ghost can show as a pacemaker: `PlaySceneSettings.ghostMode` takes `'side-playfield'` (the default second playfield), `'pacemaker'` or `'lane-overlay'` (exported as `GhostPresentationMode` from `@be-music/player-browser/host`). The pacemaker stands at the ghost's EX score once it had judged as many notes as the play has; the frame's `scoreTargets` carry it as `targetEXScore`, `targetPaceEXScore` and `targetLabel`, which the built-in skins' score graph, the LR2 target numbers and bar graphs (151 / 153, 14 / 15) and the beatoraja target numbers (121-123) read, so it runs on every family and any chart. `'lane-overlay'` adds the ghost's recorded key presses and judgments over the play's own lanes on the built-in view, drawn as outlines in a colour of their own. A `GhostSource` can carry a `label` the pacemaker is named after.
