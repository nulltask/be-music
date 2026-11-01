---
'@be-music/player-skin-sdk': minor
---

Add the cabinet play layout:

- `cabinetStage`, `resolveCabinetBGARect` and `resolveCabinetLayout` place the keys, gauge, score, hi-speed, score graph, stage band, players, judgement panel, BPM and tempo around the standard lanes, and centre a double-play field on the stage with the chart and judgement panel in a left column.
- A stage's playfield bounds take `doublePlayCenterX` to centre double-play lanes, and `resolveBGARect` receives the playfield's left edge.
- `resolveScorePace` and `formatScoreDiff` drive a score graph against a pacemaker and the best record, `resolveStageLabel` names the stage, and `resolveDifficultyName` reads `#DIFFICULTY`.
- The gameplay runtime gains `bestEXScore`, `targetEXScore`, `targetLabel`, `course`, `playerName`, `tempo` and `random1P`, and the DOM gameplay frame's layout gains `mode` and `lanes`.
