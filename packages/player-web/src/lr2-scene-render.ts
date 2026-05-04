import { Container, Text, TextStyle } from 'pixi.js';
import { normaliseRect } from './lr2-render.ts';
import type { Lr2DestinationRect, Lr2TextElement } from '@be-music/lr2-skin';
import { makeLr2BitmapTextSprite, type Lr2LoadedFont } from './lr2-bitmap-text.ts';

export interface ScaledViewport {
  x: number;
  y: number;
  scale: number;
}

export interface Lr2TextSpriteOptions {
  maxFontSize?: number;
  /**
   * Loaded LR2 bitmap fonts keyed by font index (`#LR2FONT`
   * declaration order). When the element's `font` field hits a
   * loaded entry, `makeLr2TextSprite` returns a bitmap-text
   * `Container` instead of the system-font `Text` fallback —
   * matching what real LR2 paints with `#SRC_TEXT`.
   */
  bitmapFonts?: ReadonlyMap<number, Lr2LoadedFont>;
  /**
   * `#FONT,size,...` declarations indexed by the same global
   * font slot as `bitmapFonts`. Used by the system-font fallback
   * branch to pick the size the skin actually asked for —
   * without this, every system-font label collapses to the
   * generic `rect.h - 2` heuristic and visibly disagrees with
   * the LR2 reference (e.g. the LR2 default theme's PLAY OPTION
   * row declares `#FONT,18,...` but the rect height is closer to
   * 30, so the heuristic over-shoots).
   */
  systemFontSizes?: ReadonlyArray<number>;
}

export function resolveScaledViewport(
  screenWidth: number,
  screenHeight: number,
  designWidth: number,
  designHeight: number,
): ScaledViewport {
  const scale = Math.min(screenWidth / designWidth, screenHeight / designHeight);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    x: (screenWidth - designWidth * safeScale) / 2,
    y: (screenHeight - designHeight * safeScale) / 2,
    scale: safeScale,
  };
}

export function isDestinationVisible(
  destination: Lr2DestinationRect,
  ops: ReadonlySet<number>,
  timerActive: (timer: number) => boolean,
): boolean {
  if (!timerActive(destination.timer)) {
    return false;
  }
  for (const op of destination.ops) {
    if (op === 0) continue;
    if (op > 0) {
      if (!ops.has(op)) {
        return false;
      }
    } else if (ops.has(-op)) {
      return false;
    }
  }
  return true;
}

/**
 * Renders an LR2 `#SRC_TEXT` element into a Pixi node — a bitmap-
 * font `Container` when the element's `font` index points at a
 * loaded `#LR2FONT`, or a system-font `Text` fallback otherwise.
 *
 * Returning a `Container` (instead of `Text` specifically) is the
 * union of both paths; callers attach the result with
 * `addChild` either way, which is the only API contract the
 * scene renderers rely on.
 */
export function makeLr2TextSprite(
  value: string,
  element: Lr2TextElement,
  dst: Lr2DestinationRect = element.destination,
  options: Lr2TextSpriteOptions = {},
): Container {
  // Bitmap path — chosen when the host loaded the matching
  // `#LR2FONT` payload. Empty strings are still painted as an
  // empty Container so the caller's `addChild` doesn't need to
  // null-check; the visible result is just nothing, same as the
  // text fallback would produce for "".
  const loaded = options.bitmapFonts?.get(element.font);
  if (loaded) {
    return makeLr2BitmapTextSprite(value, element, dst, loaded);
  }
  const rect = normaliseRect(dst);
  // Prefer the size declared by the skin's `#FONT` for this slot.
  // Falls back to the rect-height heuristic only when there's no
  // declaration at all (e.g. older skins that omit `#FONT` and
  // rely on rect-driven sizing). The clamp still applies as a
  // safety net — a malformed `#FONT,9999` shouldn't blow out the
  // text bounds.
  const declaredSize = options.systemFontSizes?.[element.font];
  const desiredSize = declaredSize !== undefined && declaredSize > 0 ? declaredSize : rect.h - 2;
  const fontSize = clampFontSize(desiredSize, 8, options.maxFontSize ?? 64);
  // No `wordWrap` — LR2's `#SRC_TEXT` spec calls for HORIZONTAL
  // shrink-to-fit when the rendered string overruns `dst.w`
  // (`docs/LR2SkinHelp.md` line 1343), not for line-wrapping.
  // Letting the text overflow on a single line and then
  // squeezing it via `scale.x` matches that semantic.
  const text = new Text({
    text: value,
    style: new TextStyle({
      fill: dst.alpha > 0 ? (dst.r << 16) | (dst.g << 8) | dst.b : 0xffffff,
      fontSize,
      fontFamily: 'system-ui, sans-serif',
      stroke: { color: 0x000000, width: 2, alignment: 0.5, join: 'round' },
    }),
  });
  text.label = `text[st=${element.st}]`;
  text.alpha = dst.alpha;
  // LR2 alignment is ANCHOR-based: `dst.x` is the
  // alignment-dependent anchor point (left edge / centre / right
  // edge), not a box origin paired with `dst.w` as a box width.
  // See `lr2-bitmap-text.ts` for the empirical justification —
  // same skin-author convention applies to the system-font path.
  if (element.alignment === 'center') {
    text.anchor.set(0.5, 0);
  } else if (element.alignment === 'right') {
    text.anchor.set(1, 0);
  } else {
    text.anchor.set(0, 0);
  }
  text.position.set(rect.x, rect.y);
  // LR2 shrink-to-fit: when the rendered string overflows the
  // DST's `w`, compress it horizontally so it lands inside the
  // authored rectangle. Pixi `Text.width` is the post-style
  // bounds width, so we can read it immediately after
  // construction. The `scale` applies around the text's anchor
  // (0 / 0.5 / 1 above), which keeps the alignment edge fixed
  // — left-aligned text squeezes toward `rect.x`, right-aligned
  // squeezes toward `rect.x` (right edge), centre stays
  // centred on `rect.x`.
  if (rect.w > 0 && text.width > rect.w) {
    text.scale.x = rect.w / text.width;
  }
  return text;
}

export function clampFontSize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
