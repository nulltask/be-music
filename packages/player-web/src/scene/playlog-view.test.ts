import { describe, expect, test } from 'vite-plus/test';
import { PlaylogViewCursor, resolveBeatorajaPlaylogView } from './playlog-view.ts';

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
});
