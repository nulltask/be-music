---
'@be-music/app-play': patch
---

Keep bulk chart imports, ZIP expansion, and WSOLA time stretching off the main thread. Add a persistent Debug Panel CPU worker setting, defaulting to half the browser-reported logical CPU count, rounded down with a minimum of one.

Add a persistent Tempo enable switch that bypasses the saved percentage when off, and make WSOLA the default and first keep-pitch algorithm.
