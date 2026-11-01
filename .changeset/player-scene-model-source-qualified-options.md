---
'@be-music/player-scene-model': minor
---

The lane options offer RANDOM, S-RANDOM and CONVERGE once per source under every judge ruleset (`lr2:RANDOM`, `beatoraja:RANDOM`, `____:RANDOM`, ...), with the ruleset's own first, and BATTLE as `beatoraja:BATTLE` and `____:BATTLE` (ADR 0019). `RANDOM_CYCLE` holds LR2's own RANDOM and S-RANDOM. The new `isRandomModeChoice` accepts these and the bare names older settings hold, which `resolvePlayOptionValue` and `resolvePlayOptions` keep as the ruleset's own.
