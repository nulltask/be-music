---
'@be-music/player-browser': minor
---

A play can change drawing family without starting again. `PlayScene.replaceFamily` attaches the new family's view to the running play and disposes the previous view. LR2 textures stay cached until the play ends, so switching back does not decode the same bytes again.
