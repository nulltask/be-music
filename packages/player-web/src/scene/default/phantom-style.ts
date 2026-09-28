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
 * Deterministic [0, 1) hash for decorative jitter — the same seed always yields the same value, so pooled per-frame
 * redraws don't shimmer.
 */
export function hash01(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export interface TabularGlyph {
  char: string;
  /** Left edge of the glyph's cell, relative to the run's start. */
  x: number;
  /** Cell width — the shared digit advance for `0-9`, the glyph's own advance otherwise. */
  w: number;
}

/**
 * Lays out a string with tabular (fixed-width) figures. Canvas 2D — which Pixi `Text` rasterizes through — exposes no
 * `font-feature-settings`, so OpenType `tnum` can't be switched on; instead every digit gets a cell as wide as the
 * widest digit, and callers centre each glyph in its cell. Other characters (`/`, `%`, `.`, `x`, spaces) keep their
 * natural advance. Returns the cells plus the run's total width.
 */
export function layoutTabularRun(
  text: string,
  measure: (char: string) => number,
): { glyphs: TabularGlyph[]; width: number } {
  let digitAdvance = 0;
  for (let digit = 0; digit <= 9; digit += 1) {
    digitAdvance = Math.max(digitAdvance, measure(String(digit)));
  }
  const glyphs: TabularGlyph[] = [];
  let x = 0;
  for (const char of text) {
    const w = char >= '0' && char <= '9' ? digitAdvance : measure(char);
    glyphs.push({ char, x, w });
    x += w;
  }
  return { glyphs, width: x };
}

/**
 * 0..1 progress of a staged animation step that starts `delayMs` after the timeline origin and runs for `durationMs`.
 * Clamped at both ends so callers can compute every step from one elapsed clock.
 */
export function stageProgress(elapsedMs: number, delayMs: number, durationMs: number): number {
  if (durationMs <= 0) return elapsedMs >= delayMs ? 1 : 0;
  return Math.max(0, Math.min(1, (elapsedMs - delayMs) / durationMs));
}

export function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - (1 - clamped) ** 3;
}

/** Ease-out with a small overshoot past 1 before settling — the "slam" landing for tags and stamps. */
export function easeOutBack(t: number, overshoot = 1.70158): number {
  const clamped = Math.max(0, Math.min(1, t));
  const shifted = clamped - 1;
  return 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2;
}

/** Counter roll-up: the integer shown at `progress` (0..1) of counting up to `target`. */
export function rollUpValue(target: number, progress: number): number {
  if (!Number.isFinite(target)) return 0;
  return Math.round(target * easeOutCubic(progress));
}
