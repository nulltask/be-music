import { describe, expect, it } from 'vite-plus/test';
import { resolveChartBpmRange } from './tempo-range.ts';

describe('resolveChartBpmRange', () => {
  it('reports a constant tempo as its own range', () => {
    expect(resolveChartBpmRange([{ bpm: 150, seconds: 0 }], 120)).toEqual({ minBpm: 150, maxBpm: 150, mainBpm: 150 });
  });

  it('picks the BPM held longest as the main BPM, summing every stretch at that BPM', () => {
    const points = [
      { bpm: 120, seconds: 0 },
      { bpm: 240, seconds: 30 },
      { bpm: 120, seconds: 40 },
      { bpm: 60, seconds: 50 },
    ];
    // 120 holds 30 + 10 = 40 s, 240 holds 10 s, 60 holds 50..100 = 50 s.
    expect(resolveChartBpmRange(points, 100)).toEqual({ minBpm: 60, maxBpm: 240, mainBpm: 60 });
    // Ending the chart at 80 s leaves 60 BPM with 30 s, so 120 wins.
    expect(resolveChartBpmRange(points, 80)).toEqual({ minBpm: 60, maxBpm: 240, mainBpm: 120 });
  });

  it('gives a tie to the BPM reached first', () => {
    const points = [
      { bpm: 200, seconds: 0 },
      { bpm: 100, seconds: 10 },
    ];
    expect(resolveChartBpmRange(points, 20)?.mainBpm).toBe(200);
  });

  it('ignores zero and non-finite BPMs', () => {
    const points = [
      { bpm: 140, seconds: 0 },
      { bpm: 0, seconds: 5 },
      { bpm: Number.NaN, seconds: 6 },
      { bpm: 140, seconds: 7 },
    ];
    expect(resolveChartBpmRange(points, 20)).toEqual({ minBpm: 140, maxBpm: 140, mainBpm: 140 });
  });

  it('falls back to the given BPM when no tempo point is usable', () => {
    expect(resolveChartBpmRange([], 60, 130)).toEqual({ minBpm: 130, maxBpm: 130, mainBpm: 130 });
    expect(resolveChartBpmRange([{ bpm: 0, seconds: 0 }], 60, 130)?.mainBpm).toBe(130);
    expect(resolveChartBpmRange([], 60)).toBeUndefined();
    expect(resolveChartBpmRange([], 60, 0)).toBeUndefined();
  });
});
