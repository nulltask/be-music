import { describe, expect, test } from 'vite-plus/test';
import { createHiSpeedState } from './hi-speed.ts';
import {
  BE_MUSIC_HI_SPEED_SCALE,
  PlaylogViewCursor,
  resolveBeatorajaPlaylogView,
  resolveGreenNumber,
  resolvePlaylogView,
  resolveWhiteNumber,
} from './view.ts';

describe('PlaylogViewCursor', () => {
  const changes = [
    { timeUs: 1_000_000, hiSpeed: 2.5 },
    { timeUs: 2_000_000, covers: [{ side: '1P' as const, sudden: 0.3, hidden: 0, lift: 0 }] },
  ];

  test('returns the view on the first call and again only when a change comes into force', () => {
    const cursor = new PlaylogViewCursor({ hiSpeed: 2 }, changes);
    expect(cursor.next(0)).toEqual({ hiSpeed: 2 });
    expect(cursor.next(500_000)).toBeUndefined();
    expect(cursor.next(1_000_000)).toEqual({ hiSpeed: 2.5 });
    expect(cursor.next(1_500_000)).toBeUndefined();
    // Past both changes in one step.
    expect(new PlaylogViewCursor({ hiSpeed: 2 }, changes).next(3_000_000)).toEqual({
      hiSpeed: 2.5,
      covers: [{ side: '1P', sudden: 0.3, hidden: 0, lift: 0 }],
    });
  });

  test('follows the playhead back', () => {
    const cursor = new PlaylogViewCursor({ hiSpeed: 2 }, changes);
    expect(cursor.next(1_500_000)).toEqual({ hiSpeed: 2.5 });
    expect(cursor.next(0)).toEqual({ hiSpeed: 2 });
  });

  test('a log without a view gives an empty one once', () => {
    const cursor = new PlaylogViewCursor(undefined);
    expect(cursor.next(0)).toEqual({});
    expect(cursor.next(10_000_000)).toBeUndefined();
  });
});

describe('resolveBeatorajaPlaylogView', () => {
  const input = {
    hiSpeed: 2,
    lanecover: 0.25,
    lift: 0.2,
    hiddenRatio: 0.5,
    hiddenEnabled: true,
    mainBpm: 150,
    sides: ['1P'] as const,
  };

  test('converts the adapter state to fractions of the lane and the visible time at the main BPM', () => {
    expect(resolveBeatorajaPlaylogView(input)).toEqual({
      hiSpeed: 2,
      hiSpeedScale: 'beatoraja',
      // 240000 / 150 / 2 × 0.75
      visibleMs: 600,
      covers: [{ side: '1P', sudden: 0.25, hidden: 0.4, lift: 0.2 }],
    });
  });

  test('a disabled HIDDEN cover is 0, every side gets the cover, and an unknown BPM leaves the visible time out', () => {
    const view = resolveBeatorajaPlaylogView({ ...input, hiddenEnabled: false, mainBpm: 0, sides: ['1P', '2P'] });
    expect(view.visibleMs).toBeUndefined();
    expect(view.covers).toEqual([
      { side: '1P', sudden: 0.25, hidden: 0, lift: 0.2 },
      { side: '2P', sudden: 0.25, hidden: 0, lift: 0.2 },
    ]);
  });

  test('records without float noise', () => {
    // 0.5 × (1 - 0.8) is 0.09999999999999998 in floating point; 240000 / 150 / 3 × 0.9 is 479.99999999999994.
    const view = resolveBeatorajaPlaylogView({ ...input, hiSpeed: 3, lanecover: 0.1, lift: 0.8 });
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

describe('resolvePlaylogView', () => {
  const covers = [{ side: '1P' as const, sudden: 0.3, suddenOn: true, hidden: 0.5, hiddenOn: true, lift: 0.2 }];

  test('records the drawn hi-speed on the scale, the HS-FIX, the covers as drawn and the visible time', () => {
    const hiSpeed = createHiSpeedState({ hiSpeed: 2, multiplier: 1.5 });
    const view = resolvePlaylogView(
      { hiSpeed, covers, hsFix: 'MAXBPM' },
      { scale: BE_MUSIC_HI_SPEED_SCALE, laneBeats: 4, mainBpm: 120 },
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
    const view = resolvePlaylogView({ hiSpeed: createHiSpeedState(), covers: [] }, { scale: 'beatoraja' });
    expect(view).toEqual({ hiSpeed: 2, hiSpeedScale: 'beatoraja', covers: [] });
  });
});
