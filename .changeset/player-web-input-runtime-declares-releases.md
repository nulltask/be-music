---
'@be-music/player-web': patch
---

The web input runtime declares that it reports key releases (`reportsKeyReleases`), so the engine judges a browser play as key-state input from its first press instead of passing that press through the inference meant for terminals that report no releases.
