import { hash01 } from '@be-music/skin-sdk';
import type { Graphics } from 'pixi.js';

/**
 * "Phantom" visual language shared by the default skin family's gameplay, select, and result chrome: a three-ink
 * poster palette (blood red / ink black / paper white), slanted parallelogram plates, jagged starbursts, and halftone
 * dot fields. The shape helpers are pure and return flat `[x0, y0, x1, y1, ...]` point lists so the Pixi renderers can
 * hand them straight to `Graphics.poly()`.
 */

export const PHANTOM_RED = 0xe60019;
export const PHANTOM_RED_HOT = 0xff2b45;
export const PHANTOM_RED_DEEP = 0x6e0010;
export const PHANTOM_INK = 0x000000;
export const PHANTOM_BLACK = 0x0c0c0e;
export const PHANTOM_CHARCOAL = 0x1a1a1d;
export const PHANTOM_SLATE = 0x2c2c31;
export const PHANTOM_WHITE = 0xffffff;
export const PHANTOM_PAPER = 0xf4f1ea;
export const PHANTOM_ASH = 0x8d8a93;
/** Single warm accent reserved for "money" moments (PERFECT, high combo, top rank) so red stays the base ink. */
export const PHANTOM_GOLD = 0xffd21f;
export const PHANTOM_CYAN = 0x4fd8ff;
export const PHANTOM_ORANGE = 0xff8a1f;

/**
 * Parallelogram with horizontal top / bottom edges. `slant` shifts the top edge right relative to the bottom edge
 * (positive leans like italic type). The bounding box is `[x, x + w + max(0, slant)]` horizontally — the bottom-left
 * corner stays anchored at `(x, y + h)`.
 */
export function parallelogramPoints(x: number, y: number, w: number, h: number, slant: number): number[] {
  const topShift = Math.max(0, slant);
  const bottomShift = Math.max(0, -slant);
  return [x + topShift, y, x + w + topShift, y, x + w + bottomShift, y + h, x + bottomShift, y + h];
}

/**
 * Jagged comic starburst. Spikes alternate between `outerRadius` and `innerRadius`; `jitter` (0..1) roughens the
 * outer tips deterministically from `seed` so the burst reads hand-cut instead of a perfect star, while staying
 * stable frame to frame for the same seed.
 */
export function starburstPoints(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  spikes: number,
  rotation = 0,
  jitter = 0,
  seed = 1,
): number[] {
  const count = Math.max(3, Math.floor(spikes));
  const points: number[] = [];
  for (let index = 0; index < count * 2; index += 1) {
    const outer = index % 2 === 0;
    const angle = rotation + (Math.PI * index) / count;
    const roughness = outer && jitter > 0 ? 1 - jitter * hash01(seed * 131 + index) : 1;
    const radius = (outer ? outerRadius : innerRadius) * roughness;
    points.push(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
  }
  return points;
}

export interface HalftoneDot {
  x: number;
  y: number;
  r: number;
}

export interface HalftoneFieldOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Grid pitch between dot centres. */
  pitch: number;
  /** Dot radius where the ramp is at full strength. */
  maxRadius: number;
  /**
   * Direction the dots grow toward, as a unit-ish vector. `{ x: 1, y: 0 }` makes dots swell left → right. The ramp is
   * measured across the field's projected extent, so any direction covers 0..1 over the rectangle.
   */
  direction: { x: number; y: number };
  /** Radii below this are dropped entirely so the fade end stays clean. Defaults to 0.35 px. */
  minRadius?: number;
}

/**
 * Halftone dot field on a staggered grid: every other row is offset by half a pitch, and each dot's radius ramps
 * linearly along `direction`. Returns only the dots that survive `minRadius`, so callers can loop and `circle()` them.
 */
export function halftoneField(options: HalftoneFieldOptions): HalftoneDot[] {
  const { x, y, w, h, pitch, maxRadius } = options;
  if (pitch <= 0 || w <= 0 || h <= 0 || maxRadius <= 0) return [];
  const minRadius = options.minRadius ?? 0.35;
  const length = Math.hypot(options.direction.x, options.direction.y) || 1;
  const dx = options.direction.x / length;
  const dy = options.direction.y / length;
  // Project the rectangle's corners onto the direction to find the ramp's 0..1 span.
  const projections = [0, w * dx, h * dy, w * dx + h * dy];
  const rampStart = Math.min(...projections);
  const rampSpan = Math.max(...projections) - rampStart || 1;
  const dots: HalftoneDot[] = [];
  let row = 0;
  for (let py = y; py <= y + h; py += pitch, row += 1) {
    const offset = row % 2 === 0 ? 0 : pitch / 2;
    for (let px = x + offset; px <= x + w; px += pitch) {
      const ramp = ((px - x) * dx + (py - y) * dy - rampStart) / rampSpan;
      const r = maxRadius * Math.max(0, Math.min(1, ramp));
      if (r >= minRadius) {
        dots.push({ x: px, y: py, r });
      }
    }
  }
  return dots;
}

/**
 * Phantom's own mark: a slanted eighth note (tilted oval head, stem, and a knife-cut flag) — the skin's signature, set
 * into the header and the result card so the poster language reads as *this* rhythm game rather than a borrowed one.
 * `size` is the overall height; `(x, y)` is the head's centre.
 */
export function drawNoteEmblem(
  graphics: Graphics,
  x: number,
  y: number,
  size: number,
  color: number,
  ink: number,
): void {
  const headW = size * 0.36;
  const headH = size * 0.24;
  const tilt = -0.42;
  const head: number[] = [];
  for (let step = 0; step < 14; step += 1) {
    const angle = (Math.PI * 2 * step) / 14;
    const px = Math.cos(angle) * headW;
    const py = Math.sin(angle) * headH;
    head.push(x + px * Math.cos(tilt) - py * Math.sin(tilt), y + px * Math.sin(tilt) + py * Math.cos(tilt));
  }
  const stemX = x + headW * 0.78;
  const stemTop = y - size * 0.86;
  // Ink shadow first, then the mark, for the same offset-print look as the plates.
  const shadow = size * 0.08;
  graphics.poly(head.map((value) => value + shadow)).fill(ink);
  graphics.poly(head).fill(color);
  graphics.rect(stemX - size * 0.05, stemTop, size * 0.1, y - stemTop).fill(color);
  graphics
    .poly([
      stemX,
      stemTop,
      stemX + size * 0.42,
      stemTop + size * 0.3,
      stemX + size * 0.3,
      stemTop + size * 0.44,
      stemX,
      stemTop + size * 0.2,
    ])
    .fill(color);
}

/**
 * Five-line stave rows across `[x0, x1]` at `y`, each line `gap` apart — sheet music woven into the poster ground.
 * `clipLeftAt(y)` optionally narrows a line's start (to follow a slanted edge).
 */
export function drawStaves(
  graphics: Graphics,
  x0: number,
  x1: number,
  y: number,
  gap: number,
  color: number,
  alpha: number,
  clipLeftAt?: (lineY: number) => number,
): void {
  for (let line = 0; line < 5; line += 1) {
    const lineY = y + line * gap;
    const start = Math.max(x0, clipLeftAt ? clipLeftAt(lineY) : x0);
    if (start < x1) graphics.rect(start, lineY, x1 - start, 1).fill({ color, alpha });
  }
}

/**
 * Torn-paper edge: points every ~`step` px from `(x0, y0)` to `(x1, y1)`, each pushed off the line along its normal
 * by up to `amplitude` — sharp alternating teeth with the odd long shard (up to 2.5 × `amplitude`), like the rip in a
 * Phantom cut-in. Deterministic for `seed`. Returns a flat `[x, y, ...]` list.
 */
export function tornEdgePoints(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  amplitude: number,
  seed: number,
  step = 10,
): number[] {
  const length = Math.hypot(x1 - x0, y1 - y0);
  const count = Math.max(2, Math.ceil(length / step));
  const nx = length > 0 ? -(y1 - y0) / length : 0;
  const ny = length > 0 ? (x1 - x0) / length : 1;
  const points: number[] = [];
  for (let index = 0; index <= count; index += 1) {
    const base = seed * 211 + index * 7;
    // Jitter each tooth along the edge a little so the rip never looks regular.
    const along = Math.min(
      1,
      Math.max(0, (index + (index > 0 && index < count ? (hash01(base + 1) - 0.5) * 0.6 : 0)) / count),
    );
    const shard = hash01(base + 2) > 0.86 ? 2.5 : 1;
    const side = index % 2 === 0 ? 1 : -0.45;
    const offset = index === 0 || index === count ? 0 : amplitude * shard * side * (0.35 + 0.65 * hash01(base + 3));
    points.push(x0 + (x1 - x0) * along + nx * offset, y0 + (y1 - y0) * along + ny * offset);
  }
  return points;
}

/**
 * A torn band: a strip `thickness` thick along the line `(x0, y0) → (x1, y1)` whose two long edges are both
 * {@link tornEdgePoints} rips (with different seeds). A closed polygon ready for `Graphics.poly()`.
 */
export function tornBandPoints(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  thickness: number,
  amplitude: number,
  seed: number,
  step = 10,
): number[] {
  const length = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = (-(y1 - y0) / length) * (thickness / 2);
  const ny = ((x1 - x0) / length) * (thickness / 2);
  const top = tornEdgePoints(x0 - nx, y0 - ny, x1 - nx, y1 - ny, amplitude, seed, step);
  const bottom = tornEdgePoints(x1 + nx, y1 + ny, x0 + nx, y0 + ny, amplitude, seed + 97, step);
  return [...top, ...bottom];
}

export type RansomPaper = 'ink' | 'paper' | 'red';

export interface RansomGlyph {
  char: string;
  /** True for spaces: advance only, no card. */
  space: boolean;
  /** Index into the caller's font list (0..3). */
  font: number;
  /** Size multiplier in [0.82, 1.2]. */
  scale: number;
  /** Card tilt in radians, [-0.14, 0.14]. */
  rotation: number;
  /** Baseline shift as a fraction of the size, [-0.12, 0.12]. */
  dy: number;
  /** The card behind the letter; neighbours never share one. */
  paper: RansomPaper;
}

/**
 * Ransom-note lettering: every character cut from a different magazine — its own face, size, tilt, baseline, and card
 * (ink, paper, or red, never the same as the letter before). Deterministic for `seed`.
 */
export function ransomLayout(text: string, seed: number): RansomGlyph[] {
  const papers: RansomPaper[] = ['ink', 'paper', 'red'];
  const glyphs: RansomGlyph[] = [];
  let previous: RansomPaper | undefined;
  Array.from(text).forEach((char, index) => {
    const base = seed * 389 + index * 13;
    if (char === ' ') {
      glyphs.push({ char, space: true, font: 0, scale: 1, rotation: 0, dy: 0, paper: 'ink' });
      previous = undefined;
      return;
    }
    let paper = papers[Math.floor(hash01(base + 1) * papers.length) % papers.length]!;
    if (paper === previous) paper = papers[(papers.indexOf(paper) + 1) % papers.length]!;
    previous = paper;
    glyphs.push({
      char,
      space: false,
      font: Math.floor(hash01(base + 2) * 4) % 4,
      scale: 0.82 + 0.38 * hash01(base + 3),
      rotation: (hash01(base + 4) - 0.5) * 0.28,
      dy: (hash01(base + 5) - 0.5) * 0.24,
      paper,
    });
  });
  return glyphs;
}
