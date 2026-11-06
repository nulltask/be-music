---
'@be-music/player-skin-sdk': minor
---

The select frame tells a skin whether the chart under the cursor has a README: `BeMusicSelectFrame.hasReadme` for a canvas skin and `BeMusicDOMSelectFrame.hasReadme` for a DOM skin, so a README button can be enabled only then. The host shows the README in its own dialog, so `BeMusicDOMSelectFrame.readText` is removed. `BeMusicSelectActions.toggleReadme` is now declared as a property, like the other actions.
