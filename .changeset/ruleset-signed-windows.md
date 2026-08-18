---
'@be-music/player': minor
---

Judge with the active ruleset's signed, per-context judge windows instead of one symmetric width.

The engine previously reduced every ruleset to a single `{pgreat, great, good, bad}` set of symmetric millisecond
widths. It now reads the ruleset's four window tables — key vs scratch, note vs long-note end — and both legs of every
window separately, so:

- beatoraja's asymmetric BAD window is honoured: on a seven-key chart a press 250 ms late is a BAD, while the same
  press 250 ms early cannot reach the note at all and leaves it to miss on its own deadline.
- Scratch lanes judge on the turntable tables (beatoraja's are 10 ms wider per judge than its key tables).
- Long-note ends judge on the long-note-end tables, including LR2's GOOD-width release tolerance.
- Each note's miss deadline comes from its own lane and its own chart time, so a mid-chart `#EXRANKxx` no longer needs
  a separate frozen-window cursor.
- Mine detonation uses the GOOD window's early and late legs separately.

A press that lands inside no window no longer consumes the note as a POOR — it falls through to the lane keysound and
the empty-POOR path, which is what every reference player does.

`resolveJudgeWindowsMsForRuleset` and `resolveBeatorajaJudgeRankPercent` are removed from
`@be-music/player/core/judge-window`; the per-ruleset tables live in the ruleset module, which now also exports
`classifyRulesetJudge`, `selectJudgeWindowSet`, `judgeWindowLateReachUs`, `judgeWindowEarlyReachUs`, and
`goodWindowReachUs`.
