---
'@be-music/player-skin-sdk': minor
---

A stage can be fluid: `BeMusicStage.resize(size)` lets a skin lay its stage out at the screen's aspect ratio instead of being letterboxed into it. `resolveBeMusicStage` resizes a fluid stage to the screen, keeping its 480 px short side, and the new `resolveFluidStageSize` and `resolveFluidStage` expose that sizing. Stages without `resize` keep their fixed size.
