---
'@be-music/player-browser': patch
---

The playfield no longer stutters on the audio clock's steps: `AudioContext.currentTime` moves a render callback at a time (5.8 ms at 44.1 kHz in Chromium on macOS), so each display frame drew the notes 0, 1 or 2 steps on, up to 5.6 ms of chart time off. The play session now draws on the audio clock smoothed against `performance.now()` over the last second, which moves the notes by each frame's own time (within 0.1 ms in a measured run) and stays within half a step of `currentTime`. Judging and the sounds still run on the raw audio clock.
