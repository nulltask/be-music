---
'@be-music/player': minor
---

Stop where an ESC-aborted play stopped: re-simulations of such a play log, and its replays, judged every note left in the chart as missed, while the live result stopped judging at the abort.

- The play log records `play.abortedAtUs`, the chart time the judge had settled through, in manual and AUTO play alike (a replay's ESC records the chart time it had been driven through), and `simulatePlaylog` stops there. Logs without it keep the previous behaviour.
- `PlayerOptions.replayAbortedAtUs` (the log's `play.abortedAtUs`) makes a replay judge up to that chart time and end there as an ESC, with the live play's result and a re-recorded log that is aborted at the same instant.
