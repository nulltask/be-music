import type { JudgeKind } from './scoring.ts';

export const LR2_GROOVE_GAUGE_DEFAULT_TOTAL = 160;
export const LR2_GROOVE_GAUGE_INITIAL = 20;
export const LR2_GROOVE_GAUGE_MIN = 2;
export const LR2_GROOVE_GAUGE_MAX = 100;
export const LR2_GROOVE_GAUGE_CLEAR_THRESHOLD = 80;
/**
 * Survival gauges (HARD / DEATH) collapse to 0 % once they drop below 2 % — LR2 fails the stage at that point
 * (iidx.org "you get a stage fail at 2%"; lr2oraja `GaugeProperty` `death = 2`). The gauge display granularity in
 * LR2 is 2 %, so "below 2 %" and "reads 0 %" coincide.
 */
const LR2_SURVIVAL_GAUGE_DEATH_THRESHOLD = 2;
/**
 * LR2 HARD damage softening — below 30 % the damage is multiplied by 0.6 (single stage, unlike beatoraja's
 * five-stage guts). Threshold is a strict less-than per beatoraja master's `HARD_LR2` guts `{30, 0.6}`; note
 * lr2oraja ≥0.8.3 moved it to `< 32` ("display 30 % = internal 32 %"), which lacks first-party measurement — we
 * follow beatoraja master until that's confirmed.
 */
const LR2_HARD_GUTS_THRESHOLD = 30;
const LR2_HARD_GUTS_MULTIPLIER = 0.6;
/**
 * LR2 HARD damage scaling by #TOTAL (beatoraja `GrooveGauge.MODIFY_DAMAGE` `fix1total` / `fix1table`): low-TOTAL
 * charts take disproportionally larger HARD damage. Applies to damage only — recovery is TOTAL-independent. The
 * default #TOTAL 160 lands on ×2.0, which is the familiar "LR2 HARD hits twice as hard as beatoraja" behavior.
 */
const LR2_HARD_DAMAGE_TOTAL_THRESHOLDS = [240, 230, 210, 200, 180, 160, 150, 130, 120] as const;
const LR2_HARD_DAMAGE_TOTAL_MULTIPLIERS = [1.0, 1.11, 1.25, 1.5, 1.666, 2.0, 2.5, 3.333, 5.0, 10.0] as const;

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
  if (isSurvivalGaugeType(state.type) && state.current <= 0) {
    // Dead survival gauges never recover (beatoraja `GrooveGauge.setValue` guards on `value > 0`).
    return 0;
  }
  let delta = resolveGrooveGaugeDelta(state, judge);
  if (state.type === 'HARD' && delta < 0 && state.current < LR2_HARD_GUTS_THRESHOLD) {
    delta *= LR2_HARD_GUTS_MULTIPLIER;
  }
  state.current = clampGrooveGauge(state.current + delta, state.min, state.max);
  collapseDeadSurvivalGauge(state);
  return delta;
}

/**
 * Applies a raw percentage delta (mine damage, HCN hold drain / recovery) with the survival-gauge life rules but
 * WITHOUT the per-judge tables, HARD guts softening, or the #TOTAL damage multiplier — LR2 mine damage bypasses all
 * of those (beatoraja `JudgeManager` calls `gauge.addValue()` directly).
 */
export function applyGrooveGaugeRawDelta(state: GrooveGaugeState, delta: number): number {
  if (!Number.isFinite(delta) || delta === 0) {
    return 0;
  }
  if (isSurvivalGaugeType(state.type) && state.current <= 0) {
    return 0;
  }
  state.current = clampGrooveGauge(state.current + delta, state.min, state.max);
  collapseDeadSurvivalGauge(state);
  return delta;
}

function isSurvivalGaugeType(type: GrooveGaugeType): boolean {
  return type === 'HARD' || type === 'DEATH';
}

function collapseDeadSurvivalGauge(state: GrooveGaugeState): void {
  if (isSurvivalGaugeType(state.type) && state.current < LR2_SURVIVAL_GAUGE_DEATH_THRESHOLD) {
    state.current = state.min;
  }
}

export function isGrooveGaugeCleared(state: GrooveGaugeState): boolean {
  // Survival gauges (HARD / DEATH) fail the run the moment they bottom out at 0 % — playback continues to the end of
  // the chart, but the result is FAILED. The epsilon-tolerant threshold comparison below would read 0 >= 0 as cleared,
  // so they get a strict "still alive" check instead.
  if (state.type === 'HARD' || state.type === 'DEATH') {
    return state.current > 0;
  }
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
  // LR2's EASY clears at 80 % just like GROOVE (beatoraja `EASY_LR2` border = 80; the 60 % border belongs to
  // ASSIST EASY, which this engine does not model).
  if (type === 'EASY') return LR2_GROOVE_GAUGE_CLEAR_THRESHOLD;
  // HARD / DEATH "clear" if you survive past 0 — any positive gauge at end-of-chart counts, exactly 0 % is FAILED.
  // `isGrooveGaugeCleared` enforces the strict > 0 comparison for these types; the 0 here is the display threshold.
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

function resolveHardGaugeDelta(state: GrooveGaugeState, judge: GrooveGaugeJudgeKind): number {
  // LR2 HARD (beatoraja `HARD_LR2` {0.1, 0.1, 0.05, -6, -10, -2}): recovery is a fixed percentage independent of
  // #TOTAL; damage scales with the low-TOTAL multiplier table.
  const damageMultiplier = resolveHardDamageTotalMultiplier(state.effectiveTotal);
  if (judge === 'BAD') return -6 * damageMultiplier;
  if (judge === 'POOR') return -10 * damageMultiplier;
  if (judge === 'EMPTY_POOR') return -2 * damageMultiplier;
  if (judge === 'GOOD') return 0.05;
  // PERFECT / GREAT.
  return 0.1;
}

function resolveHardDamageTotalMultiplier(totalValue: number): number {
  for (let index = 0; index < LR2_HARD_DAMAGE_TOTAL_THRESHOLDS.length; index += 1) {
    if (totalValue >= LR2_HARD_DAMAGE_TOTAL_THRESHOLDS[index]!) {
      return LR2_HARD_DAMAGE_TOTAL_MULTIPLIERS[index]!;
    }
  }
  return LR2_HARD_DAMAGE_TOTAL_MULTIPLIERS.at(-1)!;
}

function resolveDeathGaugeDelta(_state: GrooveGaugeState, judge: GrooveGaugeJudgeKind): number {
  // LR2 HAZARD (beatoraja `HAZARD_LR2` {0.15, 0.06, 0, -100, -100, -10}): any BAD / missed POOR is instant death;
  // an empty POOR drains 10 % rather than killing outright. No guts and no #TOTAL damage scaling.
  if (judge === 'BAD' || judge === 'POOR') return -100;
  if (judge === 'EMPTY_POOR') return -10;
  if (judge === 'GOOD') return 0;
  if (judge === 'GREAT') return 0.06;
  return 0.15;
}

function resolveEasyGaugeDelta(state: GrooveGaugeState, judge: GrooveGaugeJudgeKind): number {
  // LR2 EASY (beatoraja `EASY_LR2` {1.2, 1.2, 0.6, -3.2, -4.8, -1.6}): gains are 1.2× GROOVE, damage is 0.8×
  // GROOVE. The clear threshold stays at 80 % — LR2's EASY is gentler, not lower-bar.
  if (judge === 'BAD') return -3.2;
  if (judge === 'POOR') return -4.8;
  if (judge === 'EMPTY_POOR') return -1.6;
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
