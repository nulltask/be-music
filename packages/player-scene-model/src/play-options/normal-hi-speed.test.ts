import { expect, test } from 'vite-plus/test';
import {
  AC32_HI_SPEED_BASE,
  NORMAL_HI_SPEED_GREEN_NUMBERS,
  resolveNormalHiSpeed,
  resolveNormalHiSpeedLevel,
} from './normal-hi-speed.ts';
import { createHiSpeedState, reduceHiSpeed } from '../play-state/hi-speed.ts';
import { resolvePlayOptions } from './choices.ts';

test('uses the AC 32 measured full-lane green-number table instead of uniform multiplier steps', () => {
  expect(NORMAL_HI_SPEED_GREEN_NUMBERS).toEqual([
    1200, 1000, 800, 700, 650, 600, 550, 500, 480, 460, 440, 420, 400, 380, 360, 340, 320, 300, 280, 260,
  ]);
  for (let level = 1; level <= 20; level += 1) {
    const speed = resolveNormalHiSpeed(level, 150)!;
    expect(AC32_HI_SPEED_BASE / speed / 150).toBeCloseTo(NORMAL_HI_SPEED_GREEN_NUMBERS[level - 1]!);
    expect(resolveNormalHiSpeedLevel(speed, 150)).toBe(level);
  }
  expect(resolveNormalHiSpeed(0, 150)).toBeUndefined();
  expect(resolveNormalHiSpeed(21, 150)).toBeUndefined();
  expect(resolveNormalHiSpeed(3, 0)).toBeUndefined();
});

test('retains the multiplier after a BPM change until the player changes the normal level', () => {
  const initial = createHiSpeedState({ normalLevel: 3, bpm: 120 });
  expect(initial.player).toBeCloseTo(AC32_HI_SPEED_BASE / 800 / 120);
  const changed = reduceHiSpeed(initial, { type: 'hi-speed-step', delta: 0.1, bpm: 240 });
  expect(changed.normalLevel).toBe(4);
  expect(changed.normalBPM).toBe(240);
  expect(changed.player).toBeCloseTo(AC32_HI_SPEED_BASE / 700 / 240);
  expect(reduceHiSpeed(initial, { type: 'hi-speed-step', delta: 0 })).toBe(initial);
  const last = createHiSpeedState({ normalLevel: 20, bpm: 120 });
  expect(reduceHiSpeed(last, { type: 'hi-speed-step', delta: 1, bpm: 240 })).toBe(last);
});

test('maps source multipliers to a skin scale without clipping slow-BPM levels to the old API range', () => {
  const source = createHiSpeedState({ normalLevel: 20, bpm: 10 });
  expect(source.player).toBeGreaterThan(6);
  const mapped = reduceHiSpeed(source, { type: 'hi-speed-scale', multiplier: (4 * 36000) / AC32_HI_SPEED_BASE });
  expect(mapped.player).toBe(source.player);
  expect(mapped.drawn).toBeCloseTo((4 * 36000) / 260 / 10);
  const explicit = reduceHiSpeed(source, { type: 'hi-speed-set', value: resolveNormalHiSpeed(8, 120)!, bpm: 120 });
  expect(explicit.normalLevel).toBe(8);
});

test('keeps the original multiplier API by default and makes the source profiles mutually exclusive', () => {
  expect(resolvePlayOptions().normalHiSpeedLevel).toBe(0);
  expect(resolvePlayOptions({ normalHiSpeedLevel: 3, hsFix: 'STARTBPM' })).toMatchObject({
    normalHiSpeedLevel: 3,
    hsFix: 'OFF',
  });
  expect(resolvePlayOptions({ classicHiSpeed: true, normalHiSpeedLevel: 3, hiSpeed: 2.3 })).toMatchObject({
    normalHiSpeedLevel: 0,
    hiSpeed: 2.25,
  });
});
