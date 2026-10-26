import { expect, test } from 'vite-plus/test';
import { CLASSIC_HI_SPEED_STEPS, snapClassicHiSpeed, stepClassicHiSpeed } from './hi-speed.ts';
import { createHiSpeedState, reduceHiSpeed } from '../play-state/hi-speed.ts';

test('uses the eleven multipliers in the AC 34 official classic window', () => {
  expect(CLASSIC_HI_SPEED_STEPS).toEqual([1, 1.5, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4]);
  expect(stepClassicHiSpeed(1, 1)).toBe(1.5);
  expect(stepClassicHiSpeed(2, 1)).toBe(2.25);
  expect(stepClassicHiSpeed(2, -1)).toBe(1.5);
  expect(stepClassicHiSpeed(1, -1)).toBe(1);
  expect(stepClassicHiSpeed(4, 1)).toBe(4);
});

test('normalizes host values and ignores non-finite input', () => {
  expect(snapClassicHiSpeed(2.3)).toBe(2.25);
  expect(snapClassicHiSpeed(0)).toBe(1);
  expect(snapClassicHiSpeed(10)).toBe(4);
  expect(snapClassicHiSpeed(NaN)).toBeUndefined();
  expect(stepClassicHiSpeed(2, Infinity)).toBeUndefined();
});

test('live steps and host changes use the table while replay drawn values remain authoritative', () => {
  const initial = createHiSpeedState({ classic: true, hiSpeed: 2.3 });
  expect(initial.player).toBe(2.25);
  expect(reduceHiSpeed(initial, { type: 'hi-speed-step', delta: 0.1 }).player).toBe(2.5);
  expect(reduceHiSpeed(initial, { type: 'hi-speed-set', value: 1.6 }).player).toBe(1.5);
  expect(reduceHiSpeed(initial, { type: 'hi-speed-drawn', value: 3.75 }).drawn).toBe(3.75);
  const locked = createHiSpeedState({ classic: true, hiSpeed: 2, locked: true });
  expect(reduceHiSpeed(locked, { type: 'hi-speed-step', delta: 0.1 })).toBe(locked);
});
