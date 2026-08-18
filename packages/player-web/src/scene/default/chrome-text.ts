import { Container, Text, TextStyle } from 'pixi.js';
import type { ChildPool } from '../pixi-utils.ts';
import { DEFAULT_TEXT_FONT } from './fonts.ts';
import { DEFAULT_THEME } from './theme.ts';

export type ChromeTextWeight = '400' | '500' | '600' | '700' | '800' | '900';

export interface ChromeTextOptions {
  size?: number;
  weight?: ChromeTextWeight;
  fill?: number;
  fontFamily?: string;
  letterSpacing?: number;
  anchorX?: number;
  anchorY?: number;
  maxWidth?: number;
  rotation?: number;
  slam?: number;
  offsetX?: number;
  offsetY?: number;
  alpha?: number;
  stroke?: { color: number; width: number; alignment?: number; join?: 'round' | 'bevel' | 'miter' };
  dropShadow?: { color: number; alpha: number; blur: number; distance: number };
}

const TEXT_STYLE_CACHE = new Map<string, TextStyle>();

/**
 * Pooled (or one-shot) stamp text. Always writes scale / rotation / alpha so a recycled `Text` from {@link ChildPool}
 * cannot leak the previous pass's slam.
 */
export function addChromeText(
  layer: Container,
  text: string,
  x: number,
  y: number,
  opts: ChromeTextOptions = {},
  pool?: ChildPool,
): Text {
  const node = pool?.acquireText() ?? new Text();
  const style = resolveChromeTextStyle(opts);
  node.text = text;
  if (node.style !== style) {
    node.style = style;
  }
  node.anchor.set(opts.anchorX ?? 0, opts.anchorY ?? 0);
  node.position.set(x + (opts.offsetX ?? 0), y + (opts.offsetY ?? 0));
  node.rotation = opts.rotation ?? 0;
  node.alpha = opts.alpha ?? 1;
  node.scale.set(1, 1);
  let widthScale = 1;
  if (opts.maxWidth !== undefined && node.width > opts.maxWidth) {
    widthScale = opts.maxWidth / node.width;
  }
  const slam = opts.slam ?? 1;
  node.scale.set(widthScale * slam, slam);
  if (!pool) {
    layer.addChild(node);
  }
  return node;
}

function resolveChromeTextStyle(opts: ChromeTextOptions): TextStyle {
  const stroke = opts.stroke;
  const shadow = opts.dropShadow;
  const key = [
    opts.fill ?? DEFAULT_THEME.paper,
    opts.size ?? 10,
    opts.weight ?? '400',
    opts.fontFamily ?? DEFAULT_TEXT_FONT,
    opts.letterSpacing ?? 0,
    stroke?.color ?? '',
    stroke?.width ?? '',
    stroke?.alignment ?? '',
    stroke?.join ?? '',
    shadow?.color ?? '',
    shadow?.alpha ?? '',
    shadow?.blur ?? '',
    shadow?.distance ?? '',
  ].join('|');
  let style = TEXT_STYLE_CACHE.get(key);
  if (!style) {
    style = new TextStyle({
      fill: opts.fill ?? DEFAULT_THEME.paper,
      fontSize: opts.size ?? 10,
      fontWeight: opts.weight ?? '400',
      fontFamily: opts.fontFamily ?? DEFAULT_TEXT_FONT,
      letterSpacing: opts.letterSpacing ?? 0,
      stroke: opts.stroke,
      ...(shadow
        ? {
            dropShadow: {
              color: shadow.color,
              alpha: shadow.alpha,
              blur: shadow.blur,
              distance: shadow.distance,
              angle: Math.PI / 2,
            },
          }
        : {}),
    });
    TEXT_STYLE_CACHE.set(key, style);
  }
  return style;
}
