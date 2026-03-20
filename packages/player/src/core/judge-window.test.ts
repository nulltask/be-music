import { createEmptyJson } from '@be-music/json';
import { describe, expect, test } from 'vitest';
import { resolveBmsJudgeWindowsMsForPercent, resolveJudgeWindowsMs } from './judge-window.ts';

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
});
