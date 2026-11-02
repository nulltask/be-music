---
'@be-music/player-engine': minor
---

A back-spin scratch (a CN / HCN on a scratch lane) under beatoraja and That-Which-Must-Not-Be-Named now has its tail judged on a reverse spin instead of the release, as beatoraja does: a release no longer settles it, and a tail never spun back is a missed POOR. LR2 keeps playing every long note as an LN.

Each scratch press carries its spin (`'cw'` / `'ccw'`): the `lane-input` command takes a controller's reported direction, keys follow the odd-even rule over the scratch lane's keys (Shift, then Ctrl or Option / Alt), and replays record it as `spin`, so replays and the replay simulator reproduce the tail. Input with no direction (a touch lane sends `spin: null`, or an ANY KEY press from a non-scratch key) turns a BSS back with any fresh press, so touch players can clear BSS tails.

New exports on `@be-music/player-engine/lanes`: `createScratchSpinByToken`, `resolveScratchSpin`, `isReverseScratchSpin`, `isScratchSpin` and the `ScratchSpin` type (also on `./signals`); `LaneBinding` gains `inputKeys`.
