---
'@be-music/player-web': patch
---

A replay of a run given up with ESC played on past where it was given up and missed the rest of the chart: the core gameplay scene now passes the log's `play.abortedAtUs` to the engine (`replayAbortedAtUs`), so the replay stops there with the recorded result, as its re-simulations do.
