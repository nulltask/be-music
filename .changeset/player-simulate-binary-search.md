---
'@be-music/player': patch
---

Speed up `simulatePlaylog` / `simulatePlaylogRulesets` on long charts: each press used to walk its lane from the first note to find the notes in reach, so the cost grew with presses × notes. A binary search now finds the first note in reach (for the press and for LR2's multi-BAD sweep). Results are unchanged (checked against the previous simulator on 1,200 runs over real charts); a 5,700-note chart's three rulesets went from about 14.6 ms to 8.8 ms.
