---
'@be-music/player-web': minor
---

The be-music skin registry accepts skins written for skin API revision 2 as well as revision 1. Skins can change play options and open the readme from the select screen through the new `setPlayOption`, `cyclePlayOption`, and `toggleReadme` actions (unknown keys and values outside an option's choices are ignored, `hiSpeed` and `shutter` are clamped, and each change bumps the select frame's `revision`), and every frame carries the skin's settings resolved to their defaults. `PixiPlayOptions` and its value unions are now aliases of the SDK's `BeMusicPlayOptions` types.

The player now fills these revision 2 fields:

- Runtime: `song`, `lastJudgeDeltaMs` / `judgeTimings`, `minBpm` / `maxBpm` / `mainBpm`, `songLengthMs` / `songElapsedMs`, `failedAtMs` / `allNotesDoneAtMs` / `outroAtMs`, `gaugeRiseAtMs` / `gaugeMaxAtMs`, `scoreHistory` / `gaugeHistory`, `laneCovers` / `visibleMs` / `greenNumber` (beatoraja's duration and green number, over the current scroll and BPM), and `judgeWindows` (the engine's resolved windows in ms; a mid-chart `#EXRANK` change is not reflected).
- Lanes and notes: each lane's `pressedAtMs` / `releasedAtMs` and `holding` / `holdStartedAtMs`, each long note's `mode` (as the active ruleset plays it) and `state` (`pending` / `held` / `dropped` / `done`), `autoplay` on notes and long notes played by autoplay or auto-scratch, the `judge` that set off each bomb, and `measureLines` (one per lane run) for skins that set `drawsMeasureLines`.
- Select: `pointer` in the stage's design pixels, `hit` returns whether the pointer is over the rect, and `songRecord(song)` answers from the new `resolveSongRecord` select-scene option, through which a host hands skins its per-chart best records (lamp, EX score, max combo, miss count, play count); without it every song reads as never played.
- Result data: `lamp`, `gaugeType`, `judgeRuleset`, `fast` / `slow`, and `judgeTimings`.
- Song images: `songImage(song, kind)` on the select, decide, gameplay, and result frames returns the song's `#STAGEFILE`, `#BANNER`, or `#BACKBMP` as an `ImageBitmap`, loaded lazily from the song collection (select bumps `revision` when one arrives). Each scene keeps at most 32 decoded images and closes the least recently used one beyond that.
- BGA: a skin that sets `drawsBga` receives `frame.bga` with the active base, layer, and POOR images and `poorActive`.

A skin that sets `drawsLaneCover`, `drawsMeasureLines`, or `drawsBga` now draws the lane covers, measure lines, or BGA itself, and the player stops drawing its own.

The new `DefaultPixiDecideView` shows a skin's `decide` screen between select and play for its `durationMs` (Enter, Space, or a click skips ahead; Escape cancels back to select); hosts mount it only when the skin declares one.
