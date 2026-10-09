import { hash01 } from '../../skin-sdk/index.ts';

/**
 * Pure motion helpers for the Lattice skin: the needle field (short strokes on a grid that turn like iron filings in
 * a field), a closed-form spring, odometer digit transitions, the count-in steps, and a diagonal tile-flip wave.
 * Everything is a function of its inputs, so the pooled per-frame redraw needs no animation state.
 */

export interface NeedleFieldInput {
  seconds: number;
  /** Fractional beat in [0, 1): a wave front sweeps left → right across the field once per beat. */
  beatPhase: number;
  /** Ambient flow amplitude (radians-ish, 0 = every needle at rest at 45°). */
  flow: number;
  /** Strength of the per-beat sweep, 0..1. */
  beatWave?: number;
  /** Ripples spreading from points (key presses), each fading out over {@link RIPPLE_LIFE_MS}. */
  ripples?: ReadonlyArray<{ x: number; y: number; ageMs: number; strength: number }>;
  /** Needles turn to point at this spot with `strength` 0..1. */
  attractor?: { x: number; y: number; strength: number };
  /** Needles lie tangent to circles around this spot with `strength` 0..1. */
  swirl?: { x: number; y: number; strength: number };
  /** Random per-needle shake, 0..1 (a miss). */
  jitter?: number;
  /** Constant nervous tremor (radians of peak shake), re-rolled every 1/30 s. */
  tremble?: number;
  /**
   * A spectrum drawn by the needles: `levels` (0..1 each) split `[left, right]` into equal columns, and in each column
   * the needles from `bottom` up to the column's bar height stand upright — an equalizer of iron filings. The bar's
   * top edge feathers over {@link SPECTRUM_FEATHER} px.
   */
  spectrum?: { levels: readonly number[]; left: number; right: number; top: number; bottom: number };
}

export const SPECTRUM_FEATHER = 12;

export const RIPPLE_LIFE_MS = 700;
const REST_ANGLE = Math.PI / 4;

/** Orientation (radians) of the needle at `(x, y)`. Needles are undirected strokes, so angles repeat every π. */
export function needleAngle(x: number, y: number, input: NeedleFieldInput): number {
  const s = input.seconds;
  let angle = REST_ANGLE + input.flow * (0.5 * Math.sin(x * 0.017 + s * 0.6) + 0.5 * Math.cos(y * 0.023 - s * 0.45));
  const beatWave = input.beatWave ?? 0;
  if (beatWave > 0) {
    let d = x / 640 - input.beatPhase;
    d -= Math.round(d);
    angle += beatWave * (Math.PI / 2) * Math.exp(-(d * d) / 0.004);
  }
  for (const ripple of input.ripples ?? []) {
    if (ripple.ageMs < 0 || ripple.ageMs >= RIPPLE_LIFE_MS) continue;
    const r = Math.hypot(x - ripple.x, y - ripple.y);
    const front = ripple.ageMs * 0.5;
    const band = Math.exp(-(((r - front) / 18) ** 2)) * (1 - ripple.ageMs / RIPPLE_LIFE_MS);
    angle += band * ripple.strength * (Math.PI / 2);
  }
  if (input.attractor && input.attractor.strength > 0) {
    const target = Math.atan2(input.attractor.y - y, input.attractor.x - x);
    angle = mixLineAngle(angle, target, input.attractor.strength);
  }
  if (input.swirl && input.swirl.strength > 0) {
    const target = Math.atan2(y - input.swirl.y, x - input.swirl.x) + Math.PI / 2;
    angle = mixLineAngle(angle, target, input.swirl.strength);
  }
  const spectrum = input.spectrum;
  if (spectrum && spectrum.levels.length > 0 && x >= spectrum.left && x <= spectrum.right && y <= spectrum.bottom) {
    const span = Math.max(1e-6, spectrum.right - spectrum.left);
    const column = Math.min(
      spectrum.levels.length - 1,
      Math.floor(((x - spectrum.left) / span) * spectrum.levels.length),
    );
    const level = Math.max(0, Math.min(1, spectrum.levels[column] ?? 0));
    const barTop = spectrum.bottom - level * (spectrum.bottom - spectrum.top);
    const stand = level > 0 ? Math.max(0, Math.min(1, (y - barTop + SPECTRUM_FEATHER) / SPECTRUM_FEATHER)) : 0;
    if (stand > 0) angle = mixLineAngle(angle, Math.PI / 2, stand);
  }
  const tremble = input.tremble ?? 0;
  if (tremble > 0) {
    angle += (hash01(x * 1.97 + y * 5.13 + Math.floor(s * 30) * 0.71) - 0.5) * 2 * tremble;
  }
  const jitter = input.jitter ?? 0;
  if (jitter > 0) {
    angle += (hash01(x * 7.13 + y * 3.71 + Math.floor(s * 30) * 0.37) - 0.5) * Math.PI * jitter;
  }
  return angle;
}

/** Blend two undirected line angles along the shorter turn (lines repeat every π). */
export function mixLineAngle(from: number, to: number, t: number): number {
  let diff = (to - from) % Math.PI;
  if (diff > Math.PI / 2) diff -= Math.PI;
  if (diff < -Math.PI / 2) diff += Math.PI;
  return from + diff * Math.max(0, Math.min(1, t));
}

/**
 * Under-damped spring from 0 to 1 over normalized time `t` (0..1, clamped): overshoots about 20 % and settles by
 * `t = 1`. `frequency` is oscillations per unit time.
 */
export function springEase(t: number, frequency = 2.2, damping = 0.45): number {
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  const omega = Math.PI * 2 * frequency;
  const damped = omega * Math.sqrt(1 - damping * damping);
  const envelope = Math.exp(-damping * omega * t);
  return 1 - envelope * (Math.cos(damped * t) + ((damping * omega) / damped) * Math.sin(damped * t));
}

export interface DigitTransition {
  char: string;
  /** The digit this slot showed before (`''` when the number grew a digit). */
  previous: string;
  changed: boolean;
}

/** Right-aligned per-digit comparison of two counts — which odometer wheels turn when `previous` becomes `next`. */
export function digitTransitions(previous: number, next: number): DigitTransition[] {
  const before = String(Math.max(0, Math.floor(previous)));
  const after = String(Math.max(0, Math.floor(next)));
  const pad = after.length - before.length;
  return Array.from(after).map((char, index) => {
    const prior = index - pad >= 0 ? (before[index - pad] ?? '') : '';
    return { char, previous: prior, changed: prior !== char };
  });
}

/**
 * Count-in step at `chartMs` (negative before the first note): 3 / 2 / 1 on 800 ms steps, then GO for 600 ms.
 * `progress` runs 0..1 within the step.
 */
export function countInStep(chartMs: number): { label: '3' | '2' | '1' | 'GO'; progress: number } | undefined {
  if (!Number.isFinite(chartMs) || chartMs < -2400 || chartMs >= 600) return undefined;
  if (chartMs >= 0) return { label: 'GO', progress: chartMs / 600 };
  const step = Math.floor((chartMs + 2400) / 800);
  const labels = ['3', '2', '1'] as const;
  return { label: labels[step]!, progress: (chartMs + 2400 - step * 800) / 800 };
}

/**
 * Local flip progress (0..1) of tile `(column, row)` in a `columns` × `rows` grid when a diagonal wave sweeping from
 * the top-left is at global progress `t`. `spread` is the share of the timeline the wave takes to cross the grid.
 */
export function tileFlipPhase(
  column: number,
  row: number,
  columns: number,
  rows: number,
  t: number,
  spread = 0.5,
): number {
  const along = ((columns > 1 ? column / (columns - 1) : 0) + (rows > 1 ? row / (rows - 1) : 0)) / 2;
  const delay = along * spread;
  return Math.max(0, Math.min(1, (t - delay) / (1 - spread)));
}

const SCRAMBLE_LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=/<>?';
const SCRAMBLE_WIDE = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン';

/**
 * Text scramble: `target` decodes left to right as `progress` runs 0 → 1. Each character first flickers through random
 * glyphs (re-rolled whenever `tick` changes), then locks to its final form; characters the wave has not reached yet
 * are blank. Spaces stay spaces, and wide (CJK) characters scramble through katakana so the line keeps its width.
 */
export function scrambleText(target: string, progress: number, tick: number, seed = 0): string {
  const chars = Array.from(target);
  if (!(progress < 1)) return target;
  const count = chars.length;
  if (count === 0) return target;
  const t = Math.max(0, progress);
  // Each character starts scrambling at `start` and settles `window` later; the wave crosses the text in 60 % of the run.
  const window = 0.4;
  let out = '';
  for (let index = 0; index < count; index += 1) {
    const char = chars[index]!;
    if (char === ' ' || char === '　') {
      out += char;
      continue;
    }
    const start = count > 1 ? (index / (count - 1)) * (1 - window) : 0;
    if (t < start) {
      out += ' ';
    } else if (t >= start + window) {
      out += char;
    } else {
      const wide = (char.codePointAt(0) ?? 0) > 0x2e7f;
      const set = wide ? SCRAMBLE_WIDE : SCRAMBLE_LATIN;
      out += set[Math.floor(hash01(seed * 131 + index * 17 + tick * 7.31) * set.length) % set.length];
    }
  }
  return out;
}

/** Glyph re-roll counter for {@link scrambleText}: a new random glyph set every `intervalMs` (default 45 ms). */
export function scrambleTick(nowMs: number, intervalMs = 45): number {
  return Number.isFinite(nowMs) ? Math.floor(nowMs / intervalMs) : 0;
}
