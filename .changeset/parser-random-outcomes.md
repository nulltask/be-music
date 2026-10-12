---
'@be-music/parser': minor
---

`resolveBmsControlFlow` accepts `outcomes`, the values to use for the `#RANDOM` / `#SWITCH` lines in file order, and reports the value of every such line through `onOutcome`, so a play can be recorded and its chart rebuilt exactly (for example from a play log's `randomOutcomes`).
