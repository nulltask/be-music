import { describe, expect, test } from 'vitest';
import { resolveJudgeWindowsMs } from '../../player/src/core/judge-window.ts';
import { createEmptyJson } from '@be-music/json';
import {
  applyFastSlowForBrowserJudge,
  isBrowserScoreTargetChannel,
  resolveBrowserJudgeFromDeltaMs,
  resolveLandmineGaugeEffect,
} from './browser-manual-judge.ts';

describe('player-web-core browser manual judge', () => {
  test('resolves manual judges from timing deltas', () => {
    const windows = resolveJudgeWindowsMs(createEmptyJson('bms'));
    expect(resolveBrowserJudgeFromDeltaMs(0, windows)).toBe('PERFECT');
    expect(resolveBrowserJudgeFromDeltaMs(windows.great - 1, windows)).toBe('GREAT');
    expect(resolveBrowserJudgeFromDeltaMs(windows.good - 1, windows)).toBe('GOOD');
    expect(resolveBrowserJudgeFromDeltaMs(windows.bad - 1, windows)).toBe('BAD');
    expect(resolveBrowserJudgeFromDeltaMs(windows.bad + 1, windows)).toBe('POOR');
  });

  test('tracks FAST/SLOW only for GREAT and GOOD', () => {
    const counters = { fast: 0, slow: 0 };
    applyFastSlowForBrowserJudge(counters, 'GREAT', -18);
    applyFastSlowForBrowserJudge(counters, 'GOOD', 27);
    applyFastSlowForBrowserJudge(counters, 'PERFECT', -12);
    expect(counters).toEqual({ fast: 1, slow: 1 });
  });

  test('resolves landmine damage as base36/2', () => {
    expect(resolveLandmineGaugeEffect({ value: '08' })).toEqual({
      objectValue: '08',
      damage: 4,
      gaugeDelta: -4,
    });
    expect(resolveLandmineGaugeEffect({ value: 'ZZ' }).gaugeDelta).toBe(-647.5);
  });

  test('treats FREE ZONE as a non-score target', () => {
    expect(isBrowserScoreTargetChannel('11')).toBe(true);
    expect(isBrowserScoreTargetChannel('17')).toBe(false);
  });
});
