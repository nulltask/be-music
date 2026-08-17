---
'@be-music/player': minor
---

Add the `@be-music/player/playlog` subpath: a play-history ("playlog") format that records the resolved chart, the raw key press/release stream, and the play settings as an input replay, plus LR2 / beatoraja / IIDX ruleset simulators (`simulatePlaylog`) that re-derive judgments, EX-SCORE, max combo, money score, and groove gauge from the same recorded inputs.

New `PlayerOptions.onPlaylogRecorded` / `PlayerOptions.recordPlaylog` enable engine-side recording for both `manualPlay` and `autoPlay` (including ESC-aborted runs), and `PlayerOptions.replayInputs` re-drives a recorded input stream deterministically for replay playback (live lane input is ignored while a replay is active). `PlayerOptions.judgeRuleset` switches the live judge windows between LR2 (default), beatoraja, and IIDX — recorded as `play.judgeRuleset` so replays re-apply the same windows — and the playlog stamps the source chart file's SHA-256 (`chart.sha256`) when the host supplies one. `ScoreTracker` now latches `maxCombo`, `resolveJudgeRankPercent` exposes the chart's initial judgerank percent, and the landmine gauge-damage rule moved to the shared `core/landmine.ts` helper.
