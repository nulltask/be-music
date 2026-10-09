import { describe, expect, it } from 'vite-plus/test';
import { KEY_BEAM_STOPS } from './key-beam.ts';

describe('KEY_BEAM_STOPS', () => {
  it('runs from clear at the top to near solid at the judgement line', () => {
    expect(KEY_BEAM_STOPS[0]).toEqual({ offset: 0, alpha: 0 });
    expect(KEY_BEAM_STOPS[KEY_BEAM_STOPS.length - 1]!.offset).toBe(1);
    expect(KEY_BEAM_STOPS[KEY_BEAM_STOPS.length - 1]!.alpha).toBeGreaterThanOrEqual(0.85);
  });

  it('only ever brightens toward the judgement line', () => {
    for (let index = 1; index < KEY_BEAM_STOPS.length; index += 1) {
      expect(KEY_BEAM_STOPS[index]!.offset).toBeGreaterThan(KEY_BEAM_STOPS[index - 1]!.offset);
      expect(KEY_BEAM_STOPS[index]!.alpha).toBeGreaterThan(KEY_BEAM_STOPS[index - 1]!.alpha);
    }
  });

  it('keeps the upper half of the beam faint so falling notes stay readable', () => {
    const upper = KEY_BEAM_STOPS.filter((stop) => stop.offset <= 0.5);
    for (const stop of upper) expect(stop.alpha).toBeLessThanOrEqual(0.1);
  });
});
