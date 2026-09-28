import { CanvasTextMetrics, type Container, Text, TextStyle } from 'pixi.js';
import type { ChildPool } from '../pixi-utils.ts';
import { DEFAULT_TEXT_FONT } from './fonts.ts';
import { layoutTabularRun } from './phantom-style.ts';

/**
 * Per-frame HUD text for built-in skins. Nodes come from a {@link ChildPool} when one is given (so a 60 fps redraw
 * reuses parented `Text` objects), styles are cached by value, and {@link addHudNumber} lays numerals out with tabular
 * figures.
 */

type TextWeight = '300' | '400' | '500' | '600' | '700' | '800' | '900';

export interface HudTextOptions {
  size?: number;
  weight?: TextWeight;
  fill?: number;
  fontFamily?: string;
  letterSpacing?: number;
  anchorX?: number;
  anchorY?: number;
  maxWidth?: number;
  /** Horizontal skew in radians (negative leans the glyph tops right, like italic). */
  skewX?: number;
  rotation?: number;
  stroke?: { color: number; width: number; alignment?: number; join?: 'round' | 'bevel' | 'miter' };
  dropShadow?: { color: number; alpha: number; blur: number; distance: number; angle?: number };
}

export function addHudText(
  layer: Container,
  text: string,
  x: number,
  y: number,
  opts: HudTextOptions = {},
  pool?: ChildPool,
): Text {
  const node = pool?.acquireText() ?? new Text();
  const style = resolveTextStyle(opts);
  node.text = text;
  if (node.style !== style) {
    node.style = style;
  }
  node.anchor.set(opts.anchorX ?? 0, opts.anchorY ?? 0);
  node.position.set(x, y);
  node.scale.set(1, 1);
  // Pooled texts keep their previous skew / rotation, so both are always written.
  node.skew.set(opts.skewX ?? 0, 0);
  node.rotation = opts.rotation ?? 0;
  if (opts.maxWidth !== undefined && node.width > opts.maxWidth) {
    node.scale.x = opts.maxWidth / node.width;
  }
  if (!pool) {
    layer.addChild(node);
  }
  return node;
}

/**
 * Numeric readout with tabular figures: each glyph is its own pooled text centred in a fixed-width cell (see
 * `layoutTabularRun`), so a changing score or combo never shifts sideways as its digits change.
 */
export function addHudNumber(
  layer: Container,
  text: string,
  x: number,
  y: number,
  opts: HudTextOptions = {},
  pool?: ChildPool,
): void {
  const style = resolveTextStyle(opts);
  const run = layoutTabularRun(text, (char) => measureGlyph(char, style));
  const squeeze = opts.maxWidth !== undefined && run.width > opts.maxWidth ? opts.maxWidth / run.width : 1;
  const left = x - run.width * squeeze * (opts.anchorX ?? 0);
  for (const glyph of run.glyphs) {
    if (glyph.char === ' ') continue;
    const node = addHudText(
      layer,
      glyph.char,
      left + (glyph.x + glyph.w / 2) * squeeze,
      y,
      { ...opts, anchorX: 0.5, maxWidth: undefined },
      pool,
    );
    node.scale.x = squeeze;
  }
}

const GLYPH_WIDTH_CACHE = new Map<TextStyle, Map<string, number>>();

function measureGlyph(char: string, style: TextStyle): number {
  let widths = GLYPH_WIDTH_CACHE.get(style);
  if (!widths) {
    widths = new Map();
    GLYPH_WIDTH_CACHE.set(style, widths);
  }
  let width = widths.get(char);
  if (width === undefined) {
    // Letter spacing is part of the advance; stroke width is not, so strip it from the measured box.
    width = CanvasTextMetrics.measureText(char, style).width - (style._stroke?.width ?? 0);
    widths.set(char, width);
  }
  return width;
}

function resolveTextStyle(opts: HudTextOptions): TextStyle {
  const stroke = opts.stroke;
  const shadow = opts.dropShadow;
  const key = [
    opts.fill ?? 0xffffff,
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
    shadow?.angle ?? '',
  ].join('|');
  let style = TEXT_STYLE_CACHE.get(key);
  if (!style) {
    style = new TextStyle({
      fill: opts.fill ?? 0xffffff,
      fontSize: opts.size ?? 10,
      fontWeight: opts.weight ?? '500',
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
              angle: shadow.angle ?? Math.PI / 2,
            },
          }
        : {}),
    });
    TEXT_STYLE_CACHE.set(key, style);
  }
  return style;
}

const TEXT_STYLE_CACHE = new Map<string, TextStyle>();
