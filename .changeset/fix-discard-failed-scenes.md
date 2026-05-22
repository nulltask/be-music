---
'@be-music/player-web': patch
---

Discard scenes whose `enter()` throws (e.g. a skin failed to prepare, or an audio dependency rejected) instead of leaving them attached to the shared `PixiSceneHost`. Subsequent mounts no longer inherit half-initialized state from the failed predecessor.
