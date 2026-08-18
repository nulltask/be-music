---
'@be-music/player': patch
---

Cap every inner judge window at the BAD gate under the IIDX ruleset. Classification walks PGREAT → GREAT → GOOD → BAD in order, so the uncapped GOOD window (116.67 ms) swallowed every press a `judgeWindowMs` debug override below it was meant to reject — a 50 ms override left the effective window at 116.67 ms. LR2 and beatoraja already capped; all three now share one code path.

Resolve each note's miss deadline from the judge rank in force at that note's own time instead of the live window. The LR2 BAD gate is rank-invariant, so this is behaviour-neutral today; it stops a rank change from retroactively moving the deadline of already-passed notes once a ruleset whose BAD width scales with judgerank is wired in.
