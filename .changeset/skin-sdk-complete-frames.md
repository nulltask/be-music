---
'@be-music/skin-sdk': minor
---

Skins now receive everything they need to match what LR2 and beatoraja skins can show. Every addition is optional or opt-in, so existing skins keep working unchanged.

- Gameplay runtime: `song`, `lastJudgeDeltaMs` / `judgeTimings` (positive = late), `judgeWindows`, `laneCovers`, `visibleMs`, `greenNumber`, `minBpm` / `maxBpm` / `mainBpm`, `songLengthMs` / `songElapsedMs`, `failedAtMs` / `allNotesDoneAtMs` / `outroAtMs`, `gaugeRiseAtMs` / `gaugeMaxAtMs`, and `scoreHistory` / `gaugeHistory`.
- Gameplay frame: `measureLines` and `bga` behind the new opt-in `drawsMeasureLines` / `drawsBga` flags, `drawsLaneCover`, per-lane press / release / hold times, long-note `mode` / `state`, `autoplay` on notes, and the `judge` behind each bomb.
- Select frame: `playOptions` / `playOptionChoices` with `setPlayOption`, `cyclePlayOption`, and `toggleReadme` actions, `pointer`, `songRecord(song)`, and `hit` returning whether the pointer is over the rect. `BeMusicPlayOptions` and its value unions now live in the SDK.
- Result data: `lamp`, `gaugeType`, `judgeRuleset`, `fast` / `slow`, and `judgeTimings`, with `binJudgeTimings` for timing histograms.
- An optional decide screen (`skin.decide`), skin settings (`skin.settings`, resolved with `resolveBeMusicSkinSettings` and checked by `validateBeMusicSkin`), and `songImage(song, kind)` on every frame.
