import { describe, expect, it } from 'vite-plus/test';
import { BEATORAJA_NUM, BEATORAJA_OP } from '../runtime-ids.ts';
import type { BeatorajaScoreInput } from './inputs.ts';
import {
  beatorajaChartTotalReadout,
  beatorajaExScoreRate,
  resolveBeatorajaPlayScoreOps,
  resolveBeatorajaScoreNumber,
  type BeatorajaScoreNumberInput,
} from './score.ts';

const SCORE: BeatorajaScoreInput = {
  total: 100,
  perfect: 60,
  great: 20,
  good: 10,
  bad: 4,
  poor: 6,
  exScore: 140,
  score: 81_234,
  fast: 12,
  slow: 18,
};

function input(overrides: Partial<BeatorajaScoreNumberInput> = {}): BeatorajaScoreNumberInput {
  return {
    score: SCORE,
    gauge: { current: 76.5, max: 100, effectiveTotal: 260.4 },
    combo: 33,
    maxCombo: 57,
    earlyLate: {
      PERFECT: { early: 1, late: 2 },
      GREAT: { early: 3, late: 4 },
      GOOD: { early: 5, late: 6 },
      BAD: { early: 7, late: 8 },
      POOR: { early: 9, late: 10 },
    },
    chartTotal: 300,
    ...overrides,
  };
}

describe('resolveBeatorajaScoreNumber', () => {
  it('reads the score, its rates and the combo', () => {
    const numbers = input();
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.POINT, numbers)).toBe(81_234);
    // EX 140 / 200 = 70 %; displayed score 81234 / 100000 = 81.234 %.
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.SCORE_RATE, numbers)).toBe(70);
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.SCORE_RATE_AFTERDOT, numbers)).toBe(0);
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.TOTAL_RATE, numbers)).toBe(81);
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.TOTAL_RATE_AFTERDOT, numbers)).toBe(23);
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.COMBO, numbers)).toBe(33);
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.MAXCOMBO_LIVE, numbers)).toBe(57);
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.TOTALNOTES, numbers)).toBe(100);
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.TOTALNOTES_LIVE, numbers)).toBe(100);
  });

  it('reads the gauge and the TOTAL it runs on', () => {
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.GROOVEGAUGE, input())).toBe(76);
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.GROOVEGAUGE_AFTERDOT, input())).toBe(50);
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.BMS_TOTAL, input())).toBe(260);
    // Before a gauge reports one, the chart header as written; 0 without either.
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.BMS_TOTAL, input({ gauge: undefined }))).toBe(300);
    expect(
      resolveBeatorajaScoreNumber(BEATORAJA_NUM.BMS_TOTAL, input({ gauge: undefined, chartTotal: undefined })),
    ).toBe(0);
  });

  it('reads the judgment counts, the combo breaks and the FAST / SLOW totals', () => {
    const numbers = input();
    expect(
      [
        BEATORAJA_NUM.PERFECT,
        BEATORAJA_NUM.GREAT,
        BEATORAJA_NUM.GOOD,
        BEATORAJA_NUM.BAD,
        BEATORAJA_NUM.POOR,
        BEATORAJA_NUM.MISS,
      ].map((id) => resolveBeatorajaScoreNumber(id, numbers)),
    ).toEqual([60, 20, 10, 4, 6, 6]);
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.COMBOBREAK, numbers)).toBe(10);
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.BAD_PLUS_POOR_PLUS_MISS, numbers)).toBe(10);
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.POOR_PLUS_MISS, numbers)).toBe(6);
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.TOTALEARLY, numbers)).toBe(12);
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.TOTALLATE, numbers)).toBe(18);
  });

  it("reads each judgment's early / late count, MISS reading POOR's unless it has its own", () => {
    const numbers = input();
    expect(
      [
        BEATORAJA_NUM.EARLY_PERFECT,
        BEATORAJA_NUM.LATE_PERFECT,
        BEATORAJA_NUM.EARLY_GREAT,
        BEATORAJA_NUM.LATE_GREAT,
        BEATORAJA_NUM.EARLY_GOOD,
        BEATORAJA_NUM.LATE_GOOD,
        BEATORAJA_NUM.EARLY_BAD,
        BEATORAJA_NUM.LATE_BAD,
        BEATORAJA_NUM.EARLY_POOR,
        BEATORAJA_NUM.LATE_POOR,
        BEATORAJA_NUM.EARLY_MISS,
        BEATORAJA_NUM.LATE_MISS,
      ].map((id) => resolveBeatorajaScoreNumber(id, numbers)),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 9, 10]);
    const withMiss = input({ earlyLate: { POOR: { early: 9, late: 10 }, MISS: { early: 0, late: 0 } } });
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.EARLY_MISS, withMiss)).toBe(0);
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.LATE_MISS, withMiss)).toBe(0);
  });

  it('reads 0 before the engine reports a score, and undefined for an id it does not cover', () => {
    const empty = input({ score: undefined, gauge: undefined, earlyLate: undefined, combo: 0, maxCombo: 0 });
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.POINT, empty)).toBe(0);
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.SCORE_RATE, empty)).toBe(0);
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.GROOVEGAUGE, empty)).toBe(0);
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.EARLY_GOOD, empty)).toBe(0);
    expect(resolveBeatorajaScoreNumber(BEATORAJA_NUM.HISPEED, empty)).toBeUndefined();
  });
});

describe('beatorajaExScoreRate / beatorajaChartTotalReadout', () => {
  it('rates the EX score against twice the judgments', () => {
    expect(beatorajaExScoreRate({ total: 50, exScore: 75 })).toBe(75);
    expect(beatorajaExScoreRate({ total: 0, exScore: 0 })).toBe(0);
    expect(beatorajaExScoreRate(undefined)).toBe(0);
  });

  it('prefers the TOTAL the gauge runs on, floored', () => {
    // A bmson `total: 100` is a percentage; the readout shows the resolved TOTAL, as beatoraja does after
    // `BMSPlayerRule.validate`.
    expect(beatorajaChartTotalReadout({ effectiveTotal: 176.8 }, 100)).toBe(176);
    expect(beatorajaChartTotalReadout({ effectiveTotal: 160.9 }, 200)).toBe(160);
  });

  it('falls back to the chart header without a resolved gauge, and is undefined with neither', () => {
    expect(beatorajaChartTotalReadout(undefined, 320)).toBe(320);
    expect(beatorajaChartTotalReadout({ effectiveTotal: 0 }, 200.7)).toBe(200);
    expect(beatorajaChartTotalReadout(undefined, undefined)).toBeUndefined();
  });
});

describe('resolveBeatorajaPlayScoreOps', () => {
  const RANGE_OPS: readonly number[] = [
    BEATORAJA_OP.P1_BAND_0_9,
    BEATORAJA_OP.P1_BAND_10_19,
    BEATORAJA_OP.P1_BAND_20_29,
    BEATORAJA_OP.P1_BAND_30_39,
    BEATORAJA_OP.P1_BAND_40_49,
    BEATORAJA_OP.P1_BAND_50_59,
    BEATORAJA_OP.P1_BAND_60_69,
    BEATORAJA_OP.P1_BAND_70_79,
    BEATORAJA_OP.P1_BAND_80_89,
    BEATORAJA_OP.P1_BAND_90_99,
    BEATORAJA_OP.P1_BAND_100,
  ];
  const rangesLit = (ops: readonly number[]): number[] => ops.filter((op) => RANGE_OPS.includes(op));

  it('lights the rank and now-rank ops of the EX score with the judgment-exists ops', () => {
    const ops = resolveBeatorajaPlayScoreOps(SCORE, { current: 50, max: 100, clearThreshold: 80 });
    // 70 % is rank A (6/9 ≈ 66.7 %).
    expect(ops).toContain(BEATORAJA_OP.P1_RANK_A);
    expect(ops).toContain(BEATORAJA_OP.RANK_A);
    expect(ops).toContain(BEATORAJA_OP.NOW_A_1P);
    expect(ops).toEqual(
      expect.arrayContaining([
        BEATORAJA_OP.PERFECT_EXIST,
        BEATORAJA_OP.GREAT_EXIST,
        BEATORAJA_OP.GOOD_EXIST,
        BEATORAJA_OP.BAD_EXIST,
        BEATORAJA_OP.POOR_EXIST,
        BEATORAJA_OP.MISS_EXIST,
      ]),
    );
    expect(ops).not.toContain(BEATORAJA_OP.GAUGE_NOW_AT_MAX_1P);
  });

  it("lights the gauge's range (230-240), not the EX score's, as beatoraja and LR2 do", () => {
    // EX score 70 %, gauge 50 %: the 50-59 % op, not 70-79 %.
    expect(rangesLit(resolveBeatorajaPlayScoreOps(SCORE, { current: 50, max: 100 }))).toEqual([
      BEATORAJA_OP.P1_BAND_50_59,
    ]);
    const at = (current: number, max = 100): number[] =>
      rangesLit(resolveBeatorajaPlayScoreOps(SCORE, { current, max }));
    expect(at(0)).toEqual([BEATORAJA_OP.P1_BAND_0_9]);
    expect(at(9.9)).toEqual([BEATORAJA_OP.P1_BAND_0_9]);
    expect(at(10)).toEqual([BEATORAJA_OP.P1_BAND_10_19]);
    expect(at(30)).toEqual([BEATORAJA_OP.P1_BAND_30_39]);
    expect(at(99.9)).toEqual([BEATORAJA_OP.P1_BAND_90_99]);
    expect(at(100)).toEqual([BEATORAJA_OP.P1_BAND_100]);
    // A gauge of another maximum ranges over its own maximum.
    expect(at(48, 120)).toEqual([BEATORAJA_OP.P1_BAND_40_49]);
  });

  it('lights the border op while the gauge would clear, whatever the EX score', () => {
    const border = (current: number, clearThreshold: number): boolean =>
      resolveBeatorajaPlayScoreOps(SCORE, { current, max: 100, clearThreshold }).includes(
        BEATORAJA_OP.P1_BAND_BORDER_OR_MORE,
      );
    expect(border(80, 80)).toBe(true);
    expect(border(79.9, 80)).toBe(false);
    // A survival gauge (border 0) qualifies while above 0.
    expect(border(2, 0)).toBe(true);
    expect(border(0, 0)).toBe(false);
    // An EX score of 85 % on a gauge below its border does not.
    expect(
      resolveBeatorajaPlayScoreOps({ ...SCORE, exScore: 170 }, { current: 60, max: 100, clearThreshold: 80 }),
    ).not.toContain(BEATORAJA_OP.P1_BAND_BORDER_OR_MORE);
  });

  it('lights the full-gauge op at the maximum', () => {
    expect(resolveBeatorajaPlayScoreOps(SCORE, { current: 100, max: 100 })).toContain(BEATORAJA_OP.GAUGE_NOW_AT_MAX_1P);
  });

  it('lights no gauge op without a gauge, and the lowest rank without notes', () => {
    expect(
      resolveBeatorajaPlayScoreOps(
        { total: 0, perfect: 0, great: 0, good: 0, bad: 0, poor: 0, exScore: 0, score: 0 },
        undefined,
      ),
    ).toEqual([BEATORAJA_OP.P1_RANK_F, BEATORAJA_OP.RANK_F, BEATORAJA_OP.NOW_F_1P]);
    expect(rangesLit(resolveBeatorajaPlayScoreOps(SCORE, { current: 0, max: 0 }))).toEqual([]);
  });
});
