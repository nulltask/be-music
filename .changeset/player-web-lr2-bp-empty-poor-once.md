---
'@be-music/player-web': patch
---

Fix the BP of a play judged under the LR2 ruleset counting each empty POOR twice: the result's POOR folds empty POORs in as LR2 does, and its empty-POOR count is now 0, as LR2 keeps none, so a best record's BP (BAD + POOR + empty POOR) and a failed course stage's BP count each empty POOR once. Under the beatoraja and IIDX rulesets the two counts stay apart, as before.
