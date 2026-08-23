import { describe, expect, it } from 'vitest';
import type { TaskResult } from 'tinybench';
import { convertTaskResult, createSingleIterationStats, median, resolveComparisonHz } from './task-stats.ts';

describe('median', () => {
  it('returns 0 for an empty list', () => {
    expect(median([])).toBe(0);
  });

  it('returns the middle value for an odd-length list', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two middle values for an even-length list', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('resolveComparisonHz', () => {
  it('prefers median ops/s when it is a positive finite value', () => {
    expect(resolveComparisonHz({ hz: 50, medianHz: 99 })).toBe(99);
  });

  it('falls back to mean hz when median ops/s is missing or non-positive', () => {
    expect(resolveComparisonHz({ hz: 50 })).toBe(50);
    expect(resolveComparisonHz({ hz: 50, medianHz: 0 })).toBe(50);
    expect(resolveComparisonHz({ hz: 50, medianHz: Number.NaN })).toBe(50);
  });

  it('returns 0 when neither value is usable', () => {
    expect(resolveComparisonHz({ hz: 0, medianHz: 0 })).toBe(0);
  });
});

describe('convertTaskResult', () => {
  it('records tinybench v6 median throughput separately from the mean', () => {
    const stats = convertTaskResult({
      period: 10,
      totalTime: 200,
      latency: {
        min: 8,
        max: 20,
        p50: 9,
        p75: 11,
        p99: 18,
        samplesCount: 40,
      },
      throughput: {
        mean: 100,
        p50: 111,
        rme: 2,
      },
    } as TaskResult);

    expect(stats.hz).toBe(100);
    expect(stats.medianHz).toBe(111);
    expect(stats.meanMs).toBe(10);
    expect(stats.p50Ms).toBe(9);
    expect(stats.sampleCount).toBe(40);
  });

  it('falls back to mean throughput when v6 p50 is missing', () => {
    const stats = convertTaskResult({
      period: 10,
      totalTime: 200,
      latency: {
        samplesCount: 10,
      },
      throughput: {
        mean: 80,
      },
    } as TaskResult);

    expect(stats.hz).toBe(80);
    expect(stats.medianHz).toBe(80);
    expect(stats.p50Ms).toBe(10);
  });

  it('derives median ops/s from legacy sample periods', () => {
    const stats = convertTaskResult({
      hz: 100,
      mean: 10,
      samples: [8, 10, 20],
      totalTime: 200,
    } as TaskResult);

    expect(stats.hz).toBe(100);
    expect(stats.p50Ms).toBe(10);
    expect(stats.medianHz).toBe(100);
    expect(stats.sampleCount).toBe(3);
  });
});

describe('createSingleIterationStats', () => {
  it('uses the same value for mean and median when only one sample exists', () => {
    const stats = createSingleIterationStats(4);
    expect(stats.hz).toBe(250);
    expect(stats.medianHz).toBe(250);
    expect(stats.meanMs).toBe(4);
    expect(stats.p50Ms).toBe(4);
    expect(stats.sampleCount).toBe(1);
  });
});
