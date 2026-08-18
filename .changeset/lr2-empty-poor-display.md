---
'@be-music/player-web': patch
'@be-music/player': minor
---

Show empty POORs in the LR2 POOR counter, as real LR2 does.

`RulesetConfig` gains `emptyPoorCountsInPoorDisplay` — a presentation rule, not a scoring one. LR2 is `true`:
OpenLR2's `ApplyJudgeNote` increments `playerstat.poor` for the empty-POOR branch and LR2 exposes no separate stat,
so a run judged under LR2 now folds `emptyPoor` into the POOR figure its result screen, BP, and per-judge rates
read. beatoraja shows an empty-POOR figure of its own and IIDX's counter is unmeasured, so both keep them apart.

`ScoreSummary` gains `emptyPoor` and `@be-music/player/core/scoring` exports `resolveDisplayedPoor`.
`PlayerSummary` always reports the split; only the display copy folds.
