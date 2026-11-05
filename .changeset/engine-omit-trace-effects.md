---
'@be-music/player-engine': patch
---

A play with a UI no longer builds the judge cores' `trace` effects, which only the terminal log writes and a UI play discarded on every judgment. The manual and AUTO judge configs take a new optional `omitTraceEffects`; absent, traces are emitted as before.
