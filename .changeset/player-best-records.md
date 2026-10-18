---
'@be-music/player': minor
---

Add `@be-music/player/records`, the best-record rules every host keeps records by, so they are written once:

- `BestRecord` (the best lamp, EX score, max combo and BP on a chart or course, and the play count) and `RecordPlay` (what one play contributes).
- `mergeBestRecord` folds a play into a record, each best kept on its own; `mergeCourseStageRecord` folds an EXPERT / GRADE course stage into its chart's record as LR2 does (only a FULL COMBO or better lamp, no play count).
- `recordPlayFromResult` / `recordPlayFromSummary` read a play's facts from its result or engine summary, `courseStageRecordPlayFromResult` / `courseStageRecordPlayFromSummary` also count the notes a failed stage never judged in its BP, and `courseRunRecordPlay` reads a course result's. A result whose POOR also counts the empty POORs (LR2's readout) passes the POOR judgments alone as `RecordPlayResult.judgedPoor`, so the BP counts each empty POOR once.
- `playKeepsRecord`, `courseStageKeepsRecord` and `courseRunKeepsRecord` (with `isCourseRunAutoPlayed` / `isCourseRunAtAnotherTempo`) say which plays count: not auto plays, replays or plays at another tempo.
