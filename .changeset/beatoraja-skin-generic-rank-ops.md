---
'@be-music/beatoraja-skin': minor
---

The generic rank ops (220-227) lit one rank, the EX score's, so a skin that stacks its rank letters on them (an AAA drawn over AA, A, …) showed only the top one. They now light every rank the EX score reaches over the chart's notes, as beatoraja's `ScoreDataProperty.qualifyRank` does: an AAA lights all eight, any score on a chart with notes lights F, and a chart without notes lights none. `resolveBeatorajaPlayScoreOps` and `resolveBeatorajaResultOps` light them this way.

New with it: `beatorajaGenericRankOps(score)` (`/scene`), the generic rank ops a score's `exScore` reaches over its `total` notes, compared with each border in 27ths.
