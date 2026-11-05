---
'@be-music/worker-play': patch
---

The Player Worker serves every response with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`, so the player is cross-origin isolated: key presses are timestamped and recorded in replays more finely (Chromium: 5 µs instead of 100 µs), and the BGA transcode can encode with WebCodecs over `SharedArrayBuffer`.
