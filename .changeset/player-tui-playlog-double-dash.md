---
'@be-music/player-tui': patch
---

Fix `bms-playlog` rejecting `--` with "unknown option '--'", which broke `pnpm playlog -- <file>`. `--` now ends the options, and every argument after it is read as a file.
