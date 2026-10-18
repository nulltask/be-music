---
'@be-music/scene-model': minor
---

`playResultFromBeatoraja` and `beatorajaCompletionFromPlayResult`, with their `BeatorajaPlayCompletion`, `BeatorajaPlaySummary` and `BeatorajaPlayGauge` types, are removed. They read the old beatoraja gameplay scene's `onComplete(summary, maxCombo, history)` as a `PlayResult` and back. Every play now produces a `PlayResult` itself (`playResultFromPlayState`), and the beatoraja result reads one, so nothing needs either shape.

Migration:

- `playResultFromBeatoraja(completion, facts)` for a play → `playResultFromPlayState(state, facts)` over the play's final `PlayState`, or the `PlayResult` a play scene hands its host (`createPlayScene`'s `on.finish`).
- `playResultFromBeatoraja` for a course run → `playResultFromCourseRun(course, result, courseLog, joinCourseStageHistories(stageHistories, weights), { playSeconds, stageHistories })`.
- `beatorajaCompletionFromPlayResult(result)` → pass the `PlayResult` itself: the beatoraja result resolvers (`@be-music/beatoraja-skin/scene`) read it.
