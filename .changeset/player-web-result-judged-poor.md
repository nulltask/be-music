---
'@be-music/player-web': patch
---

A play's result under the LR2 judge ruleset made the BP a host records from it (`recordPlayFromResult`) count each empty POOR twice: its POOR folds the empty POORs in, as LR2's readout does, and the BP adds them again. The result (`getResultData`, `onChartFinished`) now also carries the POOR judgments alone as `judgedPoor`, which the record reads; the POOR the result screen shows is unchanged.
