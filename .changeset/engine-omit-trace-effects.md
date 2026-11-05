---
'@be-music/player-engine': patch
---

A play with a UI no longer builds the judge cores' `trace` effects, which only the terminal log writes and a UI play discarded on every judgment. The manual and AUTO judge configs take a new optional `omitTraceEffects`; absent, traces are emitted as before.

A key press also allocates less: the re-press set and held long-note list are built only when a long note is held, the LR2 re-judge chain is called directly instead of through a closure, the judge-reach bounds no longer build an array per press, and old lane-hold spans are pruned in place instead of with `splice`.
