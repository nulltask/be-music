---
'@be-music/player': minor
---

`RecordPlayResult` takes a result's POOR judgments alone as `judgedPoor`, for a result whose POOR also counts the empty POORs (LR2's readout): `recordPlayFromResult` and `courseStageRecordPlayFromResult` read it in place of `score.poor`, so the BP counts each empty POOR once and a course stage no longer takes empty POORs for judged notes.
