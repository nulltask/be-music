---
'@be-music/play': minor
---

The Player Worker moves out of `@be-music/player-web-demo` into its own package and is renamed `play` (`play.be-music.app`) and `play-preview` (`play.preview.be-music.app`). It serves the demo's build, streams the ffmpeg core from R2 and forwards the Leaderboard's API as before, and deploys with `cf deploy`.
