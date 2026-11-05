---
'@be-music/worker-play': patch
---

Serve the player cross-origin isolated and sign in with Accounts on the Dashboard host.

- The Player Worker serves every response with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`, so the player is cross-origin isolated: key presses are timestamped and recorded in replays more finely (Chromium: 5 µs instead of 100 µs), and the BGA transcode can encode with WebCodecs over `SharedArrayBuffer`.
- The preview Worker serves the player page and its web app manifest as "Be-Music Play (Preview)", so an installed preview player's window tells itself apart from production.
- Play signs in with the Accounts issuer on the Dashboard host (`https://be-music.app/api/auth`), where Accounts now runs.
