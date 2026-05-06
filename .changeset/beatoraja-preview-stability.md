---
'@be-music/player-web': patch
'@be-music/player-web-demo': patch
---

Stabilize the beatoraja preview scene against PixiJS v8 WebGPU / WebGL2 crashes.

- `BeatorajaPlaySkinView` mounts each sprite with `alpha: 0` (default `visible = true`) instead of
  `visible: false`. PixiJS v8's batchers skip texture-binding setup for `visible = false` sprites on the first
  render pass, then crash inside `BindGroupSystem._createBindGroup` (WebGPU) / `applyStyleParams` (WebGL2) when
  visibility is later flipped on. Mounting visible-with-alpha-0 lets the bind-group cache warm up on frame 0;
  `update()` overwrites alpha to the destination keyframe's value the next tick.
- `BeatorajaPlaySkinView` constructor pre-builds the cell-0 cropped sub-texture and assigns it to the sprite,
  so the first render pass has a fully-resolved texture to bind for every sprite.
- `createCroppedBeatorajaTexture` rejects rectangles with `NaN` / non-finite extents — beatoraja skins with
  malformed `divx`/`divy` no longer reach the renderer with degenerate sub-textures.
- `loadBeatorajaTexturesFromBundle` sets `texture.source.scaleMode = 'nearest'` (mirrors the LR2 loader) so
  the texture's `style` is initialized before the first render frame.
- `BeatorajaTextureCache` no longer exposes `dispose()`. Calling `texture.destroy(true)` and re-decoding the
  same bytes for a follow-up preview made PixiJS hand back a half-disposed `TextureSource` (style=null) and
  crash on the next render. The demo now memoizes the texture cache per entry path in
  `beatorajaTextureCachesByEntry`, so reopening the same variant reuses the existing GPU upload and switching
  variants only allocates new caches (old ones stay resident until page reload). The same bug technically
  lurks in the LR2 path but its typical user flow doesn't re-mount the same skin in a session.
