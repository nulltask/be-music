---
'@be-music/player-web': patch
---

Bound the zip-archive decode path's working memory so opening a multi-gigabyte chart pack no longer materializes every entry in RAM at once. Entries are now streamed through the song-collection loader and released as soon as their files are handed off.
