---
'@be-music/player-web': patch
---

beatoraja play skin fixes:

- A beatoraja play applied no lane option, started every lane cover off and ignored the cover settings: RANDOM, MIRROR, S-RANDOM and SCATTER played the chart as written and the play log recorded `OFF`. It now plays the host's `random1P` / `random2P` and starts the covers from `hiddenSudden1P` / `hiddenSudden2P`, `shutter` and `laneCover`, as every family does, and the play log records them.
- On a DP chart, H, J and K played a 2P lane and moved HIDDEN+ at the same time. A cover key that one of the play's lanes takes now plays only the lane; Page Up / Page Down, Home / End, the wheel and the skin's cover buttons still move the covers.
- A skin's looping Lua sound (`main_state.audio_loop`) went on over the result and select screens; the play's skin sounds now stop as it leaves the stage.
- The TOTAL readout (ref 368) shows the effective TOTAL the gauge runs on, as beatoraja does after `BMSPlayerRule.validate`: a bmson `total` is a percentage of the ruleset default and a BMS chart without `#TOTAL` shows its default. The result screen always showed 0.
- Ops 230-240 lit the EX score's tenth and 1240 stayed lit from 80 % of the EX score (#430). They now follow the gauge, as in beatoraja and LR2: 230-240 light the 1P gauge's tenth (240 a full gauge), and 1240 is lit while the gauge would clear.
- Number 101 (`SCORE2`) showed the displayed score, the same as 100; it is now the EX score (#430). The score rates follow beatoraja's `ScoreDataProperty`: during a play 102 / 103 are the EX score over the notes judged so far and 115 / 116 over every note, a result draws both over every note, and each is truncated to hundredths of a percent, so an exact 57 % no longer draws as 56.99.
- The timing visualizer and distribution graph drew late judgments on the right and the visualizer's bands showed LR2's judge windows on every play. Early judgments now sit right of the centre, as beatoraja draws them, and the bands show the play's own judge windows with their early and late sides apart.
- A note lane layout gated by an op, such as the lift, now switches when the op changes mid-play; the note layer kept the lane rects of the first op set it saw.
- Samples whose `#WAV` path has `./`, `..` or doubled slashes stayed silent, as they were cached under a key that only lower-cased the path; they now share the audio session's key.
