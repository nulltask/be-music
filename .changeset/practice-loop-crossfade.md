---
'@be-music/player-browser': minor
---

A PRACTICE play now fades in as it starts and crossfades each time its loop goes back to the start: what still rings at the end fades out over half a second while the next round fades in, instead of the sound cutting off. `createWebAudioSession` takes `seekCrossfadeSeconds` for this.
