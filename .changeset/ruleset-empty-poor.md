---
'@be-music/player': minor
---

Charge empty POORs from the ruleset's own miss window, and surface the count.

The engine hardcoded LR2's one-second early window for every ruleset and never reported the tally. It now reads the
active ruleset's miss (`ms`) window — LR2's is early-only (`{0, 1 s}`), beatoraja's reaches 500 ms early and 150 ms
late — and checks both neighbours of the press so the late side is honoured where a ruleset has one. Whether an empty
POOR breaks the combo is the ruleset's call too: beatoraja's five-key and PMS rules say yes, LR2 and IIDX say no.

`PlayerSummary` and the UI frame summary gain a required `emptyPoor` field. It is tracked apart from `poor` because an
empty POOR consumes no note and never reaches EX-SCORE; whether a player's POOR counter displays the two summed is a
presentation choice, and LR2's does (OpenLR2 `ApplyJudgeNote` increments `playerstat.poor` for it).
