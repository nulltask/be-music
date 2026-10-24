/**
 * Hi-speed (note scroll multiplier) range shared by the select screens' play-option panels, the gameplay screens'
 * hi-speed keys and hosts that remember the player's pick (e.g. the player's Debug Menu). Visual only: hi-speed changes how
 * far apart notes are drawn, never when they are judged.
 */

/**
 * Hi-speed a play starts at when nothing else is picked — 2.0× rather than upstream beatoraja's `PlayConfig.java:16`
 * default of `1.0f`: at 1.0 most charts (BPM 130-180) take about 1.8 seconds to cross the lane, which reads as "the chart
 * isn't moving" to anyone coming from LR2 / That-Which-Must-Not-Be-Named defaults, and 2.0 is the lowest setting most players use.
 */
export const DEFAULT_HISPEED = 2.0;
/** Slowest selectable hi-speed. */
export const HISPEED_MIN = 0.1;
/** Fastest selectable hi-speed. */
export const HISPEED_MAX = 6.0;
/** One press of the in-game hotkey (and one click of the select panel's HS button). */
export const HISPEED_STEP = 0.1;

/**
 * Snaps `value` to the 1/1000 grid and clamps it to [{@link HISPEED_MIN}, {@link HISPEED_MAX}]. The snap absorbs the
 * float drift of repeated ±{@link HISPEED_STEP} steps (`0.1` has no exact IEEE-754 representation, so 13 presses would
 * otherwise land on `1.3000000000000003`). `NaN` / non-finite input returns `undefined` so callers keep their value.
 */
export function snapHiSpeed(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const snapped = Math.round(value * 1000) / 1000;
  return Math.max(HISPEED_MIN, Math.min(HISPEED_MAX, snapped));
}

/**
 * A hi-speed change under HS-FIX. The player's hi-speed (`player`, on their own scale: the one the select panel, the
 * readouts and the host show) moves to `player + delta`, and the drawn one is that times the chart's HS-FIX
 * `multiplier` (1 without HS-FIX). Stepping the player's value keeps it on the {@link HISPEED_STEP} grid, where
 * stepping the drawn one would move the player's by `delta / multiplier`. `undefined` for non-finite input.
 */
export function stepPlayerHiSpeed(
  player: number,
  delta: number,
  multiplier: number,
): { player: number; drawn: number } | undefined {
  const next = snapHiSpeed(player + delta);
  if (next === undefined) return undefined;
  const drawn = snapHiSpeed(next * multiplier);
  return drawn === undefined ? undefined : { player: next, drawn };
}

/**
 * How long the note scroll takes to glide to a new hi-speed. Long enough that the notes visibly ease instead of
 * jumping, short enough that the new speed is readable right away.
 */
export const HISPEED_TRANSITION_MS = 200;

/**
 * The scroll hi-speed `nowMs` into a transition from `from` to `to` that started at `startMs` and lasts `durationMs`,
 * eased out (cubic) so the change responds at once and settles softly. `from` before the start, `to` from the end on
 * (and at once for a non-positive duration). Time is an input: the caller owns the clock.
 */
export function easeHiSpeed(from: number, to: number, startMs: number, nowMs: number, durationMs: number): number {
  if (!(durationMs > 0) || nowMs >= startMs + durationMs) return to;
  if (nowMs <= startMs) return from;
  const remaining = 1 - (nowMs - startMs) / durationMs;
  return from + (to - from) * (1 - remaining * remaining * remaining);
}

/**
 * A hi-speed whose note-scroll value glides to each new target ({@link easeHiSpeed}). The target is what the HUD shows
 * and what is reported to the host; {@link valueAt} is what notes, bar lines and long notes are positioned with.
 * Visual only — judging never reads it.
 */
export class HiSpeedTransition {
  private from: number;
  private to: number;
  private startMs = 0;
  private readonly durationMs: number;

  public constructor(initial: number, durationMs: number = HISPEED_TRANSITION_MS) {
    this.from = initial;
    this.to = initial;
    this.durationMs = durationMs;
  }

  /** The hi-speed being moved to. */
  public get target(): number {
    return this.to;
  }

  /** The scroll hi-speed at `nowMs`. */
  public valueAt(nowMs: number): number {
    return easeHiSpeed(this.from, this.to, this.startMs, nowMs, this.durationMs);
  }

  /** Glides to `value` from wherever the scroll is at `nowMs` (mid-transition included), so a retarget never jumps. */
  public retarget(value: number, nowMs: number): void {
    if (value === this.to) return;
    this.from = this.valueAt(nowMs);
    this.to = value;
    this.startMs = nowMs;
  }

  /** Moves to `value` at once — for setup before the notes are on screen. */
  public jump(value: number): void {
    this.from = value;
    this.to = value;
  }
}
