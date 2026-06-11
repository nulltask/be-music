---
'@be-music/player': minor
---

HARD / EASY / DEATH gauges now follow the LR2 tables (beatoraja GaugeProperty HARD_LR2 / EASY_LR2 / HAZARD_LR2): HARD recovers +0.1/+0.1/+0.05 with damage scaled by the #TOTAL multiplier table and softened ×0.6 under 30%; EASY damages -3.2/-4.8/-1.6 and clears at 80%; DEATH drains -10 on an empty POOR instead of dying and recovers +0.15/+0.06. Survival gauges collapse to 0% (FAILED, no recovery) below 2%, and raw deltas such as mine damage bypass the guts/TOTAL modifiers.
