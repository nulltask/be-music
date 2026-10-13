---
'@be-music/player-web': patch
---

Peg HS-FIX `AVERAGE` (and `CONSTANT`, which falls back to it) to the chart's main BPM, the BPM the most notes sit at, as beatoraja's `MAINBPM` does. The time-weighted average it used was skewed by BPM × N + STOP gimmicks (about 810 on a 145 BPM chart, so notes scrolled 5.6 times too slow) and measured its last segment on a clock that counted STOPs while the other segments did not.
