import { describe, expect, test } from 'vite-plus/test';
import { HISPEED_MAX } from '../play-options/hi-speed.ts';
import { createHiSpeedState, reduceHiSpeed, resolveHSFixMultiplier } from './hi-speed.ts';

describe('resolveHSFixMultiplier', () => {
  const tempo = { referenceBPM: 150, bpms: [150, 300, 75], mainBPM: 120 };

  test('keeps the maximum, minimum or main BPM at the player hi-speed', () => {
    expect(resolveHSFixMultiplier('MAXBPM', tempo)).toBe(0.5);
    expect(resolveHSFixMultiplier('MINBPM', tempo)).toBe(2);
    expect(resolveHSFixMultiplier('AVERAGE', tempo)).toBe(1.25);
    // CONSTANT's distance mapper already normalizes to 150 BPM; do not apply MAIN again.
    expect(resolveHSFixMultiplier('CONSTANT', tempo)).toBe(1);
  });

  test('anchors START to the header independently of BASEBPM, main BPM and a beat-zero tempo change', () => {
    expect(
      resolveHSFixMultiplier('STARTBPM', { referenceBPM: 150, startBPM: 180, bpms: [300, 75], mainBPM: 120 }),
    ).toBeCloseTo(150 / 180);
    expect(resolveHSFixMultiplier('STARTBPM', { referenceBPM: 150, bpms: [300, 75] })).toBe(0.5);
    expect(resolveHSFixMultiplier('STARTBPM', { referenceBPM: 150, startBPM: 0, bpms: [300] })).toBe(1);
    expect(resolveHSFixMultiplier('STARTBPM', { referenceBPM: 150, startBPM: Number.NaN, bpms: [300] })).toBe(1);
  });

  test('reads a negative BPM at its magnitude and falls back to the reference without a main BPM', () => {
    expect(resolveHSFixMultiplier('MAXBPM', { referenceBPM: 150, bpms: [150, -600] })).toBe(0.25);
    expect(resolveHSFixMultiplier('AVERAGE', { referenceBPM: 150, bpms: [150] })).toBe(1);
  });

  test('is 1 without HS-FIX, a reference BPM or a positive BPM', () => {
    expect(resolveHSFixMultiplier('OFF', tempo)).toBe(1);
    expect(resolveHSFixMultiplier('MAXBPM', { bpms: [150] })).toBe(1);
    expect(resolveHSFixMultiplier('MAXBPM', { referenceBPM: 150, bpms: [0, Number.NaN] })).toBe(1);
  });
});

describe('createHiSpeedState', () => {
  test('draws the player hi-speed times the HS-FIX multiplier, snapped', () => {
    expect(createHiSpeedState({ hiSpeed: 2.5, multiplier: 0.5 })).toEqual({
      player: 2.5,
      drawn: 1.25,
      multiplier: 0.5,
      locked: false,
    });
  });

  test('starts at the default hi-speed and without HS-FIX', () => {
    expect(createHiSpeedState()).toEqual({ player: 2, drawn: 2, multiplier: 1, locked: false });
    expect(createHiSpeedState({ hiSpeed: Number.NaN, multiplier: -1 })).toMatchObject({ player: 2, multiplier: 1 });
  });
});

describe('reduceHiSpeed', () => {
  const fixed = createHiSpeedState({ hiSpeed: 2, multiplier: 0.5 });

  test("steps the player's hi-speed on its own grid and draws it under HS-FIX", () => {
    expect(reduceHiSpeed(fixed, { type: 'hi-speed-step', delta: 0.1 })).toMatchObject({ player: 2.1, drawn: 1.05 });
  });

  test('takes the host setting, HS-FIX on top', () => {
    expect(reduceHiSpeed(fixed, { type: 'hi-speed-set', value: 3 })).toMatchObject({ player: 3, drawn: 1.5 });
    expect(reduceHiSpeed(fixed, { type: 'hi-speed-set', value: Number.NaN })).toBe(fixed);
  });

  test('takes a drawn hi-speed from the engine or a replay, working the player one back', () => {
    expect(reduceHiSpeed(fixed, { type: 'hi-speed-drawn', value: 1.5 })).toMatchObject({ player: 3, drawn: 1.5 });
  });

  test('ignores the player while a course locks the hi-speed, but not the host or a replay', () => {
    const locked = createHiSpeedState({ hiSpeed: 2, locked: true });
    expect(reduceHiSpeed(locked, { type: 'hi-speed-step', delta: 0.1 })).toBe(locked);
    // A replay's recorded view shows the hi-speed the play was locked at, as its recorded covers do.
    expect(reduceHiSpeed(locked, { type: 'hi-speed-drawn', value: 3 })).toEqual({ ...locked, player: 3, drawn: 3 });
    expect(reduceHiSpeed(locked, { type: 'hi-speed-set', value: 3 })).toMatchObject({ player: 3, drawn: 3 });
  });

  test('keeps the lock after a replay sets the hi-speed', () => {
    const locked = createHiSpeedState({ hiSpeed: 2, multiplier: 0.5, locked: true });
    const replayed = reduceHiSpeed(locked, { type: 'hi-speed-drawn', value: 1.5 });
    expect(replayed).toEqual({ player: 3, drawn: 1.5, multiplier: 0.5, locked: true });
    expect(reduceHiSpeed(replayed, { type: 'hi-speed-step', delta: 0.1 })).toBe(replayed);
  });

  test('stops at the end of the range', () => {
    const top = createHiSpeedState({ hiSpeed: HISPEED_MAX });
    expect(reduceHiSpeed(top, { type: 'hi-speed-step', delta: 0.1 })).toBe(top);
  });
});

test('compulsory chart speed bypasses user limits and restores the exact course/classic/floating baseline', () => {
  for (const init of [
    { hiSpeed: 3, multiplier: 0.5, locked: true },
    { hiSpeed: 2, classic: true },
    { hiSpeed: 2, floating: true, bpm: 150 },
  ]) {
    const base = createHiSpeedState(init);
    const forced = reduceHiSpeed(base, { type: 'chart-hi-speed', value: 100 });
    expect(forced).toMatchObject({ player: 100, drawn: 100, multiplier: 1, locked: true });
    expect(reduceHiSpeed(forced, { type: 'hi-speed-set', value: 2 })).toBe(forced);
    expect(reduceHiSpeed(forced, { type: 'hi-speed-step', delta: -1 })).toBe(forced);
    expect(reduceHiSpeed(forced, { type: 'hi-speed-drawn', value: 2 })).toBe(forced);
    expect(reduceHiSpeed(forced, { type: 'chart-hi-speed', value: 100 })).toBe(forced);
    const changed = reduceHiSpeed(forced, { type: 'chart-hi-speed', value: 0.77 });
    expect(changed.drawn).toBe(0.77);
    expect(reduceHiSpeed(changed, { type: 'chart-hi-speed' })).toBe(base);
  }
});
test('invalid chart speed cannot replace user state or a valid override', () => {
  const base = createHiSpeedState();
  for (const value of [NaN, Infinity, 0, 0.24, 100.01])
    expect(reduceHiSpeed(base, { type: 'chart-hi-speed', value })).toBe(base);
});
