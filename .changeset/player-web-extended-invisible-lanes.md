---
'@be-music/player-web': patch
---

Fix the select-screen chart preview sounding invisible objects on the extended 24 / 48 KEY lanes (`3A`-`3Q` / `4A`-`4Q`), which bmson `keyboard-24k` hidden notes use: only `31`-`39` / `41`-`49` were kept silent.
