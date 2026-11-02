---
'@be-music/app-play': patch
---

The Debug Menu offers play options under every judge ruleset instead of only their source's:

- Every lane and battle option, grouped by source with the ruleset's own first: RANDOM, S-RANDOM and CONVERGE once per source (RANDOM (LR2), RANDOM (beatoraja), ...), BATTLE (LR2) two-player play also under beatoraja rules, and BATTLE (beatoraja) and BATTLE (????) apart. Saved settings with a bare RANDOM, S-RANDOM, CONVERGE or BATTLE are read as the qualified value of the ruleset they were saved with.
- ADD LN / CN / HCN / ALL and their add rate.
- Seed 1P / 2P, since every lane option is now seeded.
- PRACTICE: GAUGE TYPE lists the ruleset's own gauges, GAUGE CATEGORY shows under beatoraja only, and JUDGERANK and TOTAL hide under AC.
- Gauge auto-shift, whose lowest gauge reads as the ruleset's gauges (EASY or GROOVE under LR2).

The Leaderboard status line names the rulesets that judged a play only up to its failure or could not judge it at all.
