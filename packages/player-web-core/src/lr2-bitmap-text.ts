import { Container, Graphics, Sprite, Texture, Rectangle } from 'pixi.js';
import type { Lr2DestinationRect, Lr2TextElement } from './lr2-skin.ts';
import { stringToLr2CharCodes, type Lr2BitmapFont, type Lr2FontGlyph } from './lr2-font.ts';
import { normaliseRect } from './lr2-render.ts';

/**
 * Loaded LR2 font payload — the parsed `.lr2font` metadata plus
 * one Pixi `Texture` per `#T <gr>` image declaration. The
 * renderer samples sub-rects from these textures by glyph and
 * stamps them at the destination position.
 */
export interface Lr2LoadedFont {
  font: Lr2BitmapFont;
  /** `#T <gr>` index → loaded texture. */
  textures: Map<number, Texture>;
}

/**
 * Stub-cache reused across renders. Pixi v8 holds renderer-side
 * state per `Texture` (atlas page, GraphicsContext), so re-using
 * the same cropped textures across frames keeps GPU memory bounded
 * even as the bar list rebuilds glyph sprites every frame.
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
 * Renders `value` into a Pixi `Container` using the supplied LR2
 * bitmap font. Mirrors `makeLr2TextSprite`'s contract: the returned
 * node is positioned per `dst.x` / `dst.y` and respects the
 * element's alignment (left / center / right).
 *
 * Glyph height is scaled to `dst.h` (which is the LR2 spec's "final
 * size") — the source-side `font.baseSize` is the reference
 * dimension, so the scale factor is `dst.h / font.baseSize`. A
 * mismatch between the glyph's own `h` and the font's `#S` value
 * is also handled (the LR2 spec calls this rare but possible).
 *
 * Characters with no glyph entry get a placeholder rectangle
 * (translucent outline) so unmapped text is visibly present rather
 * than silently dropped.
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
  const rect = normaliseRect(dst);
  const font = loaded.font;
  const baseSize = Math.max(1, font.baseSize);
  const targetHeight = rect.h > 0 ? rect.h : baseSize;
  const scale = targetHeight / baseSize;
  const codes = stringToLr2CharCodes(value);
  // First pass — compute total advance so we can apply alignment.
  let totalAdvance = 0;
  const layout: Array<{
    glyph: Lr2FontGlyph | undefined;
    advance: number;
    width: number;
  }> = [];
  for (const code of codes) {
    const glyph = code !== undefined ? font.glyphs.get(code) : undefined;
    const glyphWidth = glyph ? glyph.w : Math.max(1, baseSize / 2);
    const placedWidth = glyphWidth * scale;
    const advance = placedWidth + font.spacing * scale;
    layout.push({ glyph, advance, width: placedWidth });
    totalAdvance += advance;
  }
  // The last glyph contributes its own width but no trailing
  // spacing — strip the spacing from the final advance so right /
  // centre alignment doesn't push everything off by one.
  if (layout.length > 0) {
    totalAdvance -= font.spacing * scale;
  }
  let cursorX = rect.x;
  if (element.alignment === 'right') {
    cursorX = rect.x + (rect.w > 0 ? rect.w : 0) - totalAdvance;
  } else if (element.alignment === 'center') {
    cursorX = rect.x + ((rect.w > 0 ? rect.w : 0) - totalAdvance) / 2;
  }
  const tint = (dst.r << 16) | (dst.g << 8) | dst.b;
  for (const item of layout) {
    if (item.glyph) {
      const baseTexture = loaded.textures.get(item.glyph.gr);
      if (baseTexture) {
        const sprite = new Sprite(getGlyphTexture(baseTexture, item.glyph));
        // Scale the source glyph's own height to `targetHeight`
        // — this is the key step the LR2 spec calls out: a glyph
        // authored at e.g. 24 px renders at the configured DST
        // height regardless of the underlying source size.
        const glyphScale = targetHeight / item.glyph.h;
        sprite.scale.set(glyphScale, glyphScale);
        sprite.position.set(cursorX, rect.y);
        sprite.tint = tint;
        sprite.alpha = dst.alpha;
        root.addChild(sprite);
      } else {
        root.addChild(buildPlaceholderRect(cursorX, rect.y, item.width, targetHeight));
      }
    } else {
      root.addChild(buildPlaceholderRect(cursorX, rect.y, item.width, targetHeight));
    }
    cursorX += item.advance;
  }
  return root;
}

/**
 * Translucent stroked rectangle used as a "missing glyph" marker.
 * Mirrors how DxLib's debug build draws fallback boxes for
 * unmapped characters — the user sees that text *was* there even
 * if the font couldn't render it. Rendered as `Graphics` rather
 * than a procedurally-built texture so we avoid taking up a slot
 * in the texture cache for ephemeral fallback cells.
 */
function buildPlaceholderRect(x: number, y: number, w: number, h: number): Graphics {
  const inset = 1;
  return new Graphics()
    .rect(x + inset, y + inset, Math.max(0, w - inset * 2), Math.max(0, h - inset * 2))
    .stroke({ color: 0xffffff, width: 1, alpha: 0.5 });
}
