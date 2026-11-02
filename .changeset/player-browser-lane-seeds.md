---
'@be-music/player-browser': patch
---

LR2 and AC lane options, and every lane option outside beatoraja rules, now draw from the side's seed instead of `Math.random`, so the recorded `randomSeed1P` / `randomSeed2P` reproduce the arrangement under every judge ruleset; a chart's own ALL / ALL+ shuffle draws from the 1P seed. LR2 skins' RANDOM buttons step only through LR2's own lane options (OFF, MIRROR, RANDOM, S-RANDOM, SCATTER, CONVERGE), as ADR 0019 has each skin cycle its own source's values.
