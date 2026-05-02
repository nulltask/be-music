import { describe, expect, test } from 'vitest';
import { createScrollDistanceMapper } from './scroll-distance.ts';

describe('scroll distance', () => {
  test('distanceBetween integrates plain beat distance', () => {
    const mapper = createScrollDistanceMapper();
    expect(mapper.distanceBetween(2, 6)).toBeCloseTo(4, 6);
    expect(mapper.distanceBetween(6, 2)).toBeCloseTo(-4, 6);
    expect(mapper.distanceBetween(Number.NaN, 2)).toBeNaN();
  });

  test('distanceBetween integrates #SCROLL and interpolated #SPEED segments', () => {
    const mapper = createScrollDistanceMapper(
      [{ beat: 4, speed: 2 }],
      [
        { beat: 4, speed: 3 },
        { beat: 8, speed: 1 },
      ],
    );

    expect(mapper.distanceBetween(0, 4)).toBeCloseTo(8, 6);
    expect(mapper.distanceBetween(4, 8)).toBeCloseTo(16, 6);
  });

  test('lookahead helpers handle bidirectional and zero-scroll segments', () => {
    const mapper = createScrollDistanceMapper(
      [
        { beat: 2, speed: -1 },
        { beat: 4, speed: 0 },
        { beat: 6, speed: 1 },
      ],
      undefined,
      { lookaheadBeats: 8 },
    );

    expect(mapper.hasBidirectionalScrollWithinLookahead(0)).toBe(true);
    expect(mapper.maxBeatWithinDistance(4, 1)).toBeCloseTo(7, 6);
  });

  test('invalidDistance option customizes invalid input fallback', () => {
    const mapper = createScrollDistanceMapper(undefined, undefined, { invalidDistance: 0 });
    expect(mapper.distanceBetween(Number.NaN, 2)).toBe(0);
  });
});
