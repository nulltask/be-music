---
'@be-music/player-engine': patch
---

Under the `____` ruleset a bare `DEATH` or `DEATH-CORRECTED` gauge outside a course is now refused with a `RangeError`, as every other bare gauge a ruleset lacks is (LR2's EX-HARD, the attack gauges outside LR2). It used to play silently as EX-HARD, while re-judging refused it and the Options dialog returned it to GROOVE. Re-judging now reports such a replay as `not-simulated` (`gauge`) under its own ruleset too, instead of failing inside the simulation. A course stage still plays `DEATH` on the class gauge, and another source's pick (`lr2:DEATH`) keeps its source's gauge.
