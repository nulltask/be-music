---
'@be-music/stringifier': patch
---

Fix `stringifyBmson` writing mines to `key_channels`, which beatoraja reads as hidden notes: mines now go to `mine_channels` with their `damage`, and BMS invisible objects (`3x` / `4x`), which used to become extra playable lanes in `sound_channels`, go to `key_channels` on the lane they sit on. A chart with mines or invisible objects no longer loses them when `skipPreservationValidation` is set.
