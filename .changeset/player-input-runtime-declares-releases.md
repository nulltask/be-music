---
'@be-music/player': minor
---

Add `PlayerInputRuntime.reportsKeyReleases`: an input runtime can declare before the play that its input reports key releases, and a manual play then judges it as key-state input from its first key. Until now the engine found that out only when the first `kitty-state` command arrived, so the first press of every play went through the key-state inference meant for terminals without the kitty keyboard protocol. A runtime that leaves it out (or sets `false`) is detected as before.
