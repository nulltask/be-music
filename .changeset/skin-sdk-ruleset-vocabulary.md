---
'@be-music/skin-sdk': minor
---

Take the clear lamp, the gauge type and the best record from `@be-music/player`, so a skin, the host and the Leaderboard speak one vocabulary: `BeMusicClearLamp` is `ClearLamp` (`@be-music/player/ruleset`), `BeMusicGaugeType` is `GaugeType`, and `BeMusicSongRecord` is `BestRecord` (`@be-music/player/records`). The types are unchanged. `resolveResultLamp` reads the lamp through the shared clear-lamp rule, so a cleared play that stopped before its last note reads `CLEAR` rather than `FULL COMBO`.
