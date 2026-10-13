---
'@be-music/player': patch
---

Bump the ruleset result ids to `lr2/2`, `beatoraja/2` and `iidx/2`: the mine rules changed (the `lr2` / `iidx` simulators gained LR2's press and window-entry legs, the `beatoraja` engine detonates only on a key down at the crossing), so results from the old rules no longer carry the same id. The same revision covers negative-BPM charts, whose results change with LR2's reverse scroll (#134): inputs past the reversal are judged on the mirrored clock, mines there stay frozen, and a run left with notes unjudged is FAILED. Logs with `/1` results still parse; re-simulating or replaying them applies the current rules.
