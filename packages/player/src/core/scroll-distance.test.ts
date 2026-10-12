import { describe, expect, test } from 'vite-plus/test';
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

    // Before the first #SPEED keyframe the speed ramps from 1 at beat 0 to its value (3), as beatoraja ramps from 1.0
    // at time 0, while #SCROLL stays at the implicit 1 until its first event: (1 + 3) / 2 × 4 beats.
    expect(mapper.distanceBetween(0, 4)).toBeCloseTo(8, 6);
    expect(mapper.distanceBetween(4, 8)).toBeCloseTo(16, 6);
  });

  test('#SPEED ramps from 1 at beat 0 to the first keyframe, as beatoraja does', () => {
    const mapper = createScrollDistanceMapper(undefined, [{ beat: 4, speed: 2 }]);

    // Speed 1 → 2 across beats 0..4: (1 + 2) / 2 × 4 beats; the value holds after the last keyframe.
    expect(mapper.distanceBetween(0, 4)).toBeCloseTo(6, 6);
    expect(mapper.distanceBetween(4, 6)).toBeCloseTo(4, 6);
    // A keyframe on beat 0 applies from the start, with no ramp.
    expect(createScrollDistanceMapper(undefined, [{ beat: 0, speed: 2 }]).distanceBetween(0, 4)).toBeCloseTo(8, 6);
    // #SCROLL is a step: 1 until its first event.
    const scrollOnly = createScrollDistanceMapper([{ beat: 4, speed: 2 }], undefined);
    expect(scrollOnly.distanceBetween(0, 4)).toBeCloseTo(4, 6);
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

  test('maxBeatWithinDistance solves within interpolated speed segments', () => {
    const mapper = createScrollDistanceMapper(
      undefined,
      [
        { beat: 4, speed: 1 },
        { beat: 8, speed: 3 },
      ],
      { lookaheadBeats: 12 },
    );

    // Speed holds 1 until beat 4, then ramps 1 → 3 toward beat 8: distance(4..t) = (t - 4) + (t - 4)² / 4.
    // distance(0, t) = 8 → solve 4 + (t-4) + (t-4)²/4 = 8 → t = 4 + (-2 + 2√5).
    expect(mapper.maxBeatWithinDistance(0, 8)).toBeCloseTo(4 + (-2 + 2 * Math.sqrt(5)), 6);
  });

  test('firstBeatBeyondDistance finds where the lane is first overrun, through negative and zero scroll', () => {
    // Up 2 beats of distance, back down with SCROLL -1, flat with SCROLL 0, then up again.
    const mapper = createScrollDistanceMapper([
      { beat: 2, speed: -1 },
      { beat: 4, speed: 0 },
      { beat: 6, speed: 1 },
    ]);

    // A 3-beat lane is never overrun before beat 6 (peak distance 2), then at beat 6 + 3.
    expect(mapper.firstBeatBeyondDistance(0, 3)).toBeCloseTo(9, 6);
    // A 1.5-beat lane is overrun on the way up: everything after beat 1.5 lies beyond the lane top, even the notes the
    // negative scroll brings back down — beatoraja stops walking the chart there.
    expect(mapper.firstBeatBeyondDistance(0, 1.5)).toBeCloseTo(1.5, 6);
    // From inside the falling segment the distance first goes negative, so the overrun comes after the climb.
    expect(mapper.firstBeatBeyondDistance(3, 1)).toBeCloseTo(6 + 2, 6);
  });

  test('firstBeatBeyondDistance is infinite when the lane is never overrun', () => {
    expect(createScrollDistanceMapper([{ beat: 2, speed: 0 }]).firstBeatBeyondDistance(0, 4)).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(createScrollDistanceMapper([{ beat: 2, speed: -1 }]).firstBeatBeyondDistance(0, 4)).toBe(
      Number.POSITIVE_INFINITY,
    );
    // #SPEED 0 holds the notes still for good.
    expect(createScrollDistanceMapper(undefined, [{ beat: 0, speed: 0 }]).firstBeatBeyondDistance(0, 4)).toBe(
      Number.POSITIVE_INFINITY,
    );
    // Plain scroll: the lane ends `distance` beats ahead.
    expect(createScrollDistanceMapper().firstBeatBeyondDistance(5, 4)).toBeCloseTo(9, 6);
  });

  test('firstBeatBeyondDistance solves within interpolated #SPEED segments', () => {
    const mapper = createScrollDistanceMapper(undefined, [
      { beat: 4, speed: 1 },
      { beat: 8, speed: 3 },
    ]);
    expect(mapper.firstBeatBeyondDistance(0, 8)).toBeCloseTo(mapper.maxBeatWithinDistance(0, 8), 6);
  });

  test('invalidDistance option customizes invalid input fallback', () => {
    const mapper = createScrollDistanceMapper(undefined, undefined, { invalidDistance: 0 });
    expect(mapper.distanceBetween(Number.NaN, 2)).toBe(0);
  });
});
