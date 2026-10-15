---
'@be-music/player': patch
---

Fix a second key pressing a lane whose long note is held (such as the turntable's other direction) judging the lane's next note and dropping the held note's judgment: the lane's current note is the long note, so the press now follows the ruleset's new `pressDuringLongNote` rule instead — LR2 judges the LN head again inside its BAD window and charges an empty POOR otherwise, beatoraja and IIDX ignore it — in both the engine and the play-log simulator.
