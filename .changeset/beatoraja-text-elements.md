---
'@be-music/beatoraja-skin': patch
'@be-music/player-web': patch
'@be-music/player-web-demo': patch
---

Render `text[]` destinations as Pixi `Text` placeholders so song-title / artist / score-label slots are visible
in the preview before the engine integration lands.

- `@be-music/beatoraja-skin` exports `normalizeBeatorajaTexts()` and `normalizeBeatorajaFonts()` that turn the
  permissive JSON / Lua tree into `BeatorajaTextElement[]` / `BeatorajaFontElement[]`. The text shape is
  `{ id, fontId, size, ref, align, ifCodes }`; numeric `align` codes (0/1/2) are coerced to `'left'` /
  `'center'` / `'right'`.
- `BeatorajaPlaySkinView` builds a Pixi `Text` per text-targeting destination at construction time, with the
  browser's default sans-serif font at the declared size. The destination keyframe drives `x / y / alpha /
  tint / angle / blendMode`; width / height are intentionally NOT applied (Pixi Text auto-sizes to its
  glyphs and the destination's box is a clipping hint, honored later when the engine plugs in real strings).
- New `resolveTextContent` callback on `BeatorajaPlaySkinView` (and surfaced through
  `BeatorajaPlaySkinPreviewScene`) lets the host substitute display strings via the `text[].ref` op-code.
  The demo passes `<text:{ref}>` placeholders so each text slot is visible in the preview.

Skin TTFs aren't loaded yet — that joins the engine integration patch where dynamic strings + font registration
land together.
