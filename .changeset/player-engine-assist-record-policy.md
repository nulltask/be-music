---
'@be-music/player-engine': minor
---

Assisted plays no longer count as ordinary records. `@be-music/player-engine/records` adds one deterministic resolver: `classifyReplayAssists` classifies each recorded option by its own source (LR2, beatoraja or That-Which-Must-Not-Be-Named) as `light`, `assist` or `no-save`, and `resolveRecordPolicy` / `resolveReplayRecordPolicy` give each judge ruleset's consequences. LR2 caps the lamp at EASY and keeps separate lamps for D-BATTLE, SP TO DP and EXTRA MODE, beatoraja awards LIGHT ASSIST EASY or ASSIST EASY, `____` awards ASSIST EASY, and all three keep only the lamp and play count. `applyRecordPolicyLamp`, `resolveAssistClass` and `resolveCourseRunAssistClass` are exported too. `mergeBestRecord` takes an optional policy, `courseRunKeepsRecord` refuses a run with an assisted stage, `checkReplayEligibility` returns the play's `assistClass` and marks a `no-save` play unranked, and `checkCourseReplayEligibility` marks an assisted run unranked as `assist`.

LIGHT ASSIST EASY is a clear lamp of its own, between ASSIST EASY and EASY, and beatoraja's ASSIST EASY gauge now clears on it, as beatoraja does. Stored lamp ranks are append-only: ranks 0 to 9 keep their lamps and LIGHT ASSIST EASY is 10. Compare lamps with the new `clearLampOrder`, `compareClearLamps` and `compareClearLampRanks`, because `clearLampRank` is no longer an order.
