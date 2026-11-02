---
'@be-music/player-scene-model': minor
---

The lane options offer RANDOM, S-RANDOM and CONVERGE once per source under every judge ruleset (`lr2:RANDOM`, `beatoraja:RANDOM`, `____:RANDOM`, ...), with the ruleset's own first, and BATTLE as `beatoraja:BATTLE` and `____:BATTLE` (ADR 0019). `RANDOM_CYCLE` holds LR2's six own lane options (OFF, MIRROR, `lr2:RANDOM`, `lr2:S-RANDOM`, SCATTER, `lr2:CONVERGE`), so an LR2 skin's RANDOM button draws each on its own cell. The new `isRandomModeChoice` accepts these and the bare names older settings hold, which `resolvePlayOptionValue` and `resolvePlayOptions` keep as the ruleset's own.
