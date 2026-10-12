---
'@be-music/player': minor
---

Add `PlayerOptions.randomDraws`, the `#RANDOM` / `#SWITCH` outcomes of the play (`drawRandomOutcomes` from `@be-music/chart`). Hand `autoPlay` / `manualPlay` a chart already resolved with those draws and the engine plays it as is, using the draws only for the RANDOM summary; hand it a chart that still carries control flow (for example to replay a play log against the source chart) and the engine resolves it exactly once with them. `resolveBmsControlFlowForPlayback` now draws with `drawRandomOutcomes` and resolves with `resolveBmsControlFlowWithDraws` instead of replaying a recorded random sequence into the parser.
