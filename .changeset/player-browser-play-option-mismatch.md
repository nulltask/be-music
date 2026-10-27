---
'@be-music/player-browser': minor
---

A play whose selected options do not fit its chart (beatoraja CONVERGE or playable RANDOM on a non-PMS chart, LR2 SCATTER on a non-9KEY chart, SP TO DP or EXTRA MODE on bmson, ...) now rejects its `prepare` with the new `PlayOptionMismatchError` from `@be-music/player-browser/host`, which names the selected options that convert the chart, instead of an unexplained `RangeError`. Replays, kept arrangements and other load errors reject as before.
