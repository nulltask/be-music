import { createEmptyJSON } from '@be-music/chart-source';
import { describe, expect, test } from 'vite-plus/test';
import {
  bmsExRankValueToJudgeRankPercent,
  resolveBMSJudgeWindowsMsForExRankValue,
  resolveBMSJudgeWindowsMsForPercent,
  resolveBMSRankJudgeRankPercent,
  resolveJudgeRankPercent,
  resolveLR2GambolWindowsMs,
  resolveLR2NonstopRankWindowsMs,
  resolveJudgeWindowsMs,
} from './judge-window.ts';

describe('judge-window', () => {
  test('resolveBMSRankJudgeRankPercent maps #RANK onto the percent axis, NORMAL outside 0-3', () => {
    expect([0, 1, 2, 3, 4, 5, -1, 1.7].map(resolveBMSRankJudgeRankPercent)).toEqual([25, 50, 75, 100, 75, 75, 75, 50]);
  });

  test("resolveLR2NonstopRankWindowsMs reads LR2's NONSTOP rank table", () => {
    expect(resolveLR2NonstopRankWindowsMs(0)).toEqual({ pgreat: 12, great: 24, good: 60, bad: 200 });
    expect(resolveLR2NonstopRankWindowsMs(1)).toEqual({ pgreat: 15, great: 30, good: 80, bad: 200 });
    expect(resolveLR2NonstopRankWindowsMs(2)).toEqual({ pgreat: 18, great: 40, good: 100, bad: 200 });
    expect(resolveLR2NonstopRankWindowsMs(3)).toEqual({ pgreat: 21, great: 60, good: 120, bad: 200 });
    expect(resolveLR2NonstopRankWindowsMs(4)).toEqual({ pgreat: 18, great: 40, good: 100, bad: 200 });
    expect(resolveLR2NonstopRankWindowsMs(3, 50)).toEqual({ pgreat: 21, great: 50, good: 50, bad: 50 });
  });

  test('resolveLR2GambolWindowsMs reads GAMBOL per level and table', () => {
    expect(resolveLR2GambolWindowsMs(1, 'opening')).toEqual({ pgreat: 8, great: 24, good: 40, bad: 200 });
    expect(resolveLR2GambolWindowsMs(2, 'opening')).toEqual({ pgreat: 8, great: 12, good: 12, bad: 200 });
    expect(resolveLR2GambolWindowsMs(1, 'nonstop')).toEqual({ pgreat: 12, great: 24, good: 60, bad: 200 });
    expect(resolveLR2GambolWindowsMs(2, 'nonstop')).toEqual({ pgreat: 12, great: 12, good: 12, bad: 200 });
    expect(resolveLR2GambolWindowsMs(1, 'opening', 10)).toEqual({ pgreat: 8, great: 10, good: 10, bad: 10 });
  });

  test('BMS: #RANK maps onto the measured LR2 windows with a fixed ±200ms BAD gate', () => {
    const expectations: Array<[number, number, number, number]> = [
      [0, 8, 24, 40], // VERY HARD
      [1, 15, 30, 60], // HARD
      [2, 18, 40, 100], // NORMAL
      [3, 21, 60, 120], // EASY
      [4, 18, 40, 100], // VERY EASY — LR2 treats #RANK 4 as NORMAL
    ];
    for (const [rank, pgreat, great, good] of expectations) {
      const json = createEmptyJSON('bms');
      json.metadata.rank = rank;
      const windows = resolveJudgeWindowsMs(json);
      expect(windows.pgreat, `rank ${rank}`).toBeCloseTo(pgreat, 6);
      expect(windows.great, `rank ${rank}`).toBeCloseTo(great, 6);
      expect(windows.good, `rank ${rank}`).toBeCloseTo(good, 6);
      expect(windows.bad, `rank ${rank}`).toBe(200);
    }
  });

  test('BMS: out-of-range #RANK falls back to NORMAL', () => {
    const fallbackJSON = createEmptyJSON('bms');
    fallbackJSON.metadata.rank = 99;
    const windows = resolveJudgeWindowsMs(fallbackJSON);
    expect(windows.pgreat).toBeCloseTo(18, 6);
    expect(windows.bad).toBe(200);
  });

  test('BMS: #DEFEXRANK scales the #RANK 2 windows by its percentage and overrides #RANK', () => {
    const json = createEmptyJSON('bms');
    json.metadata.rank = 0;
    json.bms.defExRank = 120; // 120 % of #RANK 2 (±18 / ±40 / ±100), not a point between NORMAL and EASY

    const windows = resolveJudgeWindowsMs(json);
    expect(windows.pgreat).toBeCloseTo(21.6, 6);
    expect(windows.great).toBeCloseTo(48, 6);
    expect(windows.good).toBeCloseTo(120, 6);
    expect(windows.bad).toBe(200);
  });

  test.each([
    [100, [18, 40, 100]],
    [50, [9, 20, 50]],
    [25, [4.5, 10, 25]],
    [133.33, [23.9994, 53.332, 133.33]],
    [0.5, [0.09, 0.2, 0.5]],
  ] as const)('BMS: #DEFEXRANK %d is that percentage of the #RANK 2 windows', (defExRank, [pgreat, great, good]) => {
    const json = createEmptyJSON('bms');
    json.bms.defExRank = defExRank;
    const windows = resolveJudgeWindowsMs(json);
    expect(windows.pgreat).toBeCloseTo(pgreat, 6);
    expect(windows.great).toBeCloseTo(great, 6);
    expect(windows.good).toBeCloseTo(good, 6);
    expect(windows.bad).toBe(200);
  });

  test('BMS: a #DEFEXRANK that is not a positive number leaves #RANK in force', () => {
    for (const defExRank of [0, -50, Number.NaN]) {
      const json = createEmptyJSON('bms');
      json.metadata.rank = 3;
      json.bms.defExRank = defExRank;
      expect(resolveJudgeWindowsMs(json)).toEqual({ pgreat: 21, great: 60, good: 120, bad: 200 });
    }
  });

  test('BMS: a large #DEFEXRANK never widens a window past the BAD gate', () => {
    const json = createEmptyJSON('bms');
    json.bms.defExRank = 1000; // GOOD would be 1000 ms and GREAT 400 ms without the clamp

    const windows = resolveJudgeWindowsMs(json);
    expect(windows.good).toBe(200);
    expect(windows.great).toBe(200);
    expect(windows.pgreat).toBeCloseTo(180, 6); // below the gate
    expect(windows.bad).toBe(200);
    expect(resolveJudgeWindowsMs(json, 150)).toEqual({ pgreat: 150, great: 150, good: 150, bad: 150 });
  });

  test('bmson judge_rank stays on LR2’s rank anchors, unlike #DEFEXRANK', () => {
    const bmsonJSON = createEmptyJSON('bmson');
    bmsonJSON.bmson.info.judgeRank = 120; // percent 90, between NORMAL (75) and EASY (100)
    const windows = resolveJudgeWindowsMs(bmsonJSON);
    expect(windows.pgreat).toBeCloseTo(19.8, 6);
    expect(windows.great).toBeCloseTo(52, 6);
    expect(windows.good).toBeCloseTo(112, 6);
  });

  test('BMSON: judge rank prefers bmson info, then metadata, then the NORMAL default', () => {
    const bmsonJSON = createEmptyJSON('bmson');
    bmsonJSON.bmson.info.judgeRank = 140; // percent 105
    bmsonJSON.metadata.rank = 60;
    expect(resolveJudgeWindowsMs(bmsonJSON).great).toBeCloseTo(40 + 30 * ((60 - 40) / 25), 6); // 64

    bmsonJSON.bmson.info.judgeRank = 0; // invalid → metadata rank 60 → percent 45
    expect(resolveJudgeWindowsMs(bmsonJSON).pgreat).toBeCloseTo(8 + 20 * ((15 - 8) / 25), 6); // 13.6

    bmsonJSON.metadata.rank = 0; // invalid → spec default 100 → percent 75 (NORMAL)
    expect(resolveJudgeWindowsMs(bmsonJSON).good).toBeCloseTo(100, 6);
    expect(resolveJudgeWindowsMs(bmsonJSON).bad).toBe(200);
  });

  test('resolveBMSJudgeWindowsMsForPercent honors the debug bad window override only for BAD', () => {
    const windows = resolveBMSJudgeWindowsMsForPercent(75, 310);

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
      const json = createEmptyJSON('bms');
      json.metadata.rank = rank;
      expect(resolveJudgeRankPercent(json), `rank ${rank}`).toBe(percent);
    }
  });

  test('resolveJudgeRankPercent: #DEFEXRANK wins over #RANK, and NORMAL is the default', () => {
    const json = createEmptyJSON('bms');
    json.metadata.rank = 0;
    json.bms.defExRank = 120; // 120 × 75 / 100
    expect(resolveJudgeRankPercent(json)).toBeCloseTo(90, 9);

    expect(resolveJudgeRankPercent(createEmptyJSON('bms'))).toBe(75);
  });

  test('resolveJudgeRankPercent: bmson prefers info.judge_rank, then metadata, then the spec default', () => {
    const json = createEmptyJSON('bmson');
    json.bmson.info.judgeRank = 140;
    json.metadata.rank = 60;
    expect(resolveJudgeRankPercent(json)).toBeCloseTo(105, 9); // 140 × 75 / 100

    json.bmson.info.judgeRank = 0; // invalid → metadata rank 60 → 45
    expect(resolveJudgeRankPercent(json)).toBeCloseTo(45, 9);

    expect(resolveJudgeRankPercent(createEmptyJSON('bmson'))).toBe(75); // judge_rank 100 default
  });

  test('resolveBMSJudgeWindowsMsForExRankValue shares the RANK 2 = 100 unit with #DEFEXRANK', () => {
    const dynamic = resolveBMSJudgeWindowsMsForExRankValue(100);
    expect(dynamic).toEqual(resolveBMSJudgeWindowsMsForPercent(bmsExRankValueToJudgeRankPercent(100)));
    expect(dynamic.pgreat).toBeCloseTo(18, 6);
    expect(dynamic.bad).toBe(200);

    // `#EXRANK 120` is the same 120 % of #RANK 2 as `#DEFEXRANK 120`.
    const json = createEmptyJSON('bms');
    json.bms.defExRank = 120;
    expect(resolveBMSJudgeWindowsMsForExRankValue(120)).toEqual(resolveJudgeWindowsMs(json));
    expect(resolveBMSJudgeWindowsMsForExRankValue(120).great).toBeCloseTo(48, 6);
    // A value that is not a positive number changes nothing, and the debug BAD width caps every window.
    expect(resolveBMSJudgeWindowsMsForExRankValue(0)).toEqual(dynamic);
    expect(resolveBMSJudgeWindowsMsForExRankValue(300, 100)).toEqual({ pgreat: 54, great: 100, good: 100, bad: 100 });
  });
});
