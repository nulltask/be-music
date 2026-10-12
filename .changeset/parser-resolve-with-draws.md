---
'@be-music/parser': minor
---

Add `resolveBmsControlFlowWithDraws(chart, draws)`, which resolves `#RANDOM` / `#SETRANDOM` / `#SWITCH` with explicit outcomes from `drawRandomOutcomes` (`@be-music/chart`) or a play log, and throws a `RangeError` for draws that do not belong to the chart. The same chart and draws always give the same result. `resolveBmsControlFlow` is now shorthand for drawing and resolving in one go, and both run the control-flow evaluator in `@be-music/chart`, so the branch semantics live in one place.
