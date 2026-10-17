---
'@be-music/player': patch
---

A manual play started its input runtime only once the lead-in was over, so keys pressed during it (ESC included) never reached the engine: it now starts it before the lead-in, as AUTO play does.
