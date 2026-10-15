---
'@be-music/player-web': minor
---

Add `waitForPlaylog()` to the core gameplay scene. A host leaving a play with Escape gets the play log the engine records a moment after `onExit` fires (with `play.aborted`), so a course given up mid-stage can keep that stage.
