import { Text, TextStyle } from 'pixi.js';
import { normaliseRect } from './lr2-render.ts';
import type { Lr2DestinationRect, Lr2TextElement } from './lr2-skin.ts';

export interface ScaledViewport {
  x: number;
  y: number;
  scale: number;
}

export interface Lr2TextSpriteOptions {
  maxFontSize?: number;
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

export function makeLr2TextSprite(
  value: string,
  element: Lr2TextElement,
  dst: Lr2DestinationRect = element.destination,
  options: Lr2TextSpriteOptions = {},
): Text {
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
