---
'@be-music/lr2-skin': minor
---

Add the decide and result screens' timers to `@be-music/lr2-skin/state`, next to the select and play ones, so every LR2 screen's timers come from the same pure resolvers. `resolveLr2DecideTimers` gives the timers running on a moment of the decide screen (0 from the entry, 1 once input opens, 2 once the screen leaves), `resolveLr2ResultTimers` those of the result screen (0, then 1 and 150 once input opens, 151 once the graphs have drawn, 152 once the record update shows), each with the time it started at, and `resolveLr2GraphReveal` how much of a result graph shows that long after its timer started.
