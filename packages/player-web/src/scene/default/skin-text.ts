import { type Color, type Container, Graphics, Text, TextStyle } from 'pixi.js';
import { resolveChartPlayVariant } from '../../collection/collection.ts';
import type { BrowserSongEntry } from '../../collection/types.ts';
import { getDesignTextResolution } from '../core/viewport.ts';
import { DEFAULT_TEXT_FONT } from './fonts.ts';
import { alignCapCenter } from './text-metrics.ts';

export interface SkinTextOptions {
  size?: number;
  weight?: '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';
  fill?: number | Color;
  fontFamily?: string;
  letterSpacing?: number;
  anchorX?: number;
  anchorY?: number;
  maxWidth?: number;
  skewX?: number;
  alpha?: number;
  stroke?: { color: number; width: number; alignment?: number; join?: 'round' | 'bevel' | 'miter' };
  /** Hard offset shadow (blur 0) at 45°. */
  dropShadow?: { color: number; distance: number; blur?: number; alpha?: number; angle?: number };
}

/**
 * One text node for built-in skin chrome that is rebuilt on input (select / result), squeezed horizontally to
 * `maxWidth` when needed. Per-frame HUD text uses pooled nodes instead (see the gameplay chrome renderers).
 */
export function addSkinText(layer: Container, text: string, x: number, y: number, options: SkinTextOptions = {}): Text {
  const node = new Text({
    text,
    // Rasterize at the final device density so text stays crisp after the viewport magnifies the design canvas.
    resolution: getDesignTextResolution(),
    style: resolveSkinTextStyle(options),
  });
  node.anchor.set(options.anchorX ?? 0, options.anchorY ?? 0);
  alignCapCenter(node, options.fontFamily ?? DEFAULT_TEXT_FONT, options.weight ?? '400', options.size ?? 10);
  node.position.set(x, y);
  node.skew.set(options.skewX ?? 0, 0);
  node.alpha = options.alpha ?? 1;
  if (options.maxWidth !== undefined && node.width > options.maxWidth) {
    node.scale.x = options.maxWidth / node.width;
  }
  layer.addChild(node);
  return node;
}

const SKIN_TEXT_STYLES = new Map<string, TextStyle>();

/**
 * The shared `TextStyle` for `options`. Pixi keys a text's texture by its style *instance*, so screens rebuilt every
 * frame must reuse one instance per look for unchanged labels to keep their texture instead of re-rasterizing.
 */
export function resolveSkinTextStyle(options: SkinTextOptions): TextStyle {
  const shadow = options.dropShadow;
  const stroke = options.stroke;
  const fill = options.fill ?? 0xffffff;
  const key = [
    typeof fill === 'number' ? fill : fill.toNumber(),
    options.size ?? 10,
    options.weight ?? '400',
    options.fontFamily ?? DEFAULT_TEXT_FONT,
    options.letterSpacing ?? 0,
    stroke ? `${stroke.color}/${stroke.width}/${stroke.alignment ?? ''}/${stroke.join ?? ''}` : '',
    shadow ? `${shadow.color}/${shadow.distance}/${shadow.blur ?? 0}/${shadow.alpha ?? 1}/${shadow.angle ?? ''}` : '',
  ].join('|');
  let style = SKIN_TEXT_STYLES.get(key);
  if (!style) {
    style = new TextStyle({
      fill,
      fontSize: options.size ?? 10,
      fontWeight: options.weight ?? '400',
      fontFamily: options.fontFamily ?? DEFAULT_TEXT_FONT,
      letterSpacing: options.letterSpacing ?? 0,
      stroke: options.stroke,
      // Room for the blurred glow; without it the shadow is clipped to the glyph box and shows as a hard rectangle.
      padding: shadow ? Math.ceil((shadow.blur ?? 0) * 2 + shadow.distance) : 0,
      ...(shadow
        ? {
            dropShadow: {
              color: shadow.color,
              alpha: shadow.alpha ?? 1,
              blur: shadow.blur ?? 0,
              distance: shadow.distance,
              angle: shadow.angle ?? Math.PI / 4,
            },
          }
        : {}),
    });
    SKIN_TEXT_STYLES.set(key, style);
  }
  return style;
}

/** `'7K KEYS'`-style mode label for a song's play variant. */
export function formatPlayVariantLabel(song: BrowserSongEntry): string {
  return `${resolveChartPlayVariant(song)} KEYS`;
}

/** Transparent click target that forwards `pointerdown` to `action`. */
export function addHitArea(
  layer: Container,
  x: number,
  y: number,
  w: number,
  h: number,
  cursor: string,
  action: () => void,
): void {
  const hit = new Graphics();
  hit.rect(x, y, w, h).fill({ color: 0xffffff, alpha: 0.001 });
  hit.eventMode = 'static';
  hit.cursor = cursor;
  hit.on('pointerdown', action);
  layer.addChild(hit);
}
