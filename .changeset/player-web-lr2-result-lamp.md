---
'@be-music/player-web': patch
---

Keep the result screen's clear lamp to the judge ruleset's own lamps: under LR2 and IIDX a full combo is the top lamp (no PERFECT or MAX), and under LR2 a DEATH clear is NORMAL, as LR2 awards HARD only for its HARD-family gauges. `resolveClearLamp` takes the ruleset, and the beatoraja result scene takes `judgeRuleset`. Without a ruleset the lamp keeps beatoraja's full set.
