import type { Container, Graphics } from 'pixi.js';
import type { ChildPool } from '../../pixi-utils.ts';
import { addHudText, type HudTextOptions } from '../hud-text.ts';
import { addSkinText, type SkinTextOptions } from '../skin-text.ts';
import { digitTransitions, needleAngle, springEase, type NeedleFieldInput } from './field.ts';
import { LAT_ACCENT, LAT_DISPLAY_FONT, LAT_GRAPHITE, LAT_GRID, LAT_INK, LAT_MONO_FONT, LAT_RULE } from './style.ts';

/**
 * Shared Lattice drawing: the graph-paper grid, the needle field, ruler ticks, per-letter staggered type, and the
 * odometer counter. Callers own the `Graphics` / pools; these only append geometry and text.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Faint graph-paper rules every {@link LAT_GRID} px inside `area`, skipping `hole` (a live BGA) when given. */
export function drawPaperGrid(graphics: Graphics, area: Rect, alpha: number, hole?: Rect): void {
  const right = area.x + area.w;
  const bottom = area.y + area.h;
  for (let x = Math.ceil(area.x / LAT_GRID) * LAT_GRID; x <= right; x += LAT_GRID) {
    if (hole && x > hole.x && x < hole.x + hole.w) {
      graphics
        .moveTo(x, area.y)
        .lineTo(x, hole.y)
        .moveTo(x, hole.y + hole.h)
        .lineTo(x, bottom);
    } else {
      graphics.moveTo(x, area.y).lineTo(x, bottom);
    }
  }
  for (let y = Math.ceil(area.y / LAT_GRID) * LAT_GRID; y <= bottom; y += LAT_GRID) {
    if (hole && y > hole.y && y < hole.y + hole.h) {
      graphics
        .moveTo(area.x, y)
        .lineTo(hole.x, y)
        .moveTo(hole.x + hole.w, y)
        .lineTo(right, y);
    } else {
      graphics.moveTo(area.x, y).lineTo(right, y);
    }
  }
  graphics.stroke({ color: LAT_RULE, width: 1, alpha, pixelLine: true });
}

/**
 * The needle field: one short stroke per grid point in `area`, oriented by {@link needleAngle}. Needles that the field
 * has turned far from rest grow and switch to the accent colour, so waves read as travelling light. Two strokes total.
 */
export function drawNeedleField(
  graphics: Graphics,
  area: Rect,
  input: NeedleFieldInput,
  options: { pitch?: number; length?: number; alpha?: number; skip?: (x: number, y: number) => boolean } = {},
): void {
  const pitch = options.pitch ?? LAT_GRID / 2;
  const length = options.length ?? 4.5;
  const accentPath: number[] = [];
  const x0 = Math.ceil(area.x / pitch) * pitch;
  const y0 = Math.ceil(area.y / pitch) * pitch;
  let inkCount = 0;
  for (let y = y0; y <= area.y + area.h; y += pitch) {
    for (let x = x0; x <= area.x + area.w; x += pitch) {
      if (options.skip?.(x, y)) continue;
      const angle = needleAngle(x, y, input);
      let turn = Math.abs((((angle - Math.PI / 4) % Math.PI) + Math.PI) % Math.PI);
      turn = Math.min(turn, Math.PI - turn) / (Math.PI / 2);
      const half = (length * (1 + 0.7 * turn)) / 2;
      const dx = Math.cos(angle) * half;
      const dy = Math.sin(angle) * half;
      if (turn > 0.45) {
        accentPath.push(x - dx, y - dy, x + dx, y + dy);
      } else {
        graphics.moveTo(x - dx, y - dy).lineTo(x + dx, y + dy);
        inkCount += 1;
      }
    }
  }
  const alpha = options.alpha ?? 0.5;
  if (inkCount > 0) graphics.stroke({ color: LAT_INK, width: 0.75, alpha: alpha * 0.55 });
  for (let index = 0; index < accentPath.length; index += 4) {
    graphics.moveTo(accentPath[index]!, accentPath[index + 1]!).lineTo(accentPath[index + 2]!, accentPath[index + 3]!);
  }
  if (accentPath.length > 0) graphics.stroke({ color: LAT_ACCENT, width: 1, alpha: Math.min(1, alpha * 1.6) });
}

/** Ruler ticks along a horizontal edge: a long tick every `major` px, short ones every `minor`. */
export function drawRulerTicks(
  graphics: Graphics,
  x: number,
  y: number,
  w: number,
  direction: 1 | -1,
  color = LAT_INK,
  alpha = 0.6,
  minor = 5,
  major = 20,
): void {
  for (let offset = 0; offset <= w + 1e-6; offset += minor) {
    const long = Math.round(offset) % major === 0;
    graphics.moveTo(x + offset, y).lineTo(x + offset, y + direction * (long ? 5 : 2.5));
  }
  graphics.stroke({ color, width: 1, alpha });
}

/** Per-letter motion for {@link addStaggeredHudText}: offset, opacity, and scale of letter `index` of `count`. */
export type LetterMotion = (
  index: number,
  count: number,
) => { dx?: number; dy?: number; alpha?: number; scale?: number };

/**
 * Pooled HUD text laid out letter by letter so each glyph can move on its own (kinetic typography). `anchorX` of
 * `options` aligns the whole word; letters keep proportional advances.
 */
export function addStaggeredHudText(
  layer: Container,
  text: string,
  x: number,
  y: number,
  options: HudTextOptions,
  pool: ChildPool,
  motion: LetterMotion,
): void {
  const chars = Array.from(text);
  const nodes = chars.map((char) =>
    addHudText(layer, char, 0, y, { ...options, anchorX: 0, maxWidth: undefined, scale: undefined }, pool),
  );
  const widths = nodes.map((node) => node.width);
  const total = widths.reduce((sum, width) => sum + width, 0);
  let cursor = x - total * (options.anchorX ?? 0);
  nodes.forEach((node, index) => {
    const move = motion(index, nodes.length);
    const scale = move.scale ?? 1;
    // Scale each glyph around its own centre.
    node.anchor.set(0.5, options.anchorY ?? 0);
    node.position.set(cursor + widths[index]! / 2 + (move.dx ?? 0), y + (move.dy ?? 0));
    node.scale.set(scale);
    node.alpha = move.alpha ?? 1;
    cursor += widths[index]!;
  });
}

/**
 * Odometer counter: tabular digits where every wheel that turned since `previous` rolls in from below with a spring
 * while its old digit slides out upward. `t` is the roll progress (0..1) since the count changed.
 */
export function addOdometer(
  layer: Container,
  value: number,
  previous: number,
  t: number,
  x: number,
  y: number,
  options: HudTextOptions & { cell: number; travel: number },
  pool: ChildPool,
): void {
  const digits = digitTransitions(previous, value);
  const width = digits.length * options.cell;
  const left = x - width * (options.anchorX ?? 0);
  const roll = springEase(Math.max(0, Math.min(1, t)), 2, 0.5);
  const base: HudTextOptions = { ...options, anchorX: 0.5, maxWidth: undefined };
  digits.forEach((digit, index) => {
    const cx = left + options.cell * (index + 0.5);
    if (!digit.changed || t >= 1) {
      addHudText(layer, digit.char, cx, y, base, pool);
      return;
    }
    const incoming = addHudText(layer, digit.char, cx, y + options.travel * (1 - roll), base, pool);
    incoming.alpha = Math.min(1, roll * 1.4);
    if (digit.previous) {
      const outgoing = addHudText(layer, digit.previous, cx, y - options.travel * Math.min(1, roll), base, pool);
      outgoing.alpha = Math.max(0, 1 - roll * 1.6);
    }
  });
}

/** Small index / label type: Azeret Mono 9 px. */
export function monoStyle(fill: number = LAT_GRAPHITE): HudTextOptions {
  return { size: 9, weight: '500', fill, fontFamily: LAT_MONO_FONT, letterSpacing: 0.6 };
}

/** Inter display type; thin weights for large figures. */
export function displayStyle(
  size: number,
  fill: number,
  weight: '200' | '300' | '400' | '600' = '300',
): HudTextOptions {
  return { size, fill, fontFamily: LAT_DISPLAY_FONT, weight };
}

/**
 * Non-pooled twin of {@link addStaggeredHudText} for scenes rebuilt per render (select / result). A word wider than
 * `options.maxWidth` is squeezed as a whole, letters and advances alike.
 */
export function addStaggeredSkinText(
  layer: Container,
  text: string,
  x: number,
  y: number,
  options: SkinTextOptions,
  motion: LetterMotion,
): void {
  const chars = Array.from(text);
  const nodes = chars.map((char) => addSkinText(layer, char, 0, y, { ...options, anchorX: 0, maxWidth: undefined }));
  const widths = nodes.map((node) => node.width);
  const total = widths.reduce((sum, width) => sum + width, 0);
  const squeeze = options.maxWidth !== undefined && total > options.maxWidth ? options.maxWidth / total : 1;
  let cursor = x - total * squeeze * (options.anchorX ?? 0);
  const baseAlpha = options.alpha ?? 1;
  nodes.forEach((node, index) => {
    const move = motion(index, nodes.length);
    const scale = move.scale ?? 1;
    const advance = widths[index]! * squeeze;
    node.anchor.set(0.5, options.anchorY ?? 0);
    node.position.set(cursor + advance / 2 + (move.dx ?? 0), y + (move.dy ?? 0));
    node.scale.set(scale * squeeze, scale);
    node.alpha = baseAlpha * (move.alpha ?? 1);
    cursor += advance;
  });
}
