---
'@be-music/player-engine': minor
---

PRACTICE and gauge auto-shift work under every judge ruleset instead of throwing outside beatoraja (#933).

- PRACTICE reads its settings under the judge ruleset: `PracticeRules.gauge` is one of the ruleset's own gauges (`resolvePracticeGaugeTypes`), LR2 reads JUDGERANK on its `#RANK` table and uses TOTAL as is, and AC sets only the gauge. `BeatorajaPractice` / `BeatorajaPracticeRules` are renamed `PlayPractice` / `PracticeRules`, and `BEATORAJA_PRACTICE_GAUGE_TYPES` moves beside `LR2_PRACTICE_GAUGE_TYPES`, `PRACTICE_GAUGE_TYPES`, `isPracticeGaugeType`, `resolveDefaultPracticeGauge` and `practiceReadsJudgeRankAndTotal`.
- Gauge auto-shift shifts along each ruleset's own gauge ladder (`resolveGaugeShiftLadder`): LR2 EASY, GROOVE, HARD, DEATH and its course gauges, AC ASSISTED EASY to EX-HARD and the class gauges in a course. SURVIVAL TO GROOVE falls back to the ruleset's default recovery gauge from a survival gauge only, and both players of a two-player play shift.
- `resolveGaugeEndOnFailure` drops its ruleset parameter, and `GAUGE_AUTO_SHIFTS` lists the policies.
- Replays re-judge a gauge auto-shift play under every ruleset: `gauge-auto-shift` is no longer a `ReplayNotSimulatedReason`, and the replay parser accepts every ruleset's ladder gauges in `gauge.values` and a course carry.
