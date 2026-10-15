---
'@be-music/player': patch
---

Fix the engine's recorded result and the play-log simulators reporting the same play differently: the native result now counts `noteCount` as the ruleset's judgments (charge notes twice) instead of note objects, always carries `djLevel`, carries `score` only under LR2's money score instead of repeating the EX-SCORE, and flags `gauge.failedMidPlay`; the simulators no longer round `gauge.final` to 0.01 (which could read 80 while uncleared), count a zero delta as neither FAST nor SLOW, and apply a mine's damage even when it is 0, as the engine does.
