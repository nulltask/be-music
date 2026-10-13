---
'@be-music/parser': patch
---

Fix bmson `beat-5k` / `beat-10k` charts loading on the wrong lanes: the scratch was read from `x` 6 (and the `beat-10k` 2P side from `x` 7–12), where the bmson spec and beatoraja put it on `x` 8 (2P keys on `x` 9–13, 2P scratch on `x` 16). Such charts lost their scratch notes and shifted the 2P side. `x` 6 / 7 (14 / 15) now have no lane and play as BGM, as in beatoraja.
