---
'@be-music/player-web': minor
---

Add PixiJS render helpers for beatoraja skins: `destinationToSpriteProps()` (pure keyframe sampling →
`{x, y, width, height, alpha, tint, angle, blendMode, visible}`) and `loadBeatorajaTexturesFromBundle()`
(decode every `source[]` asset as a Pixi `Texture`, with blob-URL revocation on `dispose()`). The render
helper covers `if`/`op` visibility gating, alpha=0 culling, timer-not-fired hiding, RGB tint packing, and
the LR2-compatible blend-code → Pixi v8 BlendMode mapping.

Scene wiring (`pixi-gameplay-beatoraja.ts` etc.) lands in a follow-up commit on top of these helpers.
