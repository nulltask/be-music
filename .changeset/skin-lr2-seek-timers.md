---
'@be-music/skin-lr2': minor
---

`resolveLR2PlayTimers` takes a `seek` moment: it stops the timers the judgments and the lanes started (gauge rise and full gauge, judgements, full combo, the bomb, long-note hold, key-on and key-off banks) and keeps the scene's, running the full-gauge timer again when the gauge is full at the second sought, so a play screen sought to another second no longer shows the judge plates, bombs and lane beams of the old position.
