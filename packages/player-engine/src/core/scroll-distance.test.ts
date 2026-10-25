import { describe, expect, test } from 'vite-plus/test';
import { createEmptyJSON } from '@be-music/chart-source';
import { createTimingResolver, createBeatAtSecondsResolverFromTimingResolver } from '@be-music/chart-model';
import { createScrollDistanceMapper, createLR2ConstantScrollMapper } from './scroll-distance.ts';

describe('scroll distance', () => {
  test('measures from a remembered start exactly as from a fresh one', () => {
    const timeline = [
      { beat: 0, speed: 1 },
      { beat: 4, speed: -0.5 },
      { beat: 8, speed: 2 },
    ];
    const speeds = [{ beat: 2, speed: 1.5 }];
    const reused = createScrollDistanceMapper(timeline, speeds);
    // A frame measures many objects from one playhead, then the playhead moves on (and back, after a reversal).
    for (const from of [3, 3, 3, 6.5, 6.5, 3, Number.NaN, 10]) {
      for (const to of [0, 3.5, 5, 9, 12]) {
        const fresh = createScrollDistanceMapper(timeline, speeds).distanceBetween(from, to);
        expect(Object.is(reused.distanceBetween(from, to), fresh)).toBe(true);
      }
    }
  });

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

  test('rateAt is the scroll distance per beat at a beat: #SCROLL times the interpolated #SPEED', () => {
    const mapper = createScrollDistanceMapper(
      [
        { beat: 4, speed: -2 },
        { beat: 8, speed: 0 },
      ],
      [
        { beat: 0, speed: 1 },
        { beat: 4, speed: 3 },
      ],
    );
    expect(mapper.rateAt(0)).toBeCloseTo(1, 9);
    expect(mapper.rateAt(2)).toBeCloseTo(2, 9);
    expect(mapper.rateAt(5)).toBeCloseTo(-6, 9);
    expect(mapper.rateAt(9)).toBe(0);
    expect(createScrollDistanceMapper().rateAt(3)).toBe(1);
  });

  test('invalidDistance option customizes invalid input fallback', () => {
    const mapper = createScrollDistanceMapper(undefined, undefined, { invalidDistance: 0 });
    expect(mapper.distanceBetween(Number.NaN, 2)).toBe(0);
  });
});

describe('LR2 HS-FIX CONSTANT', () => {
  test('uses 150-BPM distance across abrupt tempo changes, independently of MAIN or header BPM', () => {
    const mapper = createLR2ConstantScrollMapper([
      { beat: 0, bpm: 120 },
      { beat: 4, bpm: 240 },
      { beat: 8, bpm: 60 },
    ]);
    expect(mapper.distanceBetween(0, 2)).toBeCloseTo(2.5);
    expect(mapper.distanceBetween(4, 8)).toBeCloseTo(2.5);
    expect(mapper.distanceBetween(8, 9)).toBeCloseTo(2.5);
    expect(mapper.distanceBetween(0, 12)).toBeCloseTo(17.5);
    expect(mapper.distanceBetween(12, 0)).toBeCloseTo(-17.5);
    expect(mapper.rateAt(2)).toBeCloseTo(1.25);
    expect(mapper.rateAt(5)).toBeCloseTo(0.625);
    expect(mapper.hasBidirectionalScrollWithinLookahead(0)).toBe(false);
  });

  test('preserves STOPs without stretching the note, LN or bar-line distances', () => {
    const json = createEmptyJSON('bms');
    json.metadata.bpm = 120;
    json.resources.bpm['01'] = 240;
    json.resources.stop['01'] = 192;
    json.events = [
      { measure: 1, channel: '08', position: [0, 1], value: '01' },
      { measure: 1, channel: '09', position: [0, 1], value: '01' },
    ];
    const timing = createTimingResolver(json);
    const beatAt = createBeatAtSecondsResolverFromTimingResolver(timing);
    const mapper = createLR2ConstantScrollMapper(timing.tempoPoints);
    expect(beatAt(2.2)).toBe(4);
    expect(beatAt(2.8)).toBe(4);
    expect(mapper.distanceBetween(beatAt(2.2), 8)).toBeCloseTo(mapper.distanceBetween(beatAt(2.8), 8));
    expect(mapper.distanceBetween(4, 8)).toBeCloseTo(2.5);
    expect(mapper.distanceBetween(3, 6)).toBeCloseTo(2.5);
    expect(timing.beatToSeconds(8)).toBeCloseTo(4);
  });

  test('keeps very high BPM gimmicks within the distance-based lookahead', () => {
    const mapper = createLR2ConstantScrollMapper([{ beat: 0, bpm: 150000 }]);
    expect(mapper.distanceBetween(0, 1000)).toBeCloseTo(1);
    expect(mapper.firstBeatBeyondDistance(0, 3)).toBeCloseTo(3000);
    expect(mapper.maxBeatWithinDistance(0, 3)).toBeCloseTo(3000);
  });

  test('uses the magnitude for a negative-BPM tempo and rejects incomplete or invalid maps', () => {
    expect(createLR2ConstantScrollMapper([{ beat: 0, bpm: -300 }]).distanceBetween(0, 4)).toBe(2);
    for (const tempo of [
      [],
      [{ beat: 1, bpm: 150 }],
      [{ beat: 0, bpm: 0 }],
      [{ beat: 0, bpm: NaN }],
      [{ beat: 0, bpm: Infinity }],
    ]) {
      expect(() => createLR2ConstantScrollMapper(tempo)).toThrow(RangeError);
    }
  });
});

test('LR2 CONSTANT mirrors converted distance, even before chart zero', () => {
  const mapper = createLR2ConstantScrollMapper([
    { beat: 0, bpm: 120 },
    { beat: 4, bpm: 240 },
  ]);
  expect(mapper.mirrorBeatAt(4, 8)).toBeCloseTo(2);
  expect(mapper.mirrorBeatAt(4, 20)).toBeCloseTo(-4);
  for (const forward of [4, 6, 8, 12, 20]) {
    const mirrored = mapper.mirrorBeatAt(4, forward);
    expect(mapper.distanceBetween(mirrored, 4)).toBeCloseTo(mapper.distanceBetween(4, forward));
  }
  expect(mapper.firstBeatBeyondDistance(-4, 2.5)).toBeCloseTo(-2);
  expect(mapper.firstBeatBeyondDistance(-4, 7.5)).toBeCloseTo(2);
  expect(mapper.maxBeatWithinDistance(-4, 7.5)).toBeCloseTo(2);
});
