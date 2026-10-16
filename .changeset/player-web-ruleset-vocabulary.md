---
'@be-music/player-web': minor
---

Lamp plays and speak of gauges through `@be-music/player/ruleset`, the vocabulary the player, the skins and the Leaderboard share, instead of copies of it. Migration:

- `resolveClearLamp` is no longer exported from `@be-music/player-web/scenes`: import it from `@be-music/player/ruleset`, where its gauge id is named `gauge` instead of `gaugeType`.
- `PixiGaugeType` is removed: use `GaugeType` from `@be-music/player/ruleset` (or `BeMusicGaugeType`).
- `beatorajaClearLampOp` takes a `ClearLamp`.
