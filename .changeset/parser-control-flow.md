---
'@be-music/parser': minor
---

Add `resolveBmsControlFlowWithDraws(chart, draws)`, which resolves `#RANDOM` / `#SETRANDOM` / `#SWITCH` with explicit outcomes from `drawRandomOutcomes` (`@be-music/chart`) or a play log, and throws a `RangeError` for draws that do not belong to the chart. The same chart and draws always give the same result. `resolveBmsControlFlow` is now shorthand for drawing and resolving in one go, and both run the control-flow evaluator in `@be-music/chart`, so the branch semantics live in one place.

Two fixes come with it:

- A resolved chart rolled `#RANDOM` again when it was resolved a second time, adding a freshly drawn branch on top of the one applied and doubling notes and keysounds: the result no longer carries `bms.controlFlow`, so resolving it again changes nothing, and stringifying it no longer writes the branches back out.
- A header defined inside a taken branch overrode a later top-level definition of the same header, because branch lines were replayed after the whole file: header lines now apply in file order, as LR2 and beatoraja apply them. The parser marks a branch header that a later top-level line overrides (`overriddenByLaterHeader`), and resolving skips it. Repeatable headers (`#STP`, `#WAVCMD`, `#LNOBJ`) still add up.
