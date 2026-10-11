---
'@be-music/skin-sdk': minor
---

Add a touch gameplay layout, so a host can give touch-screen players finger-sized lanes and skins receive them through the layout they already read.

- `resolveGameplayLayout` takes an optional `layoutMode: 'standard' | 'touch'` (default `'standard'`, unchanged geometry). In `'touch'` the lanes spread from the stage's left margin to the judgement tally's column with every key one width (at most 72 px) and a scratch 1.4 keys wide, the lanes run from y 48 (below the header band) to a judgement line at y 330 (above the bottom HUD band), so no built-in HUD panel covers them, and `bga` is `undefined`. The 24 / 48 KEY modes keep the standard layout.
- `BeMusicGameplayLayout` gains an optional `mode` reporting the layout the host resolved.
- New helpers: `resolveGameplayLaneGeometry` (lane rects, bounds, and judgement line for either mode), `resolveTouchLaneLayout`, `supportsTouchLayout`, and the `TOUCH_PLAYFIELD` constants, plus the `GameplayLayoutMode` type.
