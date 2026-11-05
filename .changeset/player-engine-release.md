---
'@be-music/player-engine': patch
---

Allocate less in the judge loop and on each key press.

- The judge loop allocates far less per frame: it no longer builds empty due lists, sorts empty long-note and HCN maps, or allocates AUTO SCRATCH closures on frames where nothing falls due. Play notes and mines now carry every field from creation in one order (absent fields are `undefined`), and the head-only long-note modifier clears tails by assignment instead of `delete`, so V8 keeps them in one hidden class instead of dictionary mode.
- A play with a UI no longer builds the judge cores' `trace` effects, which only the terminal log writes and a UI play discarded on every judgment. The manual and AUTO judge configs take a new optional `omitTraceEffects`; absent, traces are emitted as before. A key press also allocates less: the re-press set and held long-note list are built only when a long note is held, the LR2 re-judge chain is called directly instead of through a closure, the judge-reach bounds no longer build an array per press, and old lane-hold spans are pruned in place instead of with `splice`.
