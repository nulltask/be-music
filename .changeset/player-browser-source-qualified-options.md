---
'@be-music/player-browser': patch
---

Play options work under every judge ruleset (ADR 0019):

- A source-qualified RANDOM, S-RANDOM or CONVERGE runs its source's algorithm, and a bare one keeps running the ruleset's own. ADD LN / CN / HCN / ALL and two-player play are prepared instead of failing.
- Every lane option draws from the side's seed instead of `Math.random`, so the recorded `randomSeed1P` / `randomSeed2P` reproduce the arrangement; a chart's own ALL / ALL+ shuffle draws from the 1P seed.
- PRACTICE starts under LR2 and AC rules too: the host passes the practice range and the rules read under the judge ruleset.
- LR2 skins' RANDOM buttons step only through LR2's own lane options (OFF, MIRROR, RANDOM, S-RANDOM, SCATTER, CONVERGE).
- The chart-mismatch dialog names a qualified value's source (`CONVERGE (beatoraja)`), and the Plain and Synesthesia cabinets show a lane option without its source.
