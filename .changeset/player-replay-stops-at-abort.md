---
'@be-music/player': minor
---

A replay of an ESC-aborted play log played on past the abort and missed every note after it, while the re-simulations stop there: add `PlayerOptions.replayAbortedAtUs` (the log's `play.abortedAtUs`). A replay given it judges up to that chart time and ends there as an ESC, with the live play's result and a re-recorded log that is aborted at the same instant.
