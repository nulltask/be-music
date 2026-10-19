---
'@be-music/player-web': patch
---

Play log and replay fixes:

- Play logs recorded in the browser lacked `chart.chartFingerprint`, and a beatoraja play's `chart.playFingerprint` changed with DP FLIP, because both were computed from the play's working copy of the chart. They now come from the library chart.
- The play log's `visibleMs` depended on the family on gimmick charts, as the built-in and LR2 screens took the BPM held longest and the beatoraja screen counted mines and every long-note end. Every family now takes it at one main BPM, the BPM the most judged notes sit at (`resolveChartMainBPM` of `@be-music/chart`), which HS-FIX `AVERAGE`, the built-in HUD's `mainBPM` and the beatoraja skins' main BPM (number 92), white and green numbers and BPM graph read too. An older log of such a chart may scroll at a slightly different hi-speed when replayed on another family's scale.
- Leaving a play with ESC or F5 on the built-in and LR2 screens did not stop the engine: it played on to the chart's end, and the play log arrived only then. The play is now interrupted and recorded at once (`play.aborted`), and `PlayScene.waitForPlaylog()` waits for that log.
- A replay of a play given up with ESC played on past where it was given up; it now stops there (`play.abortedAtUs`) with the recorded result.
- A replay restores the recorded `play.endOnFailure` and `play.course`, so a course stage replays on its course gauge from its recorded state, while a log recorded before plays ended on failure still replays to the chart's end.
- Touch taps recorded their release before their press, so a replay held a tapped lane down after the tap (its mines went off, a long note tapped that way was held on). The engine now never stamps an input before the one drained ahead of it.
- The web input runtime declares that it reports key releases, so the engine judges a browser play as key-state input from its first press instead of passing that press through the inference meant for terminals without releases.
