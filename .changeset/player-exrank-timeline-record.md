---
'@be-music/player': patch
---

Fix play logs recorded under beatoraja or IIDX dropping the chart's `#EXRANK` changes: re-simulating such a log under LR2 then judged with static windows instead of the ones an LR2 play uses. The changes are now recorded under every ruleset; beatoraja and IIDX still ignore them when judging.
