---
'@be-music/player': minor
---

Decide a play's `#RANDOM` / `#SWITCH` outcomes once, in the host, and hand them to the engine:

- `resolvePlayChart(source, { random, randomDraws })` draws the chart's outcomes once with `drawRandomOutcomes` (`@be-music/chart`), or takes recorded ones, and returns the resolved chart together with those draws (`ResolvedPlayChart`), ready for `PlayerOptions.randomDraws`, the result screen and the play log. It is exported from `@be-music/player` and, apart from the engine's audio and UI start-up, from `@be-music/player/playlog`, so a play-log verifier can rebuild the chart a play was played on without bundling the audio driver.
- `PlayerOptions.randomDraws` are the play's outcomes. Hand `autoPlay` / `manualPlay` a chart already resolved with them and the engine plays it as is, using the draws for the RANDOM summary; hand it a chart that still carries control flow (for example to replay a play log against the source chart) and the engine resolves it exactly once with them.
- The engine no longer rolls `#RANDOM` / `#SWITCH` itself: a chart that still carries control flow without `randomDraws` throws a `TypeError`. Charts without control flow (bmson, plain BMS) are unaffected.
- Fix the engine playing a different `#RANDOM` branch than the one it reported after a line with a single outcome (`#RANDOM 1`, a `#RANDOM` without a valid range, or `#SWITCH 1`): draws are taken only for lines with more than one outcome, so the RANDOM pattern summary always matches the branches that play.

Migration: resolve the chart once with `resolvePlayChart` and pass its `chart` to the engine with `randomDraws` in `PlayerOptions`, so the play, its RANDOM summary and everything else the host shows use the same branches.
