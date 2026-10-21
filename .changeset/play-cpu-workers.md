---
'@be-music/app-play': patch
---

Keep CPU-heavy chart, archive, audio, and submission preparation off the main thread. Add a persistent Debug Panel CPU worker setting, defaulting to half the browser-reported logical CPU count, rounded down with a minimum of one.
