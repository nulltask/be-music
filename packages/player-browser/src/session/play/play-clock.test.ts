import { describe, expect, test } from 'vite-plus/test';
import { chartSecondsFromFrame } from './play-clock.ts';

describe('chartSecondsFromFrame', () => {
  test('runs on from the frame at its tempo', () => {
    const frame = { currentSeconds: 12, clock: { outputSeconds: 100, tempo: 1.5, paused: false } };
    expect(chartSecondsFromFrame(frame, 100)).toBe(12);
    expect(chartSecondsFromFrame(frame, 102)).toBe(15);
  });

  test("holds at a paused frame's second", () => {
    const frame = { currentSeconds: 12, clock: { outputSeconds: 100, tempo: 1, paused: true } };
    expect(chartSecondsFromFrame(frame, 140)).toBe(12);
  });

  test('has nothing to run on from a frame without a clock', () => {
    expect(chartSecondsFromFrame({ currentSeconds: 3 }, 100)).toBeUndefined();
  });
});
