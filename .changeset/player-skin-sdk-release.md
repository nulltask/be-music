---
'@be-music/player-skin-sdk': minor
---

Mark an estimated difficulty, and tell a skin whether a chart has a README.

- Mark an estimated difficulty: `resolveDifficultyName` returns `HYPER?` for one read from the chart's names and `HYPER??` for one from its note count, and the new `resolveDifficulty` returns the name with its `basis`. `DIFFICULTY_BASIS_MARKS` holds the marks.
- The select frame tells a skin whether the chart under the cursor has a README: `BeMusicSelectFrame.hasReadme` for a canvas skin and `BeMusicDOMSelectFrame.hasReadme` for a DOM skin, so a README button can be enabled only then. The host shows the README in its own dialog, so `BeMusicDOMSelectFrame.readText` is removed. `BeMusicSelectActions.toggleReadme` is now declared as a property, like the other actions.
