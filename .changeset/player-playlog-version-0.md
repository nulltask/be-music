---
'@be-music/player': minor
---

Mark the playlog format as still being defined: `BE_MUSIC_PLAYLOG_VERSION` is now `0`, a development revision that may change incompatibly without the number moving (the first stable one will be `1`). Recorded logs carry `version: 0`; `parsePlaylog` still reads logs stamped `version: 1`, which have the same shape, and returns them as revision `0`.
