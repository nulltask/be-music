import { createEmptyJson } from '@be-music/json';
import { describe, expect, test } from 'vitest';
import {
  bmsExRankValueToJudgeRankPercent,
  resolveBmsJudgeWindowsMsForExRankValue,
  resolveBmsJudgeWindowsMsForPercent,
  resolveJudgeRankPercent,
  resolveJudgeWindowsMs,
} from './judge-window.ts';

describe('judge-window', () => {
  test('BMS: #RANK maps onto the measured LR2 windows with a fixed ±200ms BAD gate', () => {
    const expectations: Array<[number, number, number, number]> = [
      [0, 8, 24, 40], // VERY HARD
      [1, 15, 30, 60], // HARD
      [2, 18, 40, 100], // NORMAL
      [3, 21, 60, 120], // EASY
      [4, 18, 40, 100], // VERY EASY — LR2 treats #RANK 4 as NORMAL
    ];
    for (const [rank, pgreat, great, good] of expectations) {
      const json = createEmptyJson('bms');
      json.metadata.rank = rank;
      const windows = resolveJudgeWindowsMs(json);
      expect(windows.pgreat, `rank ${rank}`).toBeCloseTo(pgreat, 6);
      expect(windows.great, `rank ${rank}`).toBeCloseTo(great, 6);
      expect(windows.good, `rank ${rank}`).toBeCloseTo(good, 6);
      expect(windows.bad, `rank ${rank}`).toBe(200);
    }
  });

  test('BMS: out-of-range #RANK falls back to NORMAL', () => {
    const fallbackJson = createEmptyJson('bms');
    fallbackJson.metadata.rank = 99;
    const windows = resolveJudgeWindowsMs(fallbackJson);
    expect(windows.pgreat).toBeCloseTo(18, 6);
    expect(windows.bad).toBe(200);
  });

  test('BMS: #DEFEXRANK interpolates between the LR2 rank anchors and overrides #RANK', () => {
    const json = createEmptyJson('bms');
    json.metadata.rank = 0;
    json.bms.defExRank = 120; // → percent 90, between NORMAL (75) and EASY (100)

    const windows = resolveJudgeWindowsMs(json);
    expect(windows.pgreat).toBeCloseTo(18 + 15 * ((21 - 18) / 25), 6); // 19.8
    expect(windows.great).toBeCloseTo(40 + 15 * ((60 - 40) / 25), 6); // 52
    expect(windows.good).toBeCloseTo(100 + 15 * ((120 - 100) / 25), 6); // 112
    expect(windows.bad).toBe(200);
  });

  test('BMS: #DEFEXRANK beyond EASY extrapolates but never exceeds the BAD gate', () => {
    const json = createEmptyJson('bms');
    json.bms.defExRank = 1000; // percent 750 — GOOD would extrapolate to 620ms without the clamp

    const windows = resolveJudgeWindowsMs(json);
    expect(windows.good).toBe(200); // clamped to the fixed BAD width
    expect(windows.pgreat).toBeCloseTo(18 + (750 - 75) * ((21 - 18) / 25), 6); // 99, below the gate
    expect(windows.bad).toBe(200);
  });

  test('BMSON: judge rank prefers bmson info, then metadata, then the NORMAL default', () => {
    const bmsonJson = createEmptyJson('bmson');
    bmsonJson.bmson.info.judgeRank = 140; // percent 105
    bmsonJson.metadata.rank = 60;
    expect(resolveJudgeWindowsMs(bmsonJson).great).toBeCloseTo(40 + 30 * ((60 - 40) / 25), 6); // 64

    bmsonJson.bmson.info.judgeRank = 0; // invalid → metadata rank 60 → percent 45
    expect(resolveJudgeWindowsMs(bmsonJson).pgreat).toBeCloseTo(8 + 20 * ((15 - 8) / 25), 6); // 13.6

    bmsonJson.metadata.rank = 0; // invalid → spec default 100 → percent 75 (NORMAL)
    expect(resolveJudgeWindowsMs(bmsonJson).good).toBeCloseTo(100, 6);
    expect(resolveJudgeWindowsMs(bmsonJson).bad).toBe(200);
  });

  test('resolveBmsJudgeWindowsMsForPercent honors the debug bad window override only for BAD', () => {
    const windows = resolveBmsJudgeWindowsMsForPercent(75, 310);

    expect(windows.pgreat).toBeCloseTo(18, 6);
    expect(windows.great).toBeCloseTo(40, 6);
    expect(windows.good).toBeCloseTo(100, 6);
    expect(windows.bad).toBe(310);
  });

  test('bmsExRankValueToJudgeRankPercent maps the RANK 2 = 100 unit onto the internal 75 baseline', () => {
    expect(bmsExRankValueToJudgeRankPercent(100)).toBeCloseTo(75, 6);
    expect(bmsExRankValueToJudgeRankPercent(120)).toBeCloseTo(90, 6);
    expect(bmsExRankValueToJudgeRankPercent(0)).toBe(0);
  });

  test('resolveJudgeRankPercent maps #RANK onto the internal percent axis', () => {
    const expectations: Array<[number, number]> = [
      [0, 25], // VERY HARD
      [1, 50], // HARD
      [2, 75], // NORMAL
      [3, 100], // EASY
      [4, 75], // VERY EASY — LR2 treats #RANK 4 as NORMAL
    ];
    for (const [rank, percent] of expectations) {
      const json = createEmptyJson('bms');
      json.metadata.rank = rank;
      expect(resolveJudgeRankPercent(json), `rank ${rank}`).toBe(percent);
    }
  });

  test('resolveJudgeRankPercent: #DEFEXRANK wins over #RANK, and NORMAL is the default', () => {
    const json = createEmptyJson('bms');
    json.metadata.rank = 0;
    json.bms.defExRank = 120; // 120 × 75 / 100
    expect(resolveJudgeRankPercent(json)).toBeCloseTo(90, 9);

    expect(resolveJudgeRankPercent(createEmptyJson('bms'))).toBe(75);
  });

  test('resolveJudgeRankPercent: bmson prefers info.judge_rank, then metadata, then the spec default', () => {
    const json = createEmptyJson('bmson');
    json.bmson.info.judgeRank = 140;
    json.metadata.rank = 60;
    expect(resolveJudgeRankPercent(json)).toBeCloseTo(105, 9); // 140 × 75 / 100

    json.bmson.info.judgeRank = 0; // invalid → metadata rank 60 → 45
    expect(resolveJudgeRankPercent(json)).toBeCloseTo(45, 9);

    expect(resolveJudgeRankPercent(createEmptyJson('bmson'))).toBe(75); // judge_rank 100 default
  });

  test('resolveBmsJudgeWindowsMsForExRankValue shares the RANK 2 = 100 unit with #DEFEXRANK', () => {
    const dynamic = resolveBmsJudgeWindowsMsForExRankValue(100);
    expect(dynamic).toEqual(resolveBmsJudgeWindowsMsForPercent(bmsExRankValueToJudgeRankPercent(100)));
    expect(dynamic.pgreat).toBeCloseTo(18, 6);
    expect(dynamic.bad).toBe(200);

    // `#EXRANK 120` matches the documented `#DEFEXRANK 120` interpolation.
    expect(resolveBmsJudgeWindowsMsForExRankValue(120).great).toBeCloseTo(52, 6);
  });

});
