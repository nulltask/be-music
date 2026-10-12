---
'@be-music/skin-sdk': patch
---

The song facts (`resolveSongStats`: length, BPM range, long notes, mines, stops) now come from the resolved chart (`resolveChart` in `@be-music/chart`), the same rules the player plays by, and the package no longer depends on `@be-music/audio-renderer`.
