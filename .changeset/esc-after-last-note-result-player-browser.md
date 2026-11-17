---
'@be-music/player-browser': patch
---

ESC after every note of a play is judged now shows the result instead of returning to the select screen, as beatoraja does: what is left of the lead-out is skipped, the fade-out runs, and the play is recorded as complete rather than given up. A second ESC during that fade-out is ignored. The Backspace hold and `requestExit` follow the same rule. In a course the stage finishes and the run goes on instead of being given up; a NONSTOP run finishes this way only after the last note of its last stage; a replay played back finishes the same way.
