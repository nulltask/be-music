---
'@be-music/player-tui': minor
---

Add `--ruleset` and `--gauge` to `bms-player`.

`--ruleset <lr2|beatoraja|iidx>` picks the compat ruleset the engine judges under (default `lr2`) and
`--gauge <GROOVE|EASY|HARD|DEATH>` picks the gauge (default `GROOVE`, mapped onto each ruleset's own line-up).
Unknown values are rejected with the list of accepted ones rather than silently falling back. The TUI result block
prints the SCORE line only for rulesets that define a money score, and now also prints the empty-POOR count.
