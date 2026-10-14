import { describe, expect, it } from 'vite-plus/test';
import {
  benchmarkRenderResolution,
  DEFAULT_RENDER_RESOLUTION,
  frameTimes,
  keepsUp,
  nearestRenderResolution,
  parseStoredRenderResolution,
  renderResolutionLabel,
  renderResolutionSteps,
} from './render-resolution.ts';

describe('renderResolutionSteps', () => {
  it('offers 1× up to the display ratio in 0.5 steps', () => {
    expect(renderResolutionSteps(2)).toEqual([1, 1.5, 2]);
    expect(renderResolutionSteps(3)).toEqual([1, 1.5, 2, 2.5, 3]);
  });

  it('closes with the display ratio when it falls between steps', () => {
    expect(renderResolutionSteps(2.625)).toEqual([1, 1.5, 2, 2.5, 2.625]);
    expect(renderResolutionSteps(1.25)).toEqual([1, 1.25]);
  });

  it('offers only the display ratio at or below 1×', () => {
    expect(renderResolutionSteps(1)).toEqual([1]);
    expect(renderResolutionSteps(0.75)).toEqual([0.75]);
  });

  it('treats a missing ratio as 1×', () => {
    expect(renderResolutionSteps(Number.NaN)).toEqual([1]);
  });
});

describe('nearestRenderResolution', () => {
  it('picks the closest step, the lower one on a tie', () => {
    expect(nearestRenderResolution([1, 1.5, 2], 1.5)).toBe(1.5);
    expect(nearestRenderResolution([1, 1.5, 2], 3)).toBe(2);
    expect(nearestRenderResolution([1, 1.5, 2], 1.25)).toBe(1);
    expect(nearestRenderResolution([1], 1.5)).toBe(1);
  });
});

describe('renderResolutionLabel', () => {
  it('prints the value with a multiplication sign', () => {
    expect(renderResolutionLabel(1)).toBe('1×');
    expect(renderResolutionLabel(1.5)).toBe('1.5×');
    expect(renderResolutionLabel(2.625)).toBe('2.625×');
  });
});

describe('parseStoredRenderResolution', () => {
  it('reads a stored number', () => {
    expect(parseStoredRenderResolution('2')).toBe(2);
    expect(parseStoredRenderResolution('1')).toBe(1);
  });

  it('falls back to 1.5× when nothing usable is stored', () => {
    for (const stored of [null, '', 'abc', '0', '-1']) {
      expect(parseStoredRenderResolution(stored)).toBe(DEFAULT_RENDER_RESOLUTION);
    }
    expect(DEFAULT_RENDER_RESOLUTION).toBe(1.5);
  });
});

describe('frameTimes', () => {
  it('reports the median and 90th percentile', () => {
    const intervals = [16, 17, 16, 17, 16, 17, 16, 17, 16, 50];
    expect(frameTimes(intervals)).toEqual({ p50: 17, p90: 50 });
  });

  it('is zero for no frames', () => {
    expect(frameTimes([])).toEqual({ p50: 0, p90: 0 });
  });
});

describe('keepsUp', () => {
  it('allows a quarter over the baseline at the 90th percentile', () => {
    expect(keepsUp({ p50: 16.7, p90: 20.8 }, 16.7)).toBe(true);
    expect(keepsUp({ p50: 16.7, p90: 33.4 }, 16.7)).toBe(false);
  });
});

/** A fake frame clock: each resolution draws in the given ms per frame. */
function fakeDisplay(frameMs: Record<number, number>) {
  let resolution = 0;
  let now = 0;
  const applied: number[] = [];
  return {
    applied,
    apply: (value: number) => {
      resolution = value;
      applied.push(value);
    },
    nextFrame: async () => {
      now += frameMs[resolution]!;
      return now;
    },
  };
}

describe('benchmarkRenderResolution', () => {
  it('picks the highest resolution that holds the frame rate', async () => {
    const display = fakeDisplay({ 1: 16.7, 1.5: 16.7, 2: 33.4 });
    const result = await benchmarkRenderResolution({
      steps: [1, 1.5, 2],
      ...display,
      warmupFrames: 2,
      sampleFrames: 10,
    });
    expect(result.chosen).toBe(1.5);
    expect(result.baseline).toBeCloseTo(16.7);
    expect(result.results.map((entry) => entry.resolution)).toEqual([1, 2, 1.5]);
    expect(display.applied.at(-1)).toBe(1.5);
  });

  it('stops at the highest when it keeps up', async () => {
    const display = fakeDisplay({ 1: 16.7, 1.5: 16.7, 2: 16.7 });
    const result = await benchmarkRenderResolution({
      steps: [1, 1.5, 2],
      ...display,
      warmupFrames: 2,
      sampleFrames: 10,
    });
    expect(result.chosen).toBe(2);
    expect(result.results.map((entry) => entry.resolution)).toEqual([1, 2]);
  });

  it('falls back to the lowest when nothing else keeps up', async () => {
    const display = fakeDisplay({ 1: 16.7, 1.5: 25, 2: 33.4 });
    const result = await benchmarkRenderResolution({
      steps: [1, 1.5, 2],
      ...display,
      warmupFrames: 2,
      sampleFrames: 10,
    });
    expect(result.chosen).toBe(1);
    expect(display.applied.at(-1)).toBe(1);
  });

  it('keeps a high resolution when the CPU, not the resolution, sets the frame rate', async () => {
    const display = fakeDisplay({ 1: 33.4, 1.5: 33.4, 2: 33.4 });
    const result = await benchmarkRenderResolution({
      steps: [1, 1.5, 2],
      ...display,
      warmupFrames: 2,
      sampleFrames: 10,
    });
    expect(result.chosen).toBe(2);
  });

  it('measures the only resolution of a 1x display and keeps it', async () => {
    const display = fakeDisplay({ 1: 16.7 });
    const result = await benchmarkRenderResolution({ steps: [1], ...display, warmupFrames: 2, sampleFrames: 10 });
    expect(result.chosen).toBe(1);
  });
});
