---
'@be-music/player': patch
---

Fix the play-log simulator treating channels 16 / 26 as scratch in every lane mode: in the BME-type 9 KEY layout and the 24 / 48 KEY keyboard modes they are keys, so AUTO SCRATCH auto-played them, ignored their inputs and judged them with scratch windows. The simulator now takes the scratch lanes from the play-mode table entry of the recorded lane mode, as the engine does.
