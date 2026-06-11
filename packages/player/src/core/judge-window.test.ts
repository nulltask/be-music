import { createEmptyJson } from '@be-music/json';
import { describe, expect, test } from 'vitest';
import {
  bmsExRankValueToJudgeRankPercent,
  resolveBmsJudgeWindowsMsForExRankValue,
  resolveBmsJudgeWindowsMsForPercent,
  resolveJudgeWindowsMs,
} from './judge-window.ts';

describe('judge-window', () => {
  test('BMS: defExRank overrides metadata rank and scales all windows', () => {
    const json = createEmptyJson('bms');
    json.metadata.rank = 0;
    json.bms.defExRank = 150;

    const windows = resolveJudgeWindowsMs(json);

    expect(windows.pgreat).toBeCloseTo(25.005, 3);
    expect(windows.great).toBeCloseTo(49.995, 3);
    expect(windows.good).toBeCloseTo(175.005, 3);
    expect(windows.bad).toBeCloseTo(375, 6);
  });

  test('BMS: rank table and invalid fallback both resolve correctly', () => {
    const easyJson = createEmptyJson('bms');
    easyJson.metadata.rank = 0;
    expect(resolveJudgeWindowsMs(easyJson).bad).toBeCloseTo(250 / 3, 6);

    const fallbackJson = createEmptyJson('bms');
    fallbackJson.metadata.rank = 99;
    expect(resolveJudgeWindowsMs(fallbackJson).bad).toBeCloseTo(250, 6);
  });

  test('BMSON: judge rank prefers bmson info, then metadata, then default', () => {
    const bmsonJson = createEmptyJson('bmson');
    bmsonJson.bmson.info.judgeRank = 140;
    bmsonJson.metadata.rank = 60;
    expect(resolveJudgeWindowsMs(bmsonJson).bad).toBeCloseTo(350, 6);

    bmsonJson.bmson.info.judgeRank = 0;
    expect(resolveJudgeWindowsMs(bmsonJson).bad).toBeCloseTo(150, 6);

    bmsonJson.metadata.rank = 0;
    expect(resolveJudgeWindowsMs(bmsonJson).bad).toBeCloseTo(250, 6);
  });

  test('resolveBmsJudgeWindowsMsForPercent honors debug bad window override only for BAD', () => {
    const windows = resolveBmsJudgeWindowsMsForPercent(125, 310);

    expect(windows.pgreat).toBeCloseTo(27.783333, 6);
    expect(windows.great).toBeCloseTo(55.55, 6);
    expect(windows.good).toBeCloseTo(194.45, 6);
    expect(windows.bad).toBe(310);
  });

  test('bmsExRankValueToJudgeRankPercent maps the RANK 2 = 100 unit onto the internal 75 baseline', () => {
    expect(bmsExRankValueToJudgeRankPercent(100)).toBeCloseTo(75, 6);
    expect(bmsExRankValueToJudgeRankPercent(120)).toBeCloseTo(90, 6);
    expect(bmsExRankValueToJudgeRankPercent(0)).toBe(0);
  });

  test('resolveBmsJudgeWindowsMsForExRankValue shares the RANK 2 = 100 unit with #DEFEXRANK', () => {
    // `#EXRANK 100` mid-chart must land on the same windows as `#DEFEXRANK 100` (NORMAL) — the dynamic A0 path and the
    // static header path go through the same unit conversion.
    const dynamic = resolveBmsJudgeWindowsMsForExRankValue(100);
    expect(dynamic).toEqual(resolveBmsJudgeWindowsMsForPercent(bmsExRankValueToJudgeRankPercent(100)));
    expect(dynamic.bad).toBeCloseTo(250, 6);

    // `#EXRANK 120` = 1.2× NORMAL, mirroring the documented `#DEFEXRANK 120` example.
    expect(resolveBmsJudgeWindowsMsForExRankValue(120).bad).toBeCloseTo(300, 6);
  });
});
