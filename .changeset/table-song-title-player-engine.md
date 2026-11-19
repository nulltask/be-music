---
'@be-music/player-engine': patch
---

A difficulty table's course read from `md5` now takes its stages' titles from the header's `song_title` (an extension some tables such as Stardust add) instead of the `course N` placeholder, so a stage that is not in the library shows its song.
