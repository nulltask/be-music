---
'@be-music/player-web': patch
---

The be-music skin registry accepts skins written for skin API revision 2 as well as revision 1. Skins can change play options and open the readme from the select screen through the new `setPlayOption`, `cyclePlayOption`, and `toggleReadme` actions, and every frame carries the skin's settings resolved to their defaults. `PixiPlayOptions` and its value unions are now aliases of the SDK's `BeMusicPlayOptions` types.

The gameplay scene now fills these revision 2 fields:

- Runtime: `song`, `lastJudgeDeltaMs` / `judgeTimings`, `minBpm` / `maxBpm` / `mainBpm`, `songLengthMs` / `songElapsedMs`, `failedAtMs` / `allNotesDoneAtMs` / `outroAtMs`, `gaugeRiseAtMs` / `gaugeMaxAtMs`, and `scoreHistory` / `gaugeHistory`.
- Lanes and notes: each lane's `pressedAtMs` / `releasedAtMs`, and `autoplay` on notes and long notes played by autoplay or auto-scratch.
- Result data: `lamp`, `gaugeType`, `judgeRuleset`, `fast` / `slow`, and `judgeTimings`.

The other revision 2 fields are left empty or `undefined` for now.
