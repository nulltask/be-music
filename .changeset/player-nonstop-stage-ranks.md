---
'@be-music/player': minor
---

A later stage of a stitched NONSTOP play was judged with the first stage's `#RANK`; LR2 switches to each later stage's `#RANK` during the play. `stitchNonstopCourse`'s map now carries `stageRanks` (`resolveNonstopStageRanks`), which the engine takes as the `stageRanks` play option and the LR2 ruleset applies.

- `placement: 'lr2'` reproduces LR2: the switch at the stage's own time zero, a stage without `#RANK` keeping the rank in force, and LR2's own NONSTOP window table (`resolveLr2NonstopRankWindowsMs`, wider than a chart's opening table for VERY HARD and HARD).
- The default `'intended'` placement switches halfway between the two stages' notes, to the windows a chart opening with that `#RANK` gets (`resolveBmsRankJudgeRankPercent`), and reads a stage without `#RANK` as NORMAL.
- Play logs record the changes as `chart.judgeRank.stageRanks`, so replays, re-simulations and the cut-out stage logs judge with them; logs without the field replay as before.
