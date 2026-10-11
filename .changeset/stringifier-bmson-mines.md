---
'@be-music/stringifier': patch
---

Fix `stringifyBmson` writing mines as ordinary notes: landmine events (`Dx` / `Ex`) now go to bmson `key_channels` on the lane they sit on and keep their `damage`, instead of landing in `sound_channels` as extra playable lanes.
