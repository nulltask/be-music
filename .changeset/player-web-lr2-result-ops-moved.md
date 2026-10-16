---
'@be-music/player-web': minor
---

`computeResultOps` is no longer exported: the LR2 result scene resolves its ops, numbers and texts with `resolveLr2ResultState` from `@be-music/lr2-skin/state`, which takes the result, the course, the played skin's `#FLIPRESULT` and the result skin's custom options instead of a skin. The LR2 scenes behave as before.
