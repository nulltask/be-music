---
'@be-music/player-engine': minor
---

Re-judging a replay under another ruleset no longer throws or silently drops an option it cannot read, as ADR 0019 decides. `@be-music/player-engine/replay` adds `rejudgeReplay`, `rejudgeReplayRulesets`, `rejudgeCourseReplay` and `findReplayNotSimulatedReason`, which answer `simulated`, `truncated` (a run that ended where its gauge emptied, judged only up to that point under a ruleset whose gauge would have survived) or `not-simulated` with the reason (`gauge`, `custom-judge`, `gauge-auto-shift`). `SimulateReplayOptions` adds `onFailure`, which hears when the survival gauge empties.
