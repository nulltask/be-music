---
'@be-music/player': patch
---

Under the `lr2` judge ruleset the DEATH gauge charged beatoraja's values: it recovered +0.15 / +0.06 on PGREAT / GREAT and an empty POOR cost 10 %, so ten empty POORs failed a run LR2 would keep alive. It now plays LR2's own table (OpenLR2 `LR2f.cpp` L27673-L27680): no recovery, BAD and POOR kill, and an empty POOR costs nothing. The engine and the play-log simulator share the table, so re-simulated `lr2` results move with it; beatoraja's HAZARD is unchanged.
