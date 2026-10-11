---
'@be-music/player-web': patch
---

The be-music skin registry accepts skins written for skin API revision 2 as well as revision 1. Skins can change play options and open the readme from the select screen through the new `setPlayOption`, `cyclePlayOption`, and `toggleReadme` actions, and every frame carries the skin's settings resolved to their defaults. `PixiPlayOptions` and its value unions are now aliases of the SDK's `BeMusicPlayOptions` types.

The player now fills these revision 2 fields:

- Runtime: `song`, `lastJudgeDeltaMs` / `judgeTimings`, `minBpm` / `maxBpm` / `mainBpm`, `songLengthMs` / `songElapsedMs`, `failedAtMs` / `allNotesDoneAtMs` / `outroAtMs`, `gaugeRiseAtMs` / `gaugeMaxAtMs`, `scoreHistory` / `gaugeHistory`, `laneCovers` / `visibleMs` / `greenNumber` (beatoraja's duration and green number, over the current scroll and BPM), and `judgeWindows` (the engine's resolved windows in ms; a mid-chart `#EXRANK` change is not reflected).
- Lanes and notes: each lane's `pressedAtMs` / `releasedAtMs` and `holding` / `holdStartedAtMs`, each long note's `mode` (as the active ruleset plays it) and `state` (`pending` / `held` / `dropped` / `done`), `autoplay` on notes and long notes played by autoplay or auto-scratch, the `judge` that set off each bomb, and `measureLines` (one per lane run) for skins that set `drawsMeasureLines`.
- Select: `pointer` in the stage's design pixels, and `hit` returns whether the pointer is over the rect.
- Result data: `lamp`, `gaugeType`, `judgeRuleset`, `fast` / `slow`, and `judgeTimings`.

A skin that sets `drawsLaneCover` or `drawsMeasureLines` now draws the lane covers or measure lines itself, and the player stops drawing its own.

The other revision 2 fields are left empty or `undefined` for now.
