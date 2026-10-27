import type { JudgeWindowSetUs, RulesetWindowTables } from './definitions.ts';

/**
 * beatoraja 0.8.9 CUSTOM JUDGE (`PlayerConfig.customJudge`): per-judge window rates in percent for keys and scratches,
 * and the key long-note release margin rate. Present only while the option is on.
 */
export interface BeatorajaCustomJudge {
  keyPerfectGreat: number;
  keyGreat: number;
  keyGood: number;
  scratchPerfectGreat: number;
  scratchGreat: number;
  scratchGood: number;
  longNoteMargin: number;
}

/** `PlayerConfig` field defaults. */
export const DEFAULT_BEATORAJA_CUSTOM_JUDGE: Readonly<BeatorajaCustomJudge> = {
  keyPerfectGreat: 400,
  keyGreat: 400,
  keyGood: 100,
  scratchPerfectGreat: 400,
  scratchGreat: 400,
  scratchGood: 100,
  longNoteMargin: 100,
};

/** `PlayerConfig.validate`: PGREAT rates 25..400, every other rate 0..400, as integers. */
export function clampCustomJudgeRate(field: keyof BeatorajaCustomJudge, value: number): number {
  const min = field === 'keyPerfectGreat' || field === 'scratchPerfectGreat' ? 25 : 0;
  if (!Number.isFinite(value)) return DEFAULT_BEATORAJA_CUSTOM_JUDGE[field];
  return Math.max(min, Math.min(400, Math.trunc(value)));
}

/** `BMSPlayer` marks the play ASSIST when any rate (or the LN margin rate) exceeds 100 %. */
export function isCustomJudgeAssist(judge: Readonly<BeatorajaCustomJudge>): boolean {
  return Object.values(judge).some((rate) => rate > 100);
}

/**
 * The rate step of `JudgeWindowRule.create`, after the judgerank stage: scale PGREAT, GREAT and GOOD (Java long
 * arithmetic, truncating), clamp each leg to the BAD leg, then widen a leg narrower than the one inside it.
 */
export function applyJudgeWindowRates(
  set: JudgeWindowSetUs,
  rates: readonly [number, number, number],
): JudgeWindowSetUs {
  const judges = set.judges.map((pair) => [...pair]) as unknown as Array<[number, number]>;
  const bad = judges[3]!;
  for (let judge = 0; judge < 3; judge++) {
    for (let side = 0; side < 2; side++) {
      let value = Math.trunc((judges[judge]![side]! * rates[judge]!) / 100);
      if (Math.abs(value) > Math.abs(bad[side]!)) value = bad[side]!;
      if (judge > 0 && Math.abs(value) < Math.abs(judges[judge - 1]![side]!)) value = judges[judge - 1]![side]!;
      judges[judge]![side] = value;
    }
  }
  return { ...set, judges: judges as unknown as JudgeWindowSetUs['judges'] };
}

/**
 * `JudgeManager.init`: note heads use the key rates and scratch heads the scratch rates, while `JudgeWindow` builds
 * the key and scratch long-note end tables with the key rates.
 */
export function applyCustomJudgeTables(
  tables: RulesetWindowTables,
  judge: Readonly<BeatorajaCustomJudge>,
): RulesetWindowTables {
  const key = [judge.keyPerfectGreat, judge.keyGreat, judge.keyGood] as const;
  const scratch = [judge.scratchPerfectGreat, judge.scratchGreat, judge.scratchGood] as const;
  return {
    note: applyJudgeWindowRates(tables.note, key),
    scratch: applyJudgeWindowRates(tables.scratch, scratch),
    longNoteEnd: applyJudgeWindowRates(tables.longNoteEnd, key),
    longScratchEnd: applyJudgeWindowRates(tables.longScratchEnd, key),
  };
}
