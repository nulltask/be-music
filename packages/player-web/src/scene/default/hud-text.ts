import { CanvasTextMetrics, type Container, Text, TextStyle } from 'pixi.js';
import type { ChildPool } from '../pixi-utils.ts';
import { getDesignTextResolution } from '../core/viewport.ts';
import { DEFAULT_TEXT_FONT } from './fonts.ts';
import { layoutTabularRun } from './phantom-style.ts';
import { alignCapCenter } from './text-metrics.ts';

/**
 * Per-frame HUD text for built-in skins. Nodes come from a {@link ChildPool} when one is given (so a 60 fps redraw
 * reuses parented `Text` objects), styles are cached by value, and {@link addHudNumber} lays numerals out with tabular
 * figures.
 */

type TextWeight = '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';

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
  /** Uniform scale around the anchor, applied after the `maxWidth` squeeze (judge / combo "punch"). */
  scale?: number;
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
  // Rasterize at the final device density so text stays crisp after the viewport magnifies the design canvas.
  const resolution = getDesignTextResolution();
  if (node.resolution !== resolution) {
    node.resolution = resolution;
  }
  // A plain fill (no stroke or shadow to keep their own colours) rasterizes white and takes its colour from the tint, so
  // a colour change — a flashing judgement, a combo turning gold — reuses the glyph texture instead of re-rendering it.
  const tintable = isTintable(opts);
  const style = resolveTextStyle(opts, tintable);
  node.text = text;
  if (node.style !== style) {
    node.style = style;
  }
  node.tint = tintable ? (opts.fill ?? 0xffffff) : 0xffffff;
  node.anchor.set(opts.anchorX ?? 0, opts.anchorY ?? 0);
  alignCapCenter(node, opts.fontFamily ?? DEFAULT_TEXT_FONT, opts.weight ?? '500', opts.size ?? 10);
  node.position.set(x, y);
  node.scale.set(1, 1);
  // Pooled texts keep their previous skew / rotation, so both are always written.
  node.skew.set(opts.skewX ?? 0, 0);
  node.rotation = opts.rotation ?? 0;
  if (opts.maxWidth !== undefined && node.width > opts.maxWidth) {
    node.scale.x = opts.maxWidth / node.width;
  }
  if (opts.scale !== undefined && opts.scale !== 1) {
    node.scale.x *= opts.scale;
    node.scale.y = opts.scale;
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
  const style = resolveTextStyle(opts, isTintable(opts));
  const run = layoutTabularRun(text, (char) => measureGlyph(char, style));
  const squeeze = opts.maxWidth !== undefined && run.width > opts.maxWidth ? opts.maxWidth / run.width : 1;
  const scale = opts.scale ?? 1;
  const left = x - run.width * squeeze * scale * (opts.anchorX ?? 0);
  for (const glyph of run.glyphs) {
    if (glyph.char === ' ') continue;
    const node = addHudText(
      layer,
      glyph.char,
      left + (glyph.x + glyph.w / 2) * squeeze * scale,
      y,
      { ...opts, anchorX: 0.5, maxWidth: undefined, scale: undefined },
      pool,
    );
    node.scale.set(squeeze * scale, scale);
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

/** Whether `opts` paints a plain fill, which {@link addHudText} applies as a tint over a white raster. */
function isTintable(opts: HudTextOptions): boolean {
  return opts.stroke === undefined && opts.dropShadow === undefined;
}

function resolveTextStyle(opts: HudTextOptions, whiteFill = false): TextStyle {
  const stroke = opts.stroke;
  const shadow = opts.dropShadow;
  const fill = whiteFill ? 0xffffff : (opts.fill ?? 0xffffff);
  const key = [
    fill,
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
      fill,
      fontSize: opts.size ?? 10,
      fontWeight: opts.weight ?? '500',
      fontFamily: opts.fontFamily ?? DEFAULT_TEXT_FONT,
      letterSpacing: opts.letterSpacing ?? 0,
      stroke: opts.stroke,
      // Room for the blurred glow; without it the shadow is clipped to the glyph box and shows as a hard rectangle.
      padding: shadow ? Math.ceil(shadow.blur * 2 + shadow.distance) : 0,
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
