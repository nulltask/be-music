---
'@be-music/player': minor
---

Add the 24 / 48 KEY wheel lanes. Each keyboard side now has 26 lanes: the 24 keys plus the wheel up / down on `1P` / `1Q` (`2P` / `2Q`), so wheel notes play instead of being dropped. The wheel is judged like a key, sits on the side's outer edge (slots 25 / 26), and binds `Tab` / left `Shift` (1P) and `Enter` / right `Shift` (2P). New `resolveWheelLaneDirection` and `resolveLaneOptionChannels` (`@be-music/player/core/lane-layout`) report a wheel lane's direction and the keys the lane options permute (the wheel and the scratch stay put). The engine also passes the bmson `mode_hint` to the lane-mode rule.
