import { Container, Text, TextStyle } from 'pixi.js';
import { normaliseRect } from './lr2-render.ts';
import type { Lr2DestinationRect, Lr2TextElement } from './lr2-skin.ts';
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
  const fontSize = clampFontSize(rect.h - 2, 8, options.maxFontSize ?? 18);
  const text = new Text({
    text: value,
    style: new TextStyle({
      fill: dst.alpha > 0 ? (dst.r << 16) | (dst.g << 8) | dst.b : 0xffffff,
      fontSize,
      fontFamily: 'system-ui, sans-serif',
      wordWrap: rect.w > 0,
      wordWrapWidth: rect.w > 0 ? rect.w : undefined,
      stroke: { color: 0x000000, width: 2, alignment: 0.5, join: 'round' },
    }),
  });
  text.label = `text[st=${element.st}]`;
  text.alpha = dst.alpha;
  if (element.alignment === 'center') {
    text.anchor.set(0.5, 0);
  } else if (element.alignment === 'right') {
    text.anchor.set(1, 0);
  } else {
    text.anchor.set(0, 0);
  }
  text.position.set(rect.x, rect.y);
  return text;
}

export function clampFontSize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
