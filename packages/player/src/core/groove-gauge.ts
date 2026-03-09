import type { JudgeKind } from './scoring.ts';

export const LR2_GROOVE_GAUGE_DEFAULT_TOTAL = 160;
export const LR2_GROOVE_GAUGE_INITIAL = 20;
export const LR2_GROOVE_GAUGE_MIN = 2;
export const LR2_GROOVE_GAUGE_MAX = 100;
export const LR2_GROOVE_GAUGE_CLEAR_THRESHOLD = 80;

export type GrooveGaugeJudgeKind = JudgeKind | 'EMPTY_POOR';

export interface GrooveGaugeState {
  noteCount: number;
  effectiveTotal: number;
  current: number;
  initial: number;
  min: number;
  max: number;
  clearThreshold: number;
}

export function createGrooveGaugeState(noteCount: number, totalValue: number | undefined): GrooveGaugeState {
  return {
    noteCount: Number.isFinite(noteCount) ? Math.max(0, Math.floor(noteCount)) : 0,
    effectiveTotal: resolveGrooveGaugeTotal(totalValue),
    current: LR2_GROOVE_GAUGE_INITIAL,
    initial: LR2_GROOVE_GAUGE_INITIAL,
    min: LR2_GROOVE_GAUGE_MIN,
    max: LR2_GROOVE_GAUGE_MAX,
    clearThreshold: LR2_GROOVE_GAUGE_CLEAR_THRESHOLD,
  };
}

export function applyGrooveGaugeJudge(state: GrooveGaugeState, judge: GrooveGaugeJudgeKind): number {
  const delta = resolveGrooveGaugeDelta(state, judge);
  state.current = clampGrooveGauge(state.current + delta, state.min, state.max);
  return delta;
}

export function isGrooveGaugeCleared(state: GrooveGaugeState): boolean {
  return state.current + 1e-9 >= state.clearThreshold;
}

function resolveGrooveGaugeTotal(totalValue: number | undefined): number {
  return typeof totalValue === 'number' && Number.isFinite(totalValue) ? totalValue : LR2_GROOVE_GAUGE_DEFAULT_TOTAL;
}

function resolveGrooveGaugeDelta(state: GrooveGaugeState, judge: GrooveGaugeJudgeKind): number {
  if (judge === 'BAD') {
    return -4;
  }
  if (judge === 'POOR') {
    return -6;
  }
  if (judge === 'EMPTY_POOR') {
    return -2;
  }
  if (state.noteCount <= 0) {
    return 0;
  }

  const baseGain = state.effectiveTotal / state.noteCount;
  if (judge === 'GOOD') {
    return baseGain / 2;
  }
  return baseGain;
}

function clampGrooveGauge(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}
