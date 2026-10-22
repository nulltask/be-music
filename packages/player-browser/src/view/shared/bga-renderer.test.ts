import { describe, expect, test } from 'vite-plus/test';
import { BGA_VIDEO_DRIFT_SECONDS, resolveBGAVideoResync } from './bga-renderer.ts';

describe('resolveBGAVideoResync', () => {
  test('leaves a video in step with the chart alone', () => {
    expect(resolveBGAVideoResync(10, 10 + BGA_VIDEO_DRIFT_SECONDS / 2, 60)).toBeUndefined();
  });

  test('sets a drifted video back to the chart time since its cue, either way', () => {
    expect(resolveBGAVideoResync(10, 30, 60)).toBe(30);
    expect(resolveBGAVideoResync(30, 10, 60)).toBe(10);
  });

  test('leaves a video the chart has played past alone', () => {
    expect(resolveBGAVideoResync(59.9, 75, 60)).toBeUndefined();
    expect(resolveBGAVideoResync(3, 8, Number.NaN)).toBe(8);
    expect(resolveBGAVideoResync(3, -1, 60)).toBeUndefined();
  });
});
