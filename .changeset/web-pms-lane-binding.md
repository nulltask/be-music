---
'@be-music/player-web': patch
---

Fix PMS charts (`*.pms`) using the IIDX 10-key DP binding instead of the
9-key Pop'n binding, which made lanes 6-9 react to the wrong keys.

`PixiGameplayView` was building its `engineOptions` without forwarding
the chart's filename extension, so the engine's `resolveLaneMode` saw
`options.laneModeExtension === undefined` and fell through to the
content-based heuristics. PMS charts that exercise the `#PLAYER 3` 1P+2P
channel split (`11..15` + `22..25`) but don't include the
`#PLAYER 3 + ch17` co-occurrence the engine uses as a 9-key tell-tale
ended up classified as `'5-key-dp'` (10-key DP) — the 1P side keys
matched (`z s x d c`), but lanes 6-9 picked up the IIDX 2P-side keys
(typically `j k l ;`) instead of the expected `f v g b`.

Forward `laneModeExtension` from `song.chartPath` so the engine can
detect `.pms` and route to `POPN_9KEY_PMS_BINDINGS`. Adds a small
`extractChartExtension` helper that anchors the suffix detection on the
last path segment so `.`-containing directory names don't confuse the
extraction.
