---
'@be-music/player': minor
---

`autoPlay` / `manualPlay` no longer roll `#RANDOM` / `#SWITCH` themselves. A chart that still carries control flow must come with `PlayerOptions.randomDraws` (the engine then resolves it exactly once with them); without draws the engine throws a `TypeError`. Resolve the chart once with `resolvePlayChart` and pass `{ chart, randomDraws }` instead, so the play, its RANDOM summary and everything else the host shows use the same branches. Charts without control flow (bmson, plain BMS) are unaffected.
