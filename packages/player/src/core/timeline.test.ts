import { createEmptyJson, type BeMusicEvent } from '@be-music/json';
import { describe, expect, test } from 'vitest';
import { createBeatAtSecondsResolver } from './timeline.ts';

function createStopEvent(measure: number, numerator: number, denominator: number, value: string): BeMusicEvent {
  return {
    measure,
    channel: '09',
    position: [numerator, denominator],
    value,
  };
}

describe('timeline', () => {
  test('createBeatAtSecondsResolver: keeps beat fixed while a stop window is active', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.resources.stop['01'] = 192;
    json.events = [createStopEvent(0, 2, 4, '01')];

    const beatAtSeconds = createBeatAtSecondsResolver(json);
    expect(beatAtSeconds(0)).toBe(0);
    expect(beatAtSeconds(0.5)).toBeCloseTo(1, 6);
    expect(beatAtSeconds(1.2)).toBeCloseTo(2, 6);
    expect(beatAtSeconds(2.8)).toBeCloseTo(2, 6);
    expect(beatAtSeconds(3.5)).toBeCloseTo(3, 6);
  });

  test('createBeatAtSecondsResolver: works for non-monotonic queries', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.resources.stop['01'] = 192;
    json.events = [createStopEvent(0, 2, 4, '01')];

    const beatAtSeconds = createBeatAtSecondsResolver(json);
    expect(beatAtSeconds(4.2)).toBeCloseTo(4.4, 6);
    expect(beatAtSeconds(0.5)).toBeCloseTo(1, 6);
    expect(beatAtSeconds(3.5)).toBeCloseTo(3, 6);
  });
});
