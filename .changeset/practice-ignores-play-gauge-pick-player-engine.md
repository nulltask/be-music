---
'@be-music/player-engine': patch
---

A PRACTICE play stopped before it started (no sound, no lane lasers, the bars picked never played) when the play's gauge pick named a gauge the judge ruleset lacks, such as `beatoraja:ASSIST-EASY` under LR2: `resolveRuleset` threw `LR2 beta3 has no ASSIST-EASY gauge`. PRACTICE plays on its own gauge, so it now ignores the play's pick.
