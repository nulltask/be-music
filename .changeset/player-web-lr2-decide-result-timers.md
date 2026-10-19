---
'@be-music/player-web': patch
---

The LR2 decide and result views read their timers from `@be-music/lr2-skin/state` (`resolveLr2DecideTimers`, `resolveLr2ResultTimers`, `resolveLr2GraphReveal`) instead of working them out themselves. The screens behave as before.
