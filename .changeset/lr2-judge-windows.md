---
'@be-music/player': minor
---

Judge windows are now the measured LR2 tables instead of IIDX-baseline linear scaling: #RANK 0/1/2/3 map to ±8/±15/±18/±21ms PGREAT (±24/±30/±40/±60 GREAT, ±40/±60/±100/±120 GOOD), #RANK 4 is treated as NORMAL, the BAD gate is fixed at ±200ms for every rank, and #DEFEXRANK / #EXRANKxx / bmson judge_rank interpolate piecewise-linearly between the rank anchors (lr2oraja JudgeWindowRule.LR2 model) without ever exceeding the BAD gate.
