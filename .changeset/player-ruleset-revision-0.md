---
'@be-music/player': patch
---

Ruleset result ids become `lr2/0`, `beatoraja/0` and `iidx/0`. Revision `0` marks the rulesets as still in development: their rules may change between releases without a bump, so a cached `/0` result can differ from what a later release computes; `1` will be the first stable revision. The mine rules changed in this release (the `lr2` / `iidx` simulators gained LR2's press and window-entry legs, the `beatoraja` engine detonates only on a key down at the crossing), so results from the old rules no longer carry the same id. Logs with `/1` results still parse; re-simulating or replaying them applies the current rules.
