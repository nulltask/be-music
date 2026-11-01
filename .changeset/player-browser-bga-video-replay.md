---
'@be-music/player-browser': patch
---

A video BGA whose first play() was interrupted stayed paused on the black canvas, so the monitor went dark instead of showing the movie or SOUND ONLY. Later frames now call play() again until the video is actually playing.
