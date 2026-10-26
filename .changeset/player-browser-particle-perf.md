---
'@be-music/player-browser': patch
---

Cut the built-in skins' particle cost: a point writes the particle's packed color directly instead of going through Pixi's `tint` setter (a `Color` parse per point per frame), and a particle layer checks its place among its siblings once per frame instead of on every point. On a dense chart with Synesthesia the frame loop's CPU time drops about 12 %. The built-in play view also prints its `?perf` section summary each second, as the LR2 play view does.
