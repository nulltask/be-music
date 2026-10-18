---
'@be-music/player-web': minor
---

Play the 24 / 48 KEY wheel. The built-in skins draw the wheel lanes like their scratch, with an up / down arrow on the key cap, and beatoraja `play24` / `play24d` skins get wheel notes on skin lanes 24 / 25 (2P 50 / 51). The lane options permute all 24 keys of a keyboard side, where they touched only the IIDX columns among them, and leave the wheel alone. The select and play screens honour the bmson keyboard `mode_hint`.

- On the built-in skins, the keys past the seventh and the wheel show their key beam like every other lane; the shared playfield lit only the lanes LR2's key-on timers cover.
- The select screens list a 24-key chart (a bmson `keyboard-24k` chart or its double) apart under the key filter instead of under 7 or 14 keys; LR2's key filter has no 24-key choice, so on LR2 skins such a chart is listed only under ALL.
- The select screen's chart preview keeps invisible objects on the extended lanes (`3A`-`3Q` / `4A`-`4Q`, used by `keyboard-24k` hidden notes) silent, as it already did for `31`-`39` / `41`-`49`.
