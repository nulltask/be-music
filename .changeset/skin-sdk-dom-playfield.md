---
'@be-music/player-skin-sdk': minor
---

Let a DOM gameplay screen draw the playfield: a skin that sets `gameplay.drawsOnDOM` receives every `BeMusicGameplayFrame` through the screen's `drawPlayfield(frame)` (`BeMusicDOMGameplayScreen`) and needs no Canvas surface for gameplay. Validation reports `drawsOnDOM` without a `dom.gameplay` screen.
