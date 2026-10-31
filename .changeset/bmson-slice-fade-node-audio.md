---
'@be-music/player-node-audio': patch
---

Fix clicks at bmson sound-slice boundaries in Node playback: a slice that starts inside its file fades in over 1 ms, and one cut before the file's end rings on past its end while it fades out over 1 ms, so a continuation crossfades with the slice before it. Note timing and slice deduplication are unchanged.
