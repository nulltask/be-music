---
'@be-music/player-web': minor
---

A play view's `lane` intents now press and release lanes: the session plays them through the engine's input as it plays the keyboard's lane keys. The touch lanes moved from the play session's canvas listeners into the play views, which follow the fingers and send them as `lane` intents. `PlayFrame.playfield` gains `touchLiftCount`, how many times a pause has let every touched lane go, so a view forgets the fingers that were down then. Touch play behaves as before.
