---
'@be-music/player': patch
---

Fix play logs recording a different gauge than the play ran on: the engine judged with `PlayerOptions.gauge` but the log took `recordPlaylog.gauge`, so a host that set only the latter (the web beatoraja scenes) played GROOVE while the log claimed the picked gauge, and re-simulations scored the wrong gauge. The engine now resolves one gauge, `gauge` falling back to `recordPlaylog.gauge`, and both plays and records it.
