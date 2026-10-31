---
'@be-music/player-browser': patch
---

Fix clicks at bmson sound-slice boundaries in browser playback: a slice that starts inside its file, or a sound resumed partway after a seek, fades in over 3 ms on its own gain node, and a slice cut before the file's end rings on past its end while it fades out over 3 ms, so a continuation crossfades with the slice before it. Note timing and slice deduplication are unchanged.
