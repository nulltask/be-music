import { Container, Graphics, Sprite, Texture, Rectangle } from 'pixi.js';
import type { Lr2DestinationRect, Lr2TextElement } from '@be-music/lr2-skin';
import { stringToLr2CharCodes, type Lr2BitmapFont, type Lr2FontGlyph } from '@be-music/lr2-skin';
import { normalizeRect } from './lr2-render.ts';

/**
 * Loaded LR2 font payload — the parsed `.lr2font` metadata plus one Pixi `Texture` per `#T <gr>` image declaration. The
 * renderer samples sub-rects from these textures by glyph and stamps them at the destination position.
 */
export interface Lr2LoadedFont {
  font: Lr2BitmapFont;
  /** `#T <gr>` index → loaded texture. */
  textures: Map<number, Texture>;
}

/**
 * Stub-cache reused across renders. Pixi v8 holds renderer-side state per `Texture` (atlas page, GraphicsContext), so
 * re-using the same cropped textures across frames keeps GPU memory bounded even as the bar list rebuilds glyph sprites
 * every frame.
 */
const glyphTextureCache = new WeakMap<Texture, Map<string, Texture>>();

function getGlyphTexture(baseTexture: Texture, glyph: Lr2FontGlyph): Texture {
  let perBase = glyphTextureCache.get(baseTexture);
  if (!perBase) {
    perBase = new Map();
    glyphTextureCache.set(baseTexture, perBase);
  }
  const key = `${glyph.x}|${glyph.y}|${glyph.w}|${glyph.h}`;
  const cached = perBase.get(key);
  if (cached) return cached;
  const cropped = new Texture({
    source: baseTexture.source,
    frame: new Rectangle(glyph.x, glyph.y, glyph.w, glyph.h),
  });
  perBase.set(key, cropped);
  return cropped;
}

/**
 * Renders `value` into a Pixi `Container` using the supplied LR2 bitmap font. Mirrors `makeLr2TextSprite`'s contract:
 * the returned node is positioned per `dst.x` / `dst.y` and respects the element's alignment (left / center / right).
 *
 * Glyph height is scaled to `dst.h` (which is the LR2 spec's "final size") — the source-side `font.baseSize` is the
 * reference dimension, so the scale factor is `dst.h / font.baseSize`. A mismatch between the glyph's own `h` and the
 * font's `#S` value is also handled (the LR2 spec calls this rare but possible).
 *
 * Characters with no glyph entry get a placeholder rectangle (translucent outline) so unmapped text is visibly present
 * rather than silently dropped.
 */
export function makeLr2BitmapTextSprite(
  value: string,
  element: Lr2TextElement,
  dst: Lr2DestinationRect,
  loaded: Lr2LoadedFont,
): Container {
  const root = new Container();
  root.label = `lr2-bitmap-text[st=${element.st},font=${element.font}]`;
  if (value.length === 0) return root;
  const rect = normalizeRect(dst);
  const font = loaded.font;
  const baseSize = Math.max(1, font.baseSize);
  const targetHeight = rect.h > 0 ? rect.h : baseSize;
  const scale = targetHeight / baseSize;
  const codes = stringToLr2CharCodes(value);
  // First pass — compute total advance so we can apply alignment. Per-glyph width MUST be measured the same way the
  // render pass below scales the sprite (`targetHeight / glyph.h`), not via the font-level `scale = targetHeight /
  // baseSize`. The two diverge whenever a glyph's source height differs from `#S` (LR2 spec calls this
  // rare-but-allowed). Mismatch caused the PLAY OPTION values to render right-shifted: layout underestimated their
  // width, the centering math added too much left padding, and the actual sprites then drew further right than the
  // centered bounding box.
  let totalAdvance = 0;
  const layout: Array<{
    glyph: Lr2FontGlyph | undefined;
    glyphScale: number;
    advance: number;
    width: number;
  }> = [];
  for (const code of codes) {
    const glyph = code !== undefined ? font.glyphs.get(code) : undefined;
    const glyphHeight = glyph ? Math.max(1, glyph.h) : Math.max(1, baseSize);
    const glyphScale = targetHeight / glyphHeight;
    const sourceWidth = glyph ? glyph.w : Math.max(1, baseSize / 2);
    const placedWidth = sourceWidth * glyphScale;
    // Spacing is a font-level metric in source pixels — it's tied to `#S` (the font's reference size), not per-glyph,
    // so we keep using `scale` for it.
    const advance = placedWidth + font.spacing * scale;
    layout.push({ glyph, glyphScale, advance, width: placedWidth });
    totalAdvance += advance;
  }
  // The last glyph contributes its own width but no trailing spacing — strip the spacing from the final advance so
  // right / center alignment doesn't push everything off by one.
  if (layout.length > 0) {
    totalAdvance -= font.spacing * scale;
  }
  // LR2 alignment is ANCHOR-based, not box-based: `x` is the alignment-dependent anchor point (left edge / horizontal
  // center / right edge), NOT a box origin paired with `w` as the box width.
  //
  // We position the inner glyph container relative to `(0, 0)` and translate the outer `root` to the anchor point. That
  // way applying a horizontal `scale.x` for the LR2-spec shrink-to-fit behavior squeezes around the anchor exactly (no
  // drift on right- / center-aligned text), and the per- glyph offsets remain in their native un-squeezed coordinate
  // space — easier to reason about than baking the squeeze into each cursor advance.
  let originX = 0;
  if (element.alignment === 'right') {
    originX = -totalAdvance;
  } else if (element.alignment === 'center') {
    originX = -totalAdvance / 2;
  }
  const inner = new Container();
  inner.label = 'lr2-bitmap-text/inner';
  const tint = (dst.r << 16) | (dst.g << 8) | dst.b;
  let cursorX = originX;
  for (const item of layout) {
    if (item.glyph) {
      const baseTexture = loaded.textures.get(item.glyph.gr);
      if (baseTexture) {
        const sprite = new Sprite(getGlyphTexture(baseTexture, item.glyph));
        // Scale the source glyph's own height to `targetHeight` — the LR2 spec key step: a glyph authored at e.g. 24 px
        // renders at the configured DST height regardless of the underlying source size.
        const glyphScale = targetHeight / item.glyph.h;
        sprite.scale.set(glyphScale, glyphScale);
        sprite.position.set(cursorX, 0);
        sprite.tint = tint;
        sprite.alpha = dst.alpha;
        inner.addChild(sprite);
      } else {
        inner.addChild(buildPlaceholderRect(cursorX, 0, item.width, targetHeight));
      }
    } else {
      inner.addChild(buildPlaceholderRect(cursorX, 0, item.width, targetHeight));
    }
    cursorX += item.advance;
  }
  // LR2 shrink-to-fit: when the rendered string is wider than `dst.w`, the spec auto-compresses it to fit
  // (`docs/LR2SkinHelp.md` line 1343: "表示文字列の横幅がDSTのw値を超えるサイズになった場合は自動的に縮小されます"). We squeeze the inner container's
  // `scale.x` so glyph height stays at `targetHeight` and only the horizontal stride compresses — same shape as the LR2
  // reference renderer (and why the spec calls `filter` "essentially required": the squeeze stretches glyphs
  // horizontally and looks jagged without bilinear filtering).
  if (rect.w > 0 && totalAdvance > rect.w) {
    inner.scale.x = rect.w / totalAdvance;
  }
  root.addChild(inner);
  root.position.set(rect.x, rect.y);
  return root;
}

/**
 * Translucent stroked rectangle used as a "missing glyph" marker. Mirrors how DxLib's debug build draws fallback boxes
 * for unmapped characters — the user sees that text *was* there even if the font couldn't render it. Rendered as
 * `Graphics` rather than a procedurally-built texture so we avoid taking up a slot in the texture cache for ephemeral
 * fallback cells.
 */
function buildPlaceholderRect(x: number, y: number, w: number, h: number): Graphics {
  const inset = 1;
  return new Graphics()
    .rect(x + inset, y + inset, Math.max(0, w - inset * 2), Math.max(0, h - inset * 2))
    .stroke({ color: 0xffffff, width: 1, alpha: 0.5 });
}
