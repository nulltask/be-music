import type { PlaylogRulesetId, PlaylogRulesetResult } from '@be-music/player/playlog';

/**
 * Clear lamps on one scale shared by every ruleset, so best scores and sorting compare plain integers. A ruleset never
 * awards a lamp its source game does not have: LR2 and IIDX stop at FULL COMBO, beatoraja goes up to MAX.
 */
export const ClearLamp = {
  FAILED: 1,
  ASSIST_EASY: 2,
  EASY: 3,
  NORMAL: 4,
  HARD: 5,
  EX_HARD: 6,
  FULL_COMBO: 7,
  PERFECT: 8,
  MAX: 9,
} as const;

export type ClearLamp = (typeof ClearLamp)[keyof typeof ClearLamp];

/** Lamp a cleared run earns from its gauge, before full-combo upgrades (ruleset gauge ids, see `definitions.ts`). */
const GAUGE_LAMPS: Readonly<Record<string, ClearLamp>> = {
  'ASSIST-EASY': ClearLamp.ASSIST_EASY,
  'ASSISTED-EASY': ClearLamp.ASSIST_EASY,
  EASY: ClearLamp.EASY,
  GROOVE: ClearLamp.NORMAL,
  NORMAL: ClearLamp.NORMAL,
  HARD: ClearLamp.HARD,
  'EX-HARD': ClearLamp.EX_HARD,
  DEATH: ClearLamp.EX_HARD,
  HAZARD: ClearLamp.EX_HARD,
};

const TOP_LAMP: Readonly<Record<PlaylogRulesetId, ClearLamp>> = {
  lr2: ClearLamp.FULL_COMBO,
  beatoraja: ClearLamp.MAX,
  iidx: ClearLamp.FULL_COMBO,
};

/**
 * The clear lamp of one simulated result. A run that did not clear is FAILED whatever its judgments. A cleared run
 * without a BAD or a missed POOR is a FULL COMBO (empty POORs never break the combo here), without a GOOD also a
 * PERFECT, and with nothing but PGREATs a MAX, each capped at the ruleset's top lamp. An unknown gauge id counts as
 * NORMAL.
 */
export function resolveClearLamp(result: PlaylogRulesetResult, ruleset: PlaylogRulesetId): ClearLamp {
  if (!result.gauge.cleared) {
    return ClearLamp.FAILED;
  }
  const { great, good, bad, poor } = result.judge;
  let lamp: ClearLamp = GAUGE_LAMPS[result.gauge.type] ?? ClearLamp.NORMAL;
  if (bad + poor === 0) {
    lamp = good > 0 ? ClearLamp.FULL_COMBO : great > 0 ? ClearLamp.PERFECT : ClearLamp.MAX;
  }
  return Math.min(lamp, TOP_LAMP[ruleset]) as ClearLamp;
}

/** Miss count (BP): BADs, missed POORs and empty POORs, as LR2 and beatoraja count it. */
export function resolveMissCount(result: PlaylogRulesetResult): number {
  return result.judge.bad + result.judge.poor + result.judge.emptyPoor;
}
