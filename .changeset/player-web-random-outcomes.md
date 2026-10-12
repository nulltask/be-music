---
'@be-music/player-web': minor
---

Play logs recorded in the browser now carry `play.randomOutcomes`: both gameplay scenes hand the engine an already-resolved chart, so the engine never drew the `#RANDOM` / `#SWITCH` values itself and the field was always empty. The new `resolvePlayChart` (`@be-music/player-web/chart`) resolves a chart once and returns it together with the values its `#RANDOM` / `#SWITCH` lines were resolved with, and the scenes record exactly those values for the chart they play.

- `prepareBeatorajaGameplayChart` returns `randomOutcomes`, and its `preResolvedChart` option is replaced by `preResolved`, which takes a `resolvePlayChart` result so the chart and its outcomes stay paired.
- `PixiBeatorajaGameplayView` takes the new `randomOutcomes` option and records it in the play log.
- A replay in the core gameplay scene resolves the chart with the log's `play.randomOutcomes`, so it plays the recorded branches instead of rejecting a `#RANDOM` chart whose new draw differs.
