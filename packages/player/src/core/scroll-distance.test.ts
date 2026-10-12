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

  test('invalidDistance option customizes invalid input fallback', () => {
    const mapper = createScrollDistanceMapper(undefined, undefined, { invalidDistance: 0 });
    expect(mapper.distanceBetween(Number.NaN, 2)).toBe(0);
  });
});
