import type { BeatorajaSkin } from '@be-music/beatoraja-skin';
import { describe, expect, test } from 'vite-plus/test';
import { computeAuthoredLaneBottomYPixi, readJudgeComboMetrics } from './skin-metrics.ts';

describe('computeAuthoredLaneBottomYPixi', () => {
  test('takes the lowest lane bottom on screen (Y-up rects flipped to Pixi)', () => {
    const rects = [
      { x: 0, y: 200, w: 40, h: 500 },
      { x: 40, y: 150, w: 40, h: 550 },
    ];
    expect(computeAuthoredLaneBottomYPixi(rects, 720)).toBe(570);
    expect(computeAuthoredLaneBottomYPixi([], 720)).toBeUndefined();
  });
});

describe('readJudgeComboMetrics', () => {
  test('reads each side digit width and the matching value space', () => {
    const skin = {
      judge: [
        { index: 0, numbers: [{ id: 'n1', dst: [{ w: 24 }] }] },
        { index: 1, numbers: [{ id: 'n2', dst: [{ w: 30 }] }] },
      ],
      value: [{ id: 'n2', space: 4 }],
    } as unknown as BeatorajaSkin;
    expect(readJudgeComboMetrics(skin)).toEqual({ 1: { width: 24, space: 0 }, 2: { width: 30, space: 4 } });
  });

  test("falls back to the default skin's 40 px digits", () => {
    expect(readJudgeComboMetrics({} as BeatorajaSkin)).toEqual({
      1: { width: 40, space: 0 },
      2: { width: 40, space: 0 },
    });
  });
});
