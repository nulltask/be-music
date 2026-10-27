---
'@be-music/player-skin-sdk': minor
---

Allow `BeMusicSkin` to mount native DOM select, decide and result screens and a DOM gameplay screen alongside Canvas surfaces, with DOM frame, action and lifecycle contracts and validated screen factories. DOM gameplay frames carry the stage geometry (playfield bounds per input layout, and the BGA rect in `layout`) so native HUDs can avoid the lanes, and DOM skins get the shared gameplay HUD runtime, play options, course context and full immutable play state.
A skin that sets `gameplay.drawsOnDOM` draws the playfield in its DOM gameplay screen: it receives every `BeMusicGameplayFrame` through the screen's `drawPlayfield(frame)` (`BeMusicDOMGameplayScreen`) and needs no Canvas surface for gameplay. Validation reports `drawsOnDOM` without a `dom.gameplay` screen.
DOM gameplay screens can seek through `BeMusicDOMGameplayActions.seek(seconds)` and `BeMusicDOMGameplayFrame.seekable`.
