---
'@be-music/player-web': patch
---

Leaving a play with ESC (or F5) on the built-in and LR2 scenes did not stop the engine: it played on to the chart's end, so the play log a course needs for the stage given up arrived only when the chart happened to end within a moment, and a course given up mid-stage could drop that stage or the whole run. The scene now interrupts the engine, as the beatoraja scene does, so the given-up play is recorded at once (`play.aborted`); a play whose chart already settled ends as a complete one.
