---
'@be-music/beatoraja-skin': patch
'@be-music/player-web': minor
---

Add `BeatorajaPlaySkinView` — a minimal PixiJS scene that mounts a beatoraja skin's `image[]` + `destination[]`
into a single `Container`, samples each destination per frame, and assigns position / size / alpha / tint /
blendMode / angle to the matching `Sprite`. Animated frames (`divx`/`divy` cells with `cycle` or `ref`-driven
selection) swap a cached cropped texture in place; static keyframes paint once. Sprites render in
`(offset, declarationOrder)` order to match beatoraja's back-to-front layering.

The renderer scope is restricted to chartable variants — `BEATORAJA_PLAYABLE_VARIANTS` covers `5 / 7 / 9 / 10 /
14` keys; the bundled 24-key skins parse but aren't wired into gameplay because no chart format feeds them.
`pickBeatorajaPlayableVariant({ keys, isDouble, isPms })` resolves a chart shape to its variant in the same
manner as `pickLr2PlaySkin`.

Also fixes a `sampleBeatorajaDestination` regression where single-keyframe destinations (`dst.length === 1`)
returned `undefined` past `time = 0` when `loop = -1`, leaving static elements invisible in the renderer.
