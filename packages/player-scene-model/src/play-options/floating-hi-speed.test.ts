import { expect, test } from 'vite-plus/test';
import {
  captureFloatingHiSpeed,
  clampFloatingHiSpeed,
  normalizeFloatingLaneCover,
  resolveFloatingHiSpeed,
  resolveFloatingHiSpeedExit,
  stepFloatingHiSpeed,
} from './floating-hi-speed.ts';
import { AC32_HI_SPEED_BASE } from './normal-hi-speed.ts';
import { createHiSpeedState, reduceHiSpeed } from '../play-state/hi-speed.ts';
import { createPlayState, reducePlayState } from '../play-state/state.ts';
import { laneCoversFromPlayOptions } from '../play-state/lane-cover.ts';
import { DEFAULT_PLAY_OPTIONS, resolvePlayOptions } from './choices.ts';

test('floating bounds retain internal precision and clip further edits from the actual boundary', () => {
  expect(clampFloatingHiSpeed(0.1)).toBe(0.5);
  expect(clampFloatingHiSpeed(12)).toBe(10);
  expect(clampFloatingHiSpeed(NaN)).toBeUndefined();
  expect(stepFloatingHiSpeed(2.25, -1)).toBe(1.75);
  expect(stepFloatingHiSpeed(0.75, -1)).toBe(0.5);
  expect(stepFloatingHiSpeed(0.5, 1)).toBe(1);
  expect(stepFloatingHiSpeed(2, 1, true)).toBeCloseTo(2 + 1 / 300, 12);
});

test('cover operation restores the original time after a BPM change, including a zero-delta boundary operation', () => {
  const anchor = captureFloatingHiSpeed(2, 120, 0.75)!;
  expect(resolveFloatingHiSpeed(anchor, 120, 0.5)).toBeCloseTo(4 / 3);
  expect(resolveFloatingHiSpeed(anchor, 240, 0.75)).toBe(1);
  expect(resolveFloatingHiSpeed(anchor, 60, 0.75)).toBe(4);
  expect(resolveFloatingHiSpeed(anchor, 0, 0.75)).toBeUndefined();
  expect(captureFloatingHiSpeed(2, 120, -1)).toBeUndefined();
  const initial = createHiSpeedState({ hiSpeed: 2, floating: true, bpm: 120, visibleFraction: 0.75 });
  const keyed = reduceHiSpeed(initial, { type: 'hi-speed-step', delta: 0.1, bpm: 240 });
  expect(keyed.player).toBe(2.5);
  expect(keyed.floating).toBe(initial.floating);
  expect(reduceHiSpeed(keyed, { type: 'floating-speed-recalculate', bpm: 240, visibleFraction: 0.75 }).player).toBe(1);
});

test('minimum fixed green is 10; clipping changes the shown time without replacing the original anchor', () => {
  const anchor = captureFloatingHiSpeed(10, 120, 0.01)!;
  expect(resolveFloatingHiSpeed(anchor, 120, 0.02)).toBeCloseTo((AC32_HI_SPEED_BASE / 10 / 120) * 0.02);
  expect(resolveFloatingHiSpeed(captureFloatingHiSpeed(2, 120, 0.75)!, 1, 1)).toBe(10);
  expect(resolveFloatingHiSpeed(captureFloatingHiSpeed(2, 120, 0.75)!, 10000, 0.1)).toBe(0.5);
});

test('source exit rounding uses higher classic ties and measured normal boundaries', () => {
  expect(resolveFloatingHiSpeedExit(2.875, 120, true)).toEqual({ hiSpeed: 3 });
  expect(resolveFloatingHiSpeedExit(2.874, 120, true)).toEqual({ hiSpeed: 2.75 });
  for (const [green, level] of [
    [370, 15],
    [371, 14],
    [580, 7],
    [581, 6],
  ] as const)
    expect(resolveFloatingHiSpeedExit(AC32_HI_SPEED_BASE / green / 120, 120, false)?.normalLevel).toBe(level);
});

test('mode changes keep the normal/classic return profile and a course lock rejects edits', () => {
  const base = createHiSpeedState({ classic: true, hiSpeed: 2.75 });
  const enabled = reduceHiSpeed(base, { type: 'floating-speed-mode', enabled: true, bpm: 120, visibleFraction: 0.75 });
  expect(enabled.classic).toBe(true);
  const keyed = reduceHiSpeed(enabled, { type: 'hi-speed-step', delta: 0.1 });
  expect(keyed.player).toBe(3.25);
  expect(
    reduceHiSpeed(keyed, { type: 'floating-speed-mode', enabled: false, bpm: 120, visibleFraction: 0.75 }),
  ).toMatchObject({ player: 3.25, classic: true });
  const locked = { ...enabled, locked: true };
  expect(reduceHiSpeed(locked, { type: 'hi-speed-fine', direction: 1 })).toBe(locked);
  expect(reduceHiSpeed(locked, { type: 'floating-speed-mode', enabled: false, bpm: 120, visibleFraction: 1 })).toBe(
    locked,
  );
});

test('SUDDEN+ adjustment couples the covers and speed; floating selection preserves values over the old generic maximum', () => {
  const options = resolvePlayOptions({
    ...DEFAULT_PLAY_OPTIONS,
    floatingHiSpeed: true,
    hiSpeed: 8,
    hiddenSudden1P: 'SUDDEN',
    // LANE COVER on, so SUDDEN+ shows.
    laneCover: true,
    shutter: 0.25,
  });
  expect(options.hiSpeed).toBe(8);
  expect(options.hsFix).toBe('OFF');
  const covers = laneCoversFromPlayOptions(options, ['1P']);
  const initial = createPlayState({
    view: {
      hiSpeed: createHiSpeedState({
        floating: true,
        hiSpeed: 2,
        bpm: 120,
        visibleFraction: 1 - Math.round(0.25 * 723) / 723,
      }),
      covers,
    },
  });
  const moved = reducePlayState(initial, { type: 'cover-adjust', part: 'sudden', delta: 0, bpm: 240 });
  expect(moved.view.hiSpeed.player).toBe(1);
  expect(moved.view.covers).toBe(initial.view.covers);
});

test('AC measured covers use the full lane, integer pixels and their separate source bounds', () => {
  const cover = normalizeFloatingLaneCover({
    side: '1P',
    sudden: 0.25,
    suddenOn: true,
    hidden: 0,
    hiddenOn: false,
    lift: 0.1,
    liftOn: true,
  });
  expect(cover.sudden).toBe(181 / 723);
  expect(cover.lift).toBe(72 / 723);
  expect(normalizeFloatingLaneCover({ ...cover, sudden: 0 }).sudden).toBe(30 / 723);
  expect(normalizeFloatingLaneCover({ ...cover, lift: 1 }).lift).toBe(600 / 723);
  expect(normalizeFloatingLaneCover({ ...cover, sudden: 1 }).sudden).toBe(651 / 723);
});
