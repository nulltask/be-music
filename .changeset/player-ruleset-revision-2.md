---
'@be-music/player': patch
---

Bump the ruleset result ids to `lr2/2`, `beatoraja/2` and `iidx/2`: the mine rules changed (the `lr2` / `iidx` simulators gained LR2's press and window-entry legs, the `beatoraja` engine detonates only on a key down at the crossing), so results from the old rules no longer carry the same id. Logs with `/1` results still parse; re-simulating or replaying them applies the current rules.
