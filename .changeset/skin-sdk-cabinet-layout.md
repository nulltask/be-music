---
'@be-music/player-skin-sdk': minor
---

Add the cabinet play layout: `cabinetStage`, `resolveCabinetBGARect` and `resolveCabinetLayout` place the keys, gauge, score, hi-speed, score graph, stage band, players, judgement panel, BPM and tempo around the standard lanes, and a double-play field centred on the stage with the chart and judgement panel in a left column.
Add `doublePlayCenterX` to a stage's playfield bounds to centre double-play lanes, and pass the playfield's left edge to `resolveBGARect`.
Add `resolveScorePace` and `formatScoreDiff` for a score graph against a pacemaker and the best record, `resolveStageLabel` for the stage name, and `resolveDifficultyName` for `#DIFFICULTY`.
Add `bestEXScore`, `targetEXScore`, `targetLabel`, `course`, `playerName`, `tempo` and `random1P` to the gameplay runtime, and `mode` and `lanes` to the DOM gameplay frame's layout.
