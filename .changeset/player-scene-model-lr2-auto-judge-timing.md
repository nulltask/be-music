---
'@be-music/player-scene-model': minor
---

`PlayOptions.judgeTimingAutoAdjust` is a mode (`'OFF'`, `'BEATORAJA'`, `'LR2-ON'`, `'LR2-SILENT'`, default `'OFF'`) instead of a boolean, cycled through those choices. `resolvePlayOptionValue` and `resolvePlayOptions` read a stored or recorded boolean as `'BEATORAJA'` or `'OFF'` (#777).
