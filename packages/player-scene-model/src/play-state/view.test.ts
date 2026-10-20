import { describe, expect, test } from 'vite-plus/test';
import { createHiSpeedState } from './hi-speed.ts';
import type { PlaySide } from './types.ts';
import {
  BE_MUSIC_HI_SPEED_SCALE,
  BEATORAJA_HI_SPEED_SCALE,
  ReplayViewCursor,
  resolveGreenNumber,
  resolveHiSpeedForWhiteNumber,
  captureReplayView,
  resolveWhiteNumber,
} from './view.ts';

describe('ReplayViewCursor', () => {
  const changes = [
    { timeUs: 1_000_000, hiSpeed: 2.5 },
    { timeUs: 2_000_000, covers: [{ side: '1P' as const, sudden: 0.3, hidden: 0, lift: 0 }] },
  ];

  test('returns the view on the first call and again only when a change comes into force', () => {
    const cursor = new ReplayViewCursor({ hiSpeed: 2 }, changes);
    expect(cursor.next(0)).toEqual({ hiSpeed: 2 });
    expect(cursor.next(500_000)).toBeUndefined();
    expect(cursor.next(1_000_000)).toEqual({ hiSpeed: 2.5 });
    expect(cursor.next(1_500_000)).toBeUndefined();
    // Past both changes in one step.
    expect(new ReplayViewCursor({ hiSpeed: 2 }, changes).next(3_000_000)).toEqual({
      hiSpeed: 2.5,
      covers: [{ side: '1P', sudden: 0.3, hidden: 0, lift: 0 }],
    });
  });

  test('follows the playhead back', () => {
    const cursor = new ReplayViewCursor({ hiSpeed: 2 }, changes);
    expect(cursor.next(1_500_000)).toEqual({ hiSpeed: 2.5 });
    expect(cursor.next(0)).toEqual({ hiSpeed: 2 });
  });

  test('a log without a view gives an empty one once', () => {
    const cursor = new ReplayViewCursor(undefined);
    expect(cursor.next(0)).toEqual({});
    expect(cursor.next(10_000_000)).toBeUndefined();
  });
});

describe('resolveReplayView on the beatoraja scale', () => {
  /** A beatoraja view: one cover state on every side, a lane four beats long, the visible time at the main BPM. */
  function beatorajaView(view: {
    hiSpeed: number;
    lanecover: number;
    lift: number;
    hiddenRatio: number;
    hiddenEnabled: boolean;
    mainBPM: number;
    sides: readonly PlaySide[];
  }) {
    const covers = view.sides.map((side) => ({
      side,
      sudden: view.lanecover,
      suddenOn: true,
      hidden: view.hiddenRatio,
      hiddenOn: view.hiddenEnabled,
      lift: view.lift,
    }));
    return captureReplayView(
      { hiSpeed: createHiSpeedState({ hiSpeed: view.hiSpeed }), covers },
      { scale: BEATORAJA_HI_SPEED_SCALE, laneBeats: 4, ...(view.mainBPM > 0 ? { mainBPM: view.mainBPM } : {}) },
    );
  }
  const input = {
    hiSpeed: 2,
    lanecover: 0.25,
    lift: 0.2,
    hiddenRatio: 0.5,
    hiddenEnabled: true,
    mainBPM: 150,
    sides: ['1P'] as const,
  };

  test('records the covers as fractions of the lane and the visible time at the main BPM', () => {
    expect(beatorajaView(input)).toEqual({
      hiSpeed: 2,
      hiSpeedScale: 'beatoraja',
      // 240000 / 150 / 2 × 0.75
      visibleMs: 600,
      covers: [{ side: '1P', sudden: 0.25, hidden: 0.4, lift: 0.2 }],
    });
  });

  test('a disabled HIDDEN cover is 0, every side gets the cover, and an unknown BPM leaves the visible time out', () => {
    const view = beatorajaView({ ...input, hiddenEnabled: false, mainBPM: 0, sides: ['1P', '2P'] });
    expect(view.visibleMs).toBeUndefined();
    expect(view.covers).toEqual([
      { side: '1P', sudden: 0.25, hidden: 0, lift: 0.2 },
      { side: '2P', sudden: 0.25, hidden: 0, lift: 0.2 },
    ]);
  });

  test('records without float noise', () => {
    // 0.5 × (1 - 0.8) is 0.09999999999999998 in floating point; 240000 / 150 / 3 × 0.9 is 479.99999999999994.
    const view = beatorajaView({ ...input, hiSpeed: 3, lanecover: 0.1, lift: 0.8 });
    expect(view.visibleMs).toBe(480);
    expect(view.covers).toEqual([{ side: '1P', sudden: 0.1, hidden: 0.1, lift: 0.8 }]);
  });
});

describe('resolveWhiteNumber / resolveGreenNumber', () => {
  test("is beatoraja's white number for a lane four beats long", () => {
    // 240000 / 150 / 2 × (1 - 0.25)
    expect(resolveWhiteNumber({ laneBeats: 4, hiSpeed: 2, sudden: 0.25, bpm: 150 })).toBe(600);
    expect(resolveGreenNumber(600)).toBe(360);
  });

  test('divides by the scroll rate and reads 0 for a backward or stopped scroll or a bad input', () => {
    expect(resolveWhiteNumber({ laneBeats: 4, hiSpeed: 1, sudden: 0, bpm: 120, scrollRate: 2 })).toBe(1000);
    expect(resolveWhiteNumber({ laneBeats: 4, hiSpeed: 1, sudden: 0, bpm: 120, scrollRate: 0 })).toBe(0);
    expect(resolveWhiteNumber({ laneBeats: 4, hiSpeed: 0, sudden: 0, bpm: 120 })).toBe(0);
    expect(resolveWhiteNumber({ laneBeats: 0, hiSpeed: 1, sudden: 0, bpm: 120 })).toBe(0);
  });
});

describe('resolveHiSpeedForWhiteNumber', () => {
  test('is the hi-speed that shows the white number', () => {
    // 240000 / 150 / 1000: beatoraja's hi-speed for a white number of 1000 at 150 BPM.
    expect(resolveHiSpeedForWhiteNumber({ laneBeats: 4, sudden: 0, bpm: 150, whiteNumberMs: 1000 })).toBe(1.6);
    // A shorter lane needs a slower scroll for the same time; SUDDEN+ covers part of it.
    expect(resolveHiSpeedForWhiteNumber({ laneBeats: 2, sudden: 0.5, bpm: 120, whiteNumberMs: 250 })).toBe(2);
  });

  test('inverts resolveWhiteNumber', () => {
    const lane = { laneBeats: 5.25, sudden: 0.3, bpm: 147, scrollRate: 1.5 };
    const whiteNumberMs = resolveWhiteNumber({ ...lane, hiSpeed: 2.75 });
    expect(resolveHiSpeedForWhiteNumber({ ...lane, whiteNumberMs })).toBeCloseTo(2.75, 12);
  });

  test('has no answer when nothing of the lane is uncovered or an input is not positive', () => {
    const lane = { laneBeats: 4, sudden: 0, bpm: 150, whiteNumberMs: 1000 };
    expect(resolveHiSpeedForWhiteNumber({ ...lane, sudden: 1 })).toBeUndefined();
    expect(resolveHiSpeedForWhiteNumber({ ...lane, laneBeats: 0 })).toBeUndefined();
    expect(resolveHiSpeedForWhiteNumber({ ...lane, bpm: 0 })).toBeUndefined();
    expect(resolveHiSpeedForWhiteNumber({ ...lane, whiteNumberMs: 0 })).toBeUndefined();
    expect(resolveHiSpeedForWhiteNumber({ ...lane, whiteNumberMs: Number.NaN })).toBeUndefined();
    expect(resolveHiSpeedForWhiteNumber({ ...lane, scrollRate: -1 })).toBeUndefined();
  });
});

describe('resolveReplayView', () => {
  const covers = [{ side: '1P' as const, sudden: 0.3, suddenOn: true, hidden: 0.5, hiddenOn: true, lift: 0.2 }];

  test('records the drawn hi-speed on the scale, the HS-FIX, the covers as drawn and the visible time', () => {
    const hiSpeed = createHiSpeedState({ hiSpeed: 2, multiplier: 1.5 });
    const view = captureReplayView(
      { hiSpeed, covers, hsFix: 'MAXBPM' },
      { scale: BE_MUSIC_HI_SPEED_SCALE, laneBeats: 4, mainBPM: 120 },
    );
    expect(view).toEqual({
      hiSpeed: 3,
      hiSpeedScale: 'be-music',
      hsFix: 'MAXBPM',
      covers: [{ side: '1P', sudden: 0.3, hidden: 0.4, lift: 0.2 }],
      // 4 beats / 3 × 0.7 at 120 BPM: the LIFT does not shorten it.
      visibleMs: 467,
    });
  });

  test('leaves the visible time out without a lane length or a BPM, and the HS-FIX out when it has none', () => {
    const view = captureReplayView({ hiSpeed: createHiSpeedState(), covers: [] }, { scale: 'beatoraja' });
    expect(view).toEqual({ hiSpeed: 2, hiSpeedScale: 'beatoraja', covers: [] });
  });
});
