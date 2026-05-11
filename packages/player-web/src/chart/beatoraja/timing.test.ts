import { createEmptyJson, type BeMusicJson } from '@be-music/json';
import { describe, expect, it } from 'vitest';
import {
  beatorajaEventBeat,
  computeBeatorajaMeasureLayout,
  hasBeatorajaEventValue,
  resolveBeatorajaBpmEventValue,
  resolveBeatorajaStopDurationBeats,
} from './timing.ts';

function chartWith(overrides: Partial<BeMusicJson>): BeMusicJson {
  return { ...createEmptyJson(), ...overrides };
}

describe('beatoraja timing helpers', () => {
  it('computes measure base beats with declared lengths and event-referenced trailing measures', () => {
    const chart = chartWith({
      measures: [
        { index: 0, length: 0.5 },
        { index: 2, length: 2 },
      ],
      events: [{ measure: 3, channel: '11', position: [0, 1], value: '01' }],
    });

    expect(computeBeatorajaMeasureLayout(chart)).toEqual({
      measureBaseBeat: [0, 2, 6, 14],
      totalBeats: 18,
    });
  });

  it('computes event beats using the existing standard-measure intra-position approximation', () => {
    const measureBaseBeat = [0, 2, 6];

    expect(beatorajaEventBeat({ measure: 2, position: [1, 2] }, measureBaseBeat)).toBe(8);
    expect(beatorajaEventBeat({ measure: 2, position: [1, 0] }, measureBaseBeat)).toBe(6);
    expect(beatorajaEventBeat({ measure: 9, position: [0, 1] }, measureBaseBeat)).toBeUndefined();
  });

  it('filters empty event values consistently', () => {
    expect(hasBeatorajaEventValue('')).toBe(false);
    expect(hasBeatorajaEventValue('00')).toBe(false);
    expect(hasBeatorajaEventValue('01')).toBe(true);
  });

  it('resolves BPM event values from inline hex and case-insensitive table keys', () => {
    expect(resolveBeatorajaBpmEventValue('03', 'F0')).toBe(240);
    expect(resolveBeatorajaBpmEventValue('08', 'aa', { AA: '175.5' })).toBe(175.5);
    expect(resolveBeatorajaBpmEventValue('08', 'BB', { bb: 90 })).toBe(90);
    expect(resolveBeatorajaBpmEventValue('09', 'AA', { AA: 120 })).toBeUndefined();
  });

  it('resolves STOP table values into beat durations', () => {
    expect(resolveBeatorajaStopDurationBeats('XX', { xx: 192 })).toBe(4);
    expect(resolveBeatorajaStopDurationBeats('YY', { YY: '96' })).toBe(2);
    expect(resolveBeatorajaStopDurationBeats('ZZ', { ZZ: 0 })).toBeUndefined();
  });
});
