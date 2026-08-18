---
'@be-music/player': minor
---

Score with the active ruleset's formula instead of an invented 200000-point curve.

`summary.score` was computed from a made-up model — a 150000-point judge base plus a 50000-point combo bonus that
capped at a combo of 10 — which matches no reference player. It now follows the ruleset:

- LR2 reports its money score, `floor((4×PGREAT + 2×GREAT + GOOD) × 50000 / notes)`, capped at 200000. Purely a
  function of the judge tally: no combo term.
- beatoraja and IIDX report EX-SCORE, which is what they display (IIDX retired its own money score in BISTROVER).

`createScoreTracker` takes `{ moneyScore }`, `LR2_MONEY_SCORE_MAX` replaces `IIDX_SCORE_MAX`, and the invented
combo-bonus helpers are gone. The TUI result block prints the SCORE line only for rulesets that define one, and now
also prints the empty-POOR count.
