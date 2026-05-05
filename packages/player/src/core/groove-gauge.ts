import type { JudgeKind } from './scoring.ts';

export const LR2_GROOVE_GAUGE_DEFAULT_TOTAL = 160;
export const LR2_GROOVE_GAUGE_INITIAL = 20;
export const LR2_GROOVE_GAUGE_MIN = 2;
export const LR2_GROOVE_GAUGE_MAX = 100;
export const LR2_GROOVE_GAUGE_CLEAR_THRESHOLD = 80;

export type GrooveGaugeJudgeKind = JudgeKind | 'EMPTY_POOR';

/**
 * LR2 gauge variants. `'GROOVE'` is the default (cumulative gain from 20 %, clear at 80 %, soft floor at 2 %). The
 * other modes mirror `#SRC_BUTTON,type=40 / 41` cycling:
 *
 * - `'HARD'` — start at 100 %, lose chunks on misses, fails at 0 % (game continues but the chart is "FAILED" at end).
 * - `'DEATH'` — start at 100 %, ANY miss / poor drops the gauge to 0 % immediately (no recovery).
 * - `'EASY'` — gentler GROOVE: bigger gains, smaller losses, clear threshold lowered to 60 %.
 */
export type GrooveGaugeType = 'GROOVE' | 'HARD' | 'DEATH' | 'EASY';

export interface GrooveGaugeState {
  noteCount: number;
  effectiveTotal: number;
  current: number;
  initial: number;
  min: number;
  max: number;
  clearThreshold: number;
  type: GrooveGaugeType;
}

export function createGrooveGaugeState(
  noteCount: number,
  totalValue: number | undefined,
  type: GrooveGaugeType = 'GROOVE',
): GrooveGaugeState {
  const initial = resolveGrooveGaugeInitial(type);
  const min = resolveGrooveGaugeMin(type);
  return {
    noteCount: Number.isFinite(noteCount) ? Math.max(0, Math.floor(noteCount)) : 0,
    effectiveTotal: resolveGrooveGaugeTotal(totalValue),
    current: initial,
    initial,
    min,
    max: LR2_GROOVE_GAUGE_MAX,
    clearThreshold: resolveGrooveGaugeClearThreshold(type),
    type,
  };
}

export function applyGrooveGaugeJudge(state: GrooveGaugeState, judge: GrooveGaugeJudgeKind): number {
  const delta = resolveGrooveGaugeDelta(state, judge);
  state.current = clampGrooveGauge(state.current + delta, state.min, state.max);
    // DEATH gauge — any non-positive verdict zeroes the gauge so subsequent renders / fail-detection see an instant
  // flat-line.
  if (state.type === 'DEATH' && (judge === 'POOR' || judge === 'BAD' || judge === 'EMPTY_POOR')) {
    state.current = state.min;
  }
  return delta;
}

export function isGrooveGaugeCleared(state: GrooveGaugeState): boolean {
  return state.current + 1e-9 >= state.clearThreshold;
}

function resolveGrooveGaugeTotal(totalValue: number | undefined): number {
  return typeof totalValue === 'number' && Number.isFinite(totalValue) ? totalValue : LR2_GROOVE_GAUGE_DEFAULT_TOTAL;
}

function resolveGrooveGaugeInitial(type: GrooveGaugeType): number {
    // HARD / DEATH gauges start FULL — every chart is a survival run from 100 % down. GROOVE / EASY follow the LR2
  // default of 20 % so the gauge ramps up over the play.
  if (type === 'HARD' || type === 'DEATH') return LR2_GROOVE_GAUGE_MAX;
  return LR2_GROOVE_GAUGE_INITIAL;
}

function resolveGrooveGaugeMin(type: GrooveGaugeType): number {
    // GROOVE / EASY have a soft floor (2 %) so a mid-chart miss streak doesn't lock the player out of recovery. HARD /
  // DEATH bottom out at 0 % so they can fail.
  if (type === 'HARD' || type === 'DEATH') return 0;
  return LR2_GROOVE_GAUGE_MIN;
}

function resolveGrooveGaugeClearThreshold(type: GrooveGaugeType): number {
  if (type === 'EASY') return 60;
    // HARD / DEATH "clear" if you survive past 0 — any positive gauge at end-of-chart counts. We reuse 0 + epsilon as the
  // threshold so `isGrooveGaugeCleared` uses the same comparison.
  if (type === 'HARD' || type === 'DEATH') return 0;
  return LR2_GROOVE_GAUGE_CLEAR_THRESHOLD;
}

function resolveGrooveGaugeDelta(state: GrooveGaugeState, judge: GrooveGaugeJudgeKind): number {
  switch (state.type) {
    case 'HARD':
      return resolveHardGaugeDelta(state, judge);
    case 'DEATH':
      return resolveDeathGaugeDelta(state, judge);
    case 'EASY':
      return resolveEasyGaugeDelta(state, judge);
    case 'GROOVE':
    default:
      return resolveGrooveGaugeDeltaNormal(state, judge);
  }
}

function resolveGrooveGaugeDeltaNormal(state: GrooveGaugeState, judge: GrooveGaugeJudgeKind): number {
  if (judge === 'BAD') return -4;
  if (judge === 'POOR') return -6;
  if (judge === 'EMPTY_POOR') return -2;
  if (state.noteCount <= 0) return 0;
  const baseGain = state.effectiveTotal / state.noteCount;
  if (judge === 'GOOD') return baseGain / 2;
  return baseGain;
}

function resolveHardGaugeDelta(_state: GrooveGaugeState, judge: GrooveGaugeJudgeKind): number {
    // HARD penalties are flat percentages — independent of TOTAL — because the gauge starts at 100 % and the penalty
  // model is "how many BADs / POORs can you survive". Approximates LR2's canonical values; re-tune if score-history
  // calibration says otherwise.
  if (judge === 'BAD') return -6;
  if (judge === 'POOR') return -10;
  if (judge === 'EMPTY_POOR') return -2;
  if (judge === 'GOOD') return 0.16;
  // PERFECT / GREAT — small recovery nudge, capped by the 100 % ceiling.
  return 0.16;
}

function resolveDeathGaugeDelta(_state: GrooveGaugeState, judge: GrooveGaugeJudgeKind): number {
    // DEATH — any miss / poor zeroes the gauge (handled by the post-clamp nudge in `applyGrooveGaugeJudge`). Hits give a
  // tiny token gain so the polyline reads as "alive" while the chart still has playable notes.
  if (judge === 'BAD' || judge === 'POOR' || judge === 'EMPTY_POOR') return -100;
  if (judge === 'GOOD') return 0;
  return 0.16;
}

function resolveEasyGaugeDelta(state: GrooveGaugeState, judge: GrooveGaugeJudgeKind): number {
  // EASY — gentler than GROOVE. ~1.2× baseline gains, ~50 % smaller miss penalties.
  if (judge === 'BAD') return -2;
  if (judge === 'POOR') return -3;
  if (judge === 'EMPTY_POOR') return -1;
  if (state.noteCount <= 0) return 0;
  const baseGain = (state.effectiveTotal / state.noteCount) * 1.2;
  if (judge === 'GOOD') return baseGain / 2;
  return baseGain;
}

function clampGrooveGauge(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}
