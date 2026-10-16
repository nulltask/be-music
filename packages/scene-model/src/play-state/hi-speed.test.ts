import { describe, expect, test } from 'vite-plus/test';
import { HISPEED_MAX } from '../play-options/hi-speed.ts';
import { createHiSpeedState, reduceHiSpeed, resolveHsFixMultiplier } from './hi-speed.ts';

describe('resolveHsFixMultiplier', () => {
  const tempo = { referenceBpm: 150, bpms: [150, 300, 75], mainBpm: 120 };

  test('keeps the maximum, minimum or main BPM at the player hi-speed', () => {
    expect(resolveHsFixMultiplier('MAXBPM', tempo)).toBe(0.5);
    expect(resolveHsFixMultiplier('MINBPM', tempo)).toBe(2);
    expect(resolveHsFixMultiplier('AVERAGE', tempo)).toBe(1.25);
    // CONSTANT scrolls as AVERAGE until the scroll can follow every BPM change.
    expect(resolveHsFixMultiplier('CONSTANT', tempo)).toBe(1.25);
  });

  test('reads a negative BPM at its magnitude and falls back to the reference without a main BPM', () => {
    expect(resolveHsFixMultiplier('MAXBPM', { referenceBpm: 150, bpms: [150, -600] })).toBe(0.25);
    expect(resolveHsFixMultiplier('AVERAGE', { referenceBpm: 150, bpms: [150] })).toBe(1);
  });

  test('is 1 without HS-FIX, a reference BPM or a positive BPM', () => {
    expect(resolveHsFixMultiplier('OFF', tempo)).toBe(1);
    expect(resolveHsFixMultiplier('MAXBPM', { bpms: [150] })).toBe(1);
    expect(resolveHsFixMultiplier('MAXBPM', { referenceBpm: 150, bpms: [0, Number.NaN] })).toBe(1);
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

  test('ignores the player while a course locks the hi-speed, but not the host', () => {
    const locked = createHiSpeedState({ hiSpeed: 2, locked: true });
    expect(reduceHiSpeed(locked, { type: 'hi-speed-step', delta: 0.1 })).toBe(locked);
    expect(reduceHiSpeed(locked, { type: 'hi-speed-drawn', value: 3 })).toBe(locked);
    expect(reduceHiSpeed(locked, { type: 'hi-speed-set', value: 3 })).toMatchObject({ player: 3, drawn: 3 });
  });

  test('stops at the end of the range', () => {
    const top = createHiSpeedState({ hiSpeed: HISPEED_MAX });
    expect(reduceHiSpeed(top, { type: 'hi-speed-step', delta: 0.1 })).toBe(top);
  });
});
