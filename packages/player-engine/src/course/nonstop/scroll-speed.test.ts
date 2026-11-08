import { describe, expect, test } from 'vite-plus/test';
import { placeNonstopKeyframes } from './scroll-speed.ts';

const window = { start: 10, end: 20 };

describe('placeNonstopKeyframes', () => {
  test('keeps a SCROLL keyframe inside the window and the value in force at its start', () => {
    const own = [
      { seconds: 8, value: 0.5 },
      { seconds: 12, value: 2 },
      { seconds: 21, value: 3 },
    ];
    expect(placeNonstopKeyframes(own, window, { interpolate: false, carried: false, origin: 5 })).toEqual([
      { seconds: 10, value: 0.5 },
      { seconds: 12, value: 2 },
    ]);
  });

  test('resets to 1 at the start of a stage without keyframes after an earlier stage set the channel', () => {
    expect(placeNonstopKeyframes([], window, { interpolate: false, carried: true, origin: 5 })).toEqual([
      { seconds: 10, value: 1 },
    ]);
    expect(placeNonstopKeyframes([], window, { interpolate: false, carried: false, origin: 5 })).toEqual([]);
  });

  test('keeps everything before the window of the first stage', () => {
    const own = [{ seconds: 2, value: 3 }];
    expect(
      placeNonstopKeyframes(
        own,
        { start: Number.NEGATIVE_INFINITY, end: 20 },
        { interpolate: false, carried: false, origin: 0 },
      ),
    ).toEqual(own);
  });

  test('interpolates SPEED at the window start and holds it just before the window ends', () => {
    // From 1 at the stage's time zero (5 s) to 3 at 15 s, then 3 onwards.
    const placed = placeNonstopKeyframes([{ seconds: 15, value: 3 }], window, {
      interpolate: true,
      carried: false,
      origin: 5,
    });
    expect(placed[0]).toEqual({ seconds: 15, value: 3 });
    expect(placed[1]!.seconds).toBeCloseTo(19.999, 6);
    expect(placed[1]!.value).toBe(3);
    const carried = placeNonstopKeyframes([{ seconds: 15, value: 3 }], window, {
      interpolate: true,
      carried: true,
      origin: 5,
    });
    expect(carried[0]).toEqual({ seconds: 10, value: 2 });
  });
});
