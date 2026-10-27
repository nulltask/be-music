---
'@be-music/player-engine': minor
---

A single play that failed or was given up mid-way no longer records a BP that leaves out the notes it never judged: `recordPlayFromResult` and `recordPlayFromSummary` now count them, as LR2 and beatoraja do, and the course-stage variants reuse them so a stage counts them once. A mine POOR, which LR2 counts in POOR, is not taken for a judged note.
New `abortedRecordPlayFromResult` reads what a single play given up with ESC contributes to its record (FAILED, the notes never reached in its BP, nothing when no note was judged), and new `resolveRulesetResultMissCount` gives a simulated result's BP with the same rule.
