---
'@be-music/chart-parser': minor
---

Read pomu `#SONGxx`, the obsolete name of `#TEXTxx`, into `bms.songText`, including inside `#RANDOM` / `#SWITCH` branches and with base-62 keys. Older Be-Music JSON that kept `#SONGxx` in `metadata.extras` is moved into it on load.
