import type { CourseClearLamp, PlaylogRulesetId, PlaylogRulesetResult } from '@be-music/player/playlog';

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
  let lamp: ClearLamp = gaugeLamp(result.gauge.type, ruleset);
  if (bad + poor === 0) {
    lamp = good > 0 ? ClearLamp.FULL_COMBO : great > 0 ? ClearLamp.PERFECT : ClearLamp.MAX;
  }
  return Math.min(lamp, TOP_LAMP[ruleset]) as ClearLamp;
}

/**
 * The lamp a cleared run's gauge earns. LR2 awards HARD only for its HARD-family gauges and NORMAL for every other one
 * but EASY, so a DEATH clear is NORMAL there (LR2body.exe CheckClear @0x405da0, CheckCourseClear @0x4086d0); beatoraja and IIDX keep
 * theirs.
 */
export function gaugeLamp(gaugeType: string, ruleset: PlaylogRulesetId): ClearLamp {
  if (ruleset === 'lr2' && gaugeType === 'DEATH') return ClearLamp.NORMAL;
  return GAUGE_LAMPS[gaugeType] ?? ClearLamp.NORMAL;
}

/**
 * Miss count (BP): BADs, missed POORs and empty POORs, as LR2 and beatoraja count it. LR2 adds an empty POOR to its POOR
 * count (LR2body.exe ApplyJudgeNote @0x4061f1), so its BP includes them too.
 */
export function resolveMissCount(result: PlaylogRulesetResult): number {
  return result.judge.bad + result.judge.poor + result.judge.emptyPoor;
}

/**
 * A course lamp (`PlaylogCourseResult.lamp`, already capped at the ruleset's top lamp) on the same scale, so course bests
 * compare like chart bests.
 */
export function toCourseClearLamp(lamp: CourseClearLamp): ClearLamp {
  return ClearLamp[lamp];
}
