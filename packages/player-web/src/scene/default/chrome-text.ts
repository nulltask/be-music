import { Text, TextStyle, type Container } from 'pixi.js';
import type { ChildPool } from '../pixi-utils.ts';
import { DEFAULT_TEXT_FONT } from './fonts.ts';
import { DEFAULT_THEME } from './theme.ts';

export interface ChromeTextOpts {
  size?: number;
  weight?: '400' | '500' | '600' | '700' | '800' | '900';
  fill?: number;
  fontFamily?: string;
  letterSpacing?: number;
  anchorX?: number;
  anchorY?: number;
  maxWidth?: number;
  alpha?: number;
  rotation?: number;
  scale?: number;
  stroke?: { color: number; width: number; alignment?: number; join?: 'round' | 'bevel' | 'miter' };
  dropShadow?: { color: number; alpha: number; blur: number; distance: number };
}

/**
 * Pooled/unpooled text. Always writes scale / rotation / alpha so ChildPool reuse cannot leak a previous slam.
 */
export function addChromeText(
  layer: Container,
  text: string,
  x: number,
  y: number,
  opts: ChromeTextOpts = {},
  pool?: ChildPool,
): Text {
  const node = pool?.acquireText() ?? new Text();
  const style = resolveTextStyle(opts);
  node.text = text;
  if (node.style !== style) node.style = style;
  node.anchor.set(opts.anchorX ?? 0, opts.anchorY ?? 0);
  node.position.set(x, y);
  node.rotation = opts.rotation ?? 0;
  node.alpha = opts.alpha ?? 1;
  const punch = opts.scale ?? 1;
  node.scale.set(punch, punch);
  if (opts.maxWidth !== undefined && node.width > opts.maxWidth) {
    node.scale.x = (opts.maxWidth / node.width) * punch;
  }
  if (!pool) layer.addChild(node);
  return node;
}

function resolveTextStyle(opts: ChromeTextOpts): TextStyle {
  const stroke = opts.stroke;
  const shadow = opts.dropShadow;
  const key = [
    opts.fill ?? DEFAULT_THEME.white,
    opts.size ?? 10,
    opts.weight ?? '500',
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
      fill: opts.fill ?? DEFAULT_THEME.white,
      fontSize: opts.size ?? 10,
      fontWeight: opts.weight ?? '500',
      fontFamily: opts.fontFamily ?? DEFAULT_TEXT_FONT,
      letterSpacing: opts.letterSpacing ?? 0,
      stroke: opts.stroke,
      ...(shadow
        ? { dropShadow: { color: shadow.color, alpha: shadow.alpha, blur: shadow.blur, distance: shadow.distance, angle: Math.PI / 2 } }
        : {}),
    });
    TEXT_STYLE_CACHE.set(key, style);
  }
  return style;
}

const TEXT_STYLE_CACHE = new Map<string, TextStyle>();
