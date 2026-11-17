import { describe, expect, test } from 'vite-plus/test';
import { chartSecondsFromFrame, createAudioClockSmoother } from './play-clock.ts';

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

describe('createAudioClockSmoother', () => {
  /** An audio clock that moves in `stepMs` steps while the wall clock moves smoothly, read once per 60 Hz frame. */
  function frames(stepMs: number, count: number, startMs = 0): Array<{ nowMs: number; context: number }> {
    return Array.from({ length: count }, (_, frame) => {
      const nowMs = startMs + frame * (1000 / 60);
      return { nowMs, context: (Math.floor(nowMs / stepMs) * stepMs) / 1000 };
    });
  }

  test('evens out the steps of a stepping audio clock', () => {
    const smoother = createAudioClockSmoother();
    const readings = frames(5.805, 240).map(({ nowMs, context }) => ({
      nowMs,
      raw: context,
      smooth: smoother.read(context, nowMs),
    }));
    const frameErrors = (key: 'raw' | 'smooth'): number[] =>
      readings.slice(61).map((reading, index) => {
        const previous = readings[60 + index]!;
        return Math.abs(reading[key] - previous[key] - (reading.nowMs - previous.nowMs) / 1000) * 1000;
      });
    expect(Math.max(...frameErrors('raw'))).toBeGreaterThan(4);
    // Once the window has filled, each frame advances by the wall time between them, to a fraction of a step.
    expect(Math.max(...frameErrors('smooth'))).toBeLessThan(0.25);
    // And it reads the audio clock on average: within half a step of the raw reading.
    for (const reading of readings.slice(60)) expect(Math.abs(reading.smooth - reading.raw)).toBeLessThan(0.0059);
  });

  test('reads a clock that is not running raw, and starts over after a jump', () => {
    const smoother = createAudioClockSmoother();
    for (const { nowMs, context } of frames(5.805, 120)) smoother.read(context, nowMs);
    // Suspended: the audio clock holds while the wall clock runs on.
    expect(smoother.read(1.5, 5000, false)).toBe(1.5);
    // Resumed after a long pause: the offset jumped, so it follows the raw clock from there.
    expect(smoother.read(1.6, 9000)).toBeCloseTo(1.6, 9);
    // A jump without the context stopping (a stall) also starts over.
    smoother.read(1.61, 9010);
    expect(smoother.read(2.0, 9020)).toBeCloseTo(2.0, 9);
  });

  test('never strays far from the raw reading', () => {
    const smoother = createAudioClockSmoother();
    for (let frame = 0; frame < 30; frame += 1) smoother.read(frame / 60, frame * (1000 / 60));
    // A reading 25 ms behind the average (under the jump threshold) still clamps around itself.
    const smoothed = smoother.read(30 / 60 - 0.025, 30 * (1000 / 60));
    expect(Math.abs(smoothed - (30 / 60 - 0.025))).toBeLessThanOrEqual(0.03);
  });
});
