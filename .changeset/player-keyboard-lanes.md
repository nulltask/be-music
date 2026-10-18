---
'@be-music/player': minor
---

Add the 24 / 48 KEY wheel lanes. Each keyboard side now has 26 lanes, the 24 keys plus the wheel up / down on `1P` / `1Q` (`2P` / `2Q`), so wheel notes play instead of being dropped. The wheel is judged like a key, sits on the side's outer edge (slots 25 / 26), and binds `Tab` / left `Shift` (1P) and `Enter` / right `Shift` (2P). `resolveWheelLaneDirection` and `resolveLaneOptionChannels` (`@be-music/player/lanes`) report a wheel lane's direction and the keys the lane options permute (the wheel and the scratch stay put). The engine also passes the bmson `mode_hint` to the lane-mode rule.

Two fixes on the extended lanes:

- AUTO play sounded invisible objects on the extended lanes (`3A`-`3Q` / `4A`-`4Q`), which bmson `keyboard-24k` hidden notes use: only `31`-`39` / `41`-`49` were kept silent.
- A mine on an extended lane (`DA`–`DO` / `EA`–`EO`) detonated in silence when the chart had no mine on `D1`–`D9` / `E1`–`E9`: the engine now preloads `#WAV00` whenever the chart has a mine.
