import { describe, expect, test } from 'vitest';
import { BrowserScrollDistanceMapper } from './browser-scroll-distance.ts';

describe('player-web-core browser scroll distance', () => {
  test('uses beat distance when no scroll or speed timeline is present', () => {
    const mapper = new BrowserScrollDistanceMapper();

    expect(mapper.distanceBetween(0, 2)).toBeCloseTo(2, 6);
    expect(mapper.scrollAtBeat(0)).toBe(1);
    expect(mapper.speedAtBeat(0)).toBe(1);
  });

  test('keeps zero and negative scroll segments intact', () => {
    const mapper = new BrowserScrollDistanceMapper([
      { beat: 0, speed: 0 },
      { beat: 2, speed: -1 },
    ]);

    expect(mapper.distanceBetween(0, 1)).toBeCloseTo(0, 6);
    expect(mapper.distanceBetween(0, 3)).toBeCloseTo(-1, 6);
    expect(mapper.scrollAtBeat(1)).toBe(0);
    expect(mapper.scrollAtBeat(2.5)).toBe(-1);
  });

  test('interpolates SPEED keyframes into larger visual spacing', () => {
    const baseline = new BrowserScrollDistanceMapper();
    const accelerated = new BrowserScrollDistanceMapper(undefined, [
      { beat: 0, speed: 1 },
      { beat: 0.5, speed: 4 },
    ]);

    expect(accelerated.distanceBetween(0, 0.5)).toBeGreaterThan(baseline.distanceBetween(0, 0.5));
    expect(accelerated.speedAtBeat(0.25)).toBeCloseTo(2.5, 6);
  });
});
