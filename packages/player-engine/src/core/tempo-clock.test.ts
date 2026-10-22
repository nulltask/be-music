import { describe, expect, test } from 'vite-plus/test';
import { createTempoClock } from './tempo-clock.ts';

describe('createTempoClock', () => {
  test('without a change it reads as the fixed-tempo conversion and the play clock itself', () => {
    const clock = createTempoClock(0.75);
    for (const ms of [0, 1, 16.7, 1234.5, 98_765]) {
      expect(clock.chartSecondsAt(ms)).toBe((ms / 1000) * 0.75);
      expect(clock.initialTempoMsAt(ms)).toBe(ms);
    }
    expect(clock.chartSecondsAt(-10)).toBe(0);
    expect(clock.clockMsAt(1.5)).toBe(2000);
    expect(clock.tempo).toBe(0.75);
  });

  test('a change keeps chart time continuous and runs at the new tempo from then on', () => {
    const clock = createTempoClock(1);
    expect(clock.setTempoAtClockMs(2000, 1.5)).toBe(2);
    expect(clock.tempo).toBe(1.5);
    expect(clock.initialTempo).toBe(1);
    expect(clock.chartSecondsAt(1000)).toBe(1);
    expect(clock.chartSecondsAt(2000)).toBe(2);
    expect(clock.chartSecondsAt(3000)).toBe(3.5);
    expect(clock.clockMsAt(3.5)).toBe(3000);
    expect(clock.clockMsAt(1)).toBe(1000);
    // Milliseconds at the initial tempo stay linear in chart time across the change.
    expect(clock.initialTempoMsAt(3000)).toBeCloseTo(3500, 9);
    expect(clock.setTempoAtClockMs(4000, 0.5)).toBeCloseTo(5, 9);
    expect(clock.chartSecondsAt(6000)).toBeCloseTo(6, 9);
    expect(clock.segments.map((segment) => segment.tempo)).toEqual([1, 1.5, 0.5]);
  });

  test('ignores an unusable tempo or the one in force, and never runs time backwards', () => {
    const clock = createTempoClock(1);
    clock.setTempoAtClockMs(1000, 1);
    clock.setTempoAtClockMs(1000, 0);
    clock.setTempoAtClockMs(1000, Number.NaN);
    expect(clock.segments).toHaveLength(1);
    clock.setTempoAtClockMs(2000, 1.2);
    // A change dated before the last one takes effect where the last one did.
    expect(clock.setTempoAtClockMs(1500, 0.8)).toBe(2);
    expect(clock.segments).toHaveLength(2);
    expect(clock.tempo).toBe(0.8);
    // Undoing it at that instant merges the segments back.
    clock.setTempoAtClockMs(2000, 1);
    expect(clock.segments).toHaveLength(1);
  });

  test('a change at the very start keeps the initial tempo for the milliseconds at the initial tempo', () => {
    const clock = createTempoClock(1);
    clock.setTempoAtClockMs(0, 1.25);
    expect(clock.initialTempo).toBe(1);
    expect(clock.chartSecondsAt(1000)).toBe(1.25);
    expect(clock.initialTempoMsAt(1000)).toBe(1250);
  });

  test('follows a change made at a chart time', () => {
    const clock = createTempoClock(1.2);
    expect(clock.setTempoAtChartSeconds(2.4, 0.6)).toBeCloseTo(2000, 9);
    expect(clock.chartSecondsAt(3000)).toBeCloseTo(3, 9);
    expect(clock.clockMsAt(3)).toBeCloseTo(3000, 9);
  });

  test('a rebase moves chart time to a second at a clock time and keeps the tempo in force', () => {
    const clock = createTempoClock(1);
    clock.setTempoAtClockMs(1000, 1.5);
    clock.rebase(3000, 0.5);
    expect(clock.tempo).toBe(1.5);
    expect(clock.segments).toEqual([{ clockMs: 3000, chartSeconds: 0.5, tempo: 1.5 }]);
    expect(clock.chartSecondsAt(3000)).toBe(0.5);
    expect(clock.chartSecondsAt(5000)).toBeCloseTo(3.5, 9);
    expect(clock.clockMsAt(3.5)).toBeCloseTo(5000, 9);
    // Before the rebase it reads back from the new segment, never below the chart's start.
    expect(clock.chartSecondsAt(0)).toBe(0);
    expect(clock.initialTempo).toBe(1);
  });

  test('a rebase forwards, with a tempo, and a tempo change after it', () => {
    const clock = createTempoClock(2);
    clock.rebase(500, 10, 0.5);
    expect(clock.tempo).toBe(0.5);
    expect(clock.chartSecondsAt(2500)).toBeCloseTo(11, 9);
    // The milliseconds at the initial tempo stay linear in chart time across the rebase.
    expect(clock.initialTempoMsAt(2500)).toBeCloseTo(5500, 9);
    expect(clock.setTempoAtClockMs(2500, 1)).toBeCloseTo(11, 9);
    expect(clock.chartSecondsAt(3500)).toBeCloseTo(12, 9);
    // An unusable tempo keeps the one in force.
    clock.rebase(4000, 1, Number.NaN);
    expect(clock.tempo).toBe(1);
    expect(clock.chartSecondsAt(5000)).toBeCloseTo(2, 9);
  });
});
