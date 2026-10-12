---
'@be-music/player-web': minor
---

Play the 24 / 48 KEY wheel. The built-in skins draw the wheel lanes like their scratch with an up / down arrow on the key cap, beatoraja `play24` / `play24d` skins get wheel notes on skin lanes 24 / 25 (2P 50 / 51) through the new `resolveBeatorajaNoteLane`, and the lane options now permute all 24 keys of a keyboard side (they used to touch only the IIDX columns among them) while leaving the wheel alone. Song select and gameplay honour the bmson keyboard `mode_hint`.
