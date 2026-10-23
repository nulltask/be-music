import {
  hcnActiveTimerId,
  hcnDamageTimerId,
  TIMER_SCORE_A,
  TIMER_SCORE_AA,
  TIMER_SCORE_AAA,
  TIMER_SCORE_BEST,
  TIMER_SCORE_TARGET,
  TIMER_PM_CHARA_1P_NEUTRAL,
  TIMER_PM_CHARA_1P_FEVER,
  TIMER_PM_CHARA_1P_GREAT,
  TIMER_PM_CHARA_1P_GOOD,
  TIMER_PM_CHARA_1P_BAD,
  TIMER_PM_CHARA_2P_NEUTRAL,
  TIMER_PM_CHARA_2P_GREAT,
  TIMER_PM_CHARA_2P_BAD,
  TIMER_MUSIC_END,
  TIMER_PM_CHARA_DANCE,
} from '../runtime-ids.ts';
import type { BeatorajaLanePlacement, BeatorajaTimerChanges } from './play-timers.ts';

const SCORE_TIMERS = [TIMER_SCORE_A, TIMER_SCORE_AA, TIMER_SCORE_AAA, TIMER_SCORE_BEST, TIMER_SCORE_TARGET];

/** The score comparisons updated by a judgment, against the entire chart's maximum EX score. */
export interface BeatorajaScoreTimerInput {
  readonly exScore: number;
  readonly totalNotes: number;
  readonly hasJudgment: boolean;
  readonly bestEXScore?: number;
  readonly targetEXScore?: number;
  readonly started: ReadonlySet<number>;
}

/** Switches score/rank timers without restarting one whose condition stays true. */
export function resolveBeatorajaScoreTimers(input: BeatorajaScoreTimerInput): BeatorajaTimerChanges {
  const { exScore, totalNotes } = input;
  const rank = (threshold: number) => totalNotes > 0 && exScore * 27 >= totalNotes * 2 * threshold;
  const target = (value: number | undefined) =>
    value !== undefined && Number.isFinite(value) && value >= 0 ? value : 0;
  const comparisons = [
    rank(18),
    rank(21),
    rank(24),
    exScore >= target(input.bestEXScore),
    exScore >= target(input.targetEXScore),
  ];
  const start: number[] = [];
  const stop: number[] = [];
  SCORE_TIMERS.forEach((id, index) => {
    const on = input.hasJudgment && comparisons[index];
    if (on && !input.started.has(id)) start.push(id);
    else if (!on && input.started.has(id)) stop.push(id);
  });
  return { start, startOnce: [], stop };
}

function isHCNTimer(id: number): boolean {
  return (
    Number.isInteger(id) &&
    ((id >= 250 && id <= 289) ||
      (id >= 1810 && id <= 1899) ||
      (id >= 1910 && id <= 1999) ||
      (id >= 2010 && id <= 2099) ||
      (id >= 2110 && id <= 2199))
  );
}

/** Switches the HCN active/damage bank from authoritative judge facts, including ending and reholding a lane. */
export function resolveBeatorajaHCNTimers(input: {
  readonly lanes: readonly (BeatorajaLanePlacement & { readonly gaining: boolean })[];
  readonly started: Iterable<number>;
}): BeatorajaTimerChanges {
  const desired = new Set<number>();
  for (const lane of input.lanes) {
    if (lane.lane === undefined) continue;
    const id = (lane.gaining ? hcnActiveTimerId : hcnDamageTimerId)(lane.side, lane.lane);
    if (id !== undefined) desired.add(id);
  }
  const started = new Set(input.started);
  return {
    start: [...desired].filter((id) => !started.has(id)),
    startOnce: [],
    stop: [...started].filter((id) => isHCNTimer(id) && !desired.has(id)),
  };
}

/** Past-note counts captured on returning each character to neutral. */
export interface BeatorajaCharacterTimerState {
  readonly lastNotes: readonly [number, number];
}

/** The POMYU timer state machine, with motion durations and time supplied by the caller. */
export function resolveBeatorajaCharacterTimers(input: {
  readonly nowMs: number;
  readonly timers: ReadonlyMap<number, number>;
  readonly state: BeatorajaCharacterTimerState;
  readonly stage: 'loading' | 'playing' | 'finished' | 'stopped';
  readonly pastNotes: number;
  readonly latestJudge?: string;
  readonly gaugeMax: boolean;
  /** Eight motion durations, starting with 1P neutral. Upstream defaults each to 1 ms without a pack. */
  readonly motionDurationsMs?: readonly number[];
}): { readonly changes: BeatorajaTimerChanges; readonly state: BeatorajaCharacterTimerState } {
  const start: number[] = [];
  const stop: number[] = [];
  const at = (id: number) => (start.includes(id) ? input.nowMs : stop.includes(id) ? undefined : input.timers.get(id));
  const on = (id: number) => {
    if (at(id) === undefined) start.push(id);
  };
  const off = (id: number) => {
    if (at(id) !== undefined) stop.push(id);
  };
  const duration = (id: number) => {
    const value = input.motionDurationsMs?.[id - TIMER_PM_CHARA_1P_NEUTRAL];
    return value !== undefined && Number.isFinite(value) && value >= 1 ? value : 1;
  };
  const age = (id: number) => {
    const started = at(id);
    return started === undefined ? undefined : input.nowMs - started;
  };
  let state = input.state;
  if (input.stage === 'finished') {
    on(TIMER_MUSIC_END);
    for (let id = TIMER_PM_CHARA_1P_NEUTRAL; id <= TIMER_PM_CHARA_2P_BAD; id++) off(id);
    off(TIMER_PM_CHARA_DANCE);
  } else if (input.stage === 'loading') {
    on(TIMER_PM_CHARA_1P_NEUTRAL);
    on(TIMER_PM_CHARA_2P_NEUTRAL);
  } else if (input.stage === 'playing') {
    if (![900, 901, 902, 903, 904].some((id) => at(id) !== undefined)) on(TIMER_PM_CHARA_1P_NEUTRAL);
    if (![905, 906, 907].some((id) => at(id) !== undefined)) on(TIMER_PM_CHARA_2P_NEUTRAL);
    const judge = input.latestJudge?.toUpperCase();
    const good = judge === 'GOOD';
    const great = judge === 'PERFECT' || judge === 'PGREAT' || judge === 'GREAT';
    const hasJudge = great || good || judge === 'BAD' || judge === 'POOR' || judge === 'MISS';
    for (const [side, neutral] of [
      [0, TIMER_PM_CHARA_1P_NEUTRAL],
      [1, TIMER_PM_CHARA_2P_NEUTRAL],
    ] as const) {
      const elapsed = age(neutral);
      const period = duration(neutral);
      if (
        elapsed !== undefined &&
        elapsed >= period &&
        elapsed % period < 17 &&
        input.state.lastNotes[side] !== input.pastNotes &&
        hasJudge
      ) {
        const reaction =
          side === 0
            ? great
              ? input.gaugeMax
                ? TIMER_PM_CHARA_1P_FEVER
                : TIMER_PM_CHARA_1P_GREAT
              : good
                ? TIMER_PM_CHARA_1P_GOOD
                : TIMER_PM_CHARA_1P_BAD
            : great || good
              ? TIMER_PM_CHARA_2P_BAD
              : TIMER_PM_CHARA_2P_GREAT;
        on(reaction);
        off(neutral);
      }
    }
    for (let id = TIMER_PM_CHARA_1P_FEVER; id <= TIMER_PM_CHARA_2P_BAD; id++) {
      if (id === TIMER_PM_CHARA_2P_NEUTRAL) continue;
      const elapsed = age(id);
      if (elapsed !== undefined && elapsed >= duration(id)) {
        const side = id <= TIMER_PM_CHARA_1P_BAD ? 0 : 1;
        on(side === 0 ? TIMER_PM_CHARA_1P_NEUTRAL : TIMER_PM_CHARA_2P_NEUTRAL);
        off(id);
        const lastNotes: [number, number] = [...state.lastNotes];
        lastNotes[side] = input.pastNotes;
        state = { lastNotes };
      }
    }
    on(TIMER_PM_CHARA_DANCE);
  }
  return { changes: { start, startOnce: [], stop }, state };
}
