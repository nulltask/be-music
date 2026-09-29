/**
 * "Moments" — the showpiece events built-in skins stage during a play: combo milestones, the gauge crossing the clear
 * line, and a full combo. Pure state transitions so chrome renderers (which redraw every frame from a runtime snapshot)
 * can detect the frame an event happens and animate against its timestamp.
 */

export interface MomentInput {
  nowMs: number;
  combo: number;
  gauge: number;
  clearThreshold: number;
  survival: boolean;
  /** Notes judged so far (PG + GR + GD + BD + PR). */
  judged: number;
  totalNotes: number;
  bad: number;
  poor: number;
}

export interface MomentState {
  lastCombo: number;
  lastGauge: number;
  /** Most recent combo milestone (a multiple of {@link COMBO_MILESTONE}) and when it was reached. */
  milestone: { value: number; atMs: number } | undefined;
  /** When the gauge last rose onto / above the clear line from below. */
  clearAtMs: number | undefined;
  /** When the final note was judged with no BAD / POOR. */
  fullComboAtMs: number | undefined;
  /** When a combo of at least {@link COMBO_BREAK_MIN} broke, and how long it was. */
  comboBreak: { combo: number; atMs: number } | undefined;
}

export const COMBO_MILESTONE = 100;
/** Combos shorter than this break silently. */
export const COMBO_BREAK_MIN = 20;

export function createMomentState(): MomentState {
  return {
    lastCombo: 0,
    lastGauge: 0,
    milestone: undefined,
    clearAtMs: undefined,
    fullComboAtMs: undefined,
    comboBreak: undefined,
  };
}

/** Advances `state` by one frame of `input`, stamping any event that happened since the previous frame. */
export function updateMoments(state: MomentState, input: MomentInput): MomentState {
  const next: MomentState = { ...state, lastCombo: input.combo, lastGauge: input.gauge };
  const reached = Math.floor(input.combo / COMBO_MILESTONE);
  if (input.combo < state.lastCombo && state.lastCombo >= COMBO_BREAK_MIN) {
    next.comboBreak = { combo: state.lastCombo, atMs: input.nowMs };
  }
  if (reached >= 1 && reached > Math.floor(state.lastCombo / COMBO_MILESTONE)) {
    next.milestone = { value: reached * COMBO_MILESTONE, atMs: input.nowMs };
  }
  if (
    !input.survival &&
    input.clearThreshold > 0 &&
    state.lastGauge < input.clearThreshold &&
    input.gauge >= input.clearThreshold
  ) {
    next.clearAtMs = input.nowMs;
  }
  if (
    state.fullComboAtMs === undefined &&
    input.totalNotes > 0 &&
    input.judged >= input.totalNotes &&
    input.bad === 0 &&
    input.poor === 0
  ) {
    next.fullComboAtMs = input.nowMs;
  }
  return next;
}

/** Escalation tier for a combo: 0 below 25, then 1 / 2 / 3 / 4 from 25 / 50 / 100 / 200. */
export function comboTier(combo: number): 0 | 1 | 2 | 3 | 4 {
  if (combo >= 200) return 4;
  if (combo >= 100) return 3;
  if (combo >= 50) return 2;
  if (combo >= 25) return 1;
  return 0;
}

/** Progress (0..1) of a moment that started at `atMs` and lasts `durationMs`, or `undefined` when not running. */
export function momentProgress(atMs: number | undefined, nowMs: number, durationMs: number): number | undefined {
  if (atMs === undefined) return undefined;
  const t = (nowMs - atMs) / durationMs;
  return t >= 0 && t < 1 ? t : undefined;
}

/**
 * Per-scene moment state keyed by the chrome layer the renderer draws into, so each gameplay scene instance tracks its
 * own events without the renderer holding scene references.
 */
const STATES = new WeakMap<object, MomentState>();

export function trackMoments(key: object, input: MomentInput): MomentState {
  const state = updateMoments(STATES.get(key) ?? createMomentState(), input);
  STATES.set(key, state);
  return state;
}

/** Strength (1 → 0) of an impulse that fired at `atMs`, easing out over `durationMs`; 0 when absent or finished. */
export function impulse(atMs: number | undefined, nowMs: number, durationMs: number): number {
  if (atMs === undefined || durationMs <= 0) return 0;
  const t = (nowMs - atMs) / durationMs;
  if (t < 0 || t >= 1) return 0;
  return (1 - t) ** 2;
}

/** Scale for a "punch" on `atMs`: overshoots to `1 + amount` instantly and eases back to 1 over `durationMs`. */
export function punchScale(atMs: number | undefined, nowMs: number, durationMs: number, amount: number): number {
  return 1 + amount * impulse(atMs, nowMs, durationMs);
}

/** Multipliers skins apply per effect level: overall motion / particle `amount`, and whether screen-wide hits run. */
export function effectProfile(level: 'full' | 'reduced' | 'off' | undefined): {
  amount: number;
  screenWide: boolean;
  enabled: boolean;
} {
  switch (level) {
    case 'off':
      return { amount: 0, screenWide: false, enabled: false };
    case 'reduced':
      return { amount: 0.5, screenWide: false, enabled: true };
    default:
      return { amount: 1, screenWide: true, enabled: true };
  }
}
