---
'@be-music/player': minor
---

Replaying a play log of a `#RANDOM` / `#SWITCH` chart through `manualPlay` drew new values, so the replay could play different branches than the recorded run. The new `PlayerOptions.replayRandomOutcomes` takes the log's `play.randomOutcomes` and resolves the chart's control flow with them, so the replay plays the recorded branches; without it the values are drawn as before. `resolveBmsControlFlowForPlayback` accepts the preset values as an optional third argument.
