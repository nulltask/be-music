---
'@be-music/player': patch
---

Move the LR2 / beatoraja / IIDX ruleset tables out of the play-log simulator into a shared `src/ruleset/` module so the live engine and the simulator can resolve behaviour from one source of truth. The tables now take a neutral `RulesetChartFacts` record instead of reading a `PlaylogChart` directly, and each caller supplies an adapter — `rulesetChartFactsFromPlaylog` for recorded plays. `@be-music/player/playlog` re-exports the ruleset surface unchanged, so this is behaviour-neutral for consumers.
