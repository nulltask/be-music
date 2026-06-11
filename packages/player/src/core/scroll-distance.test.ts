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

    // Before the first #SPEED keyframe its value (3) holds flat — Bemuse semantics — while #SCROLL stays at the
    // implicit 1 until its first event: 3 × 1 × 4 beats.
    expect(mapper.distanceBetween(0, 4)).toBeCloseTo(12, 6);
    expect(mapper.distanceBetween(4, 8)).toBeCloseTo(16, 6);
  });

  test('#SPEED holds the first keyframe value before its beat instead of ramping from 1', () => {
    const mapper = createScrollDistanceMapper(undefined, [{ beat: 4, speed: 2 }]);

    expect(mapper.distanceBetween(0, 4)).toBeCloseTo(8, 6);
    // #SCROLL is genuinely 1 before its first event — the head seeding only applies to #SPEED.
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
