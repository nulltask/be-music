import { createTimingResolver } from '@be-music/audio-renderer';
import { createBeatResolver, createEmptyJson, type BeMusicEvent } from '@be-music/json';
import { describe, expect, test } from 'vitest';
import {
  createBeatAtSecondsResolver,
  createBpmTimeline,
  createScrollTimeline,
  createSpeedTimeline,
  createStopBeatWindows,
} from './timeline.ts';

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

  test('createBeatAtSecondsResolver: keeps beat fixed during bemaniaDX-style STP windows', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.bms.stp = ['001.500 500', '001.500 4000'];

    const beatAtSeconds = createBeatAtSecondsResolver(json);
    expect(beatAtSeconds(2.9)).toBeCloseTo(5.8, 6);
    expect(beatAtSeconds(3.2)).toBeCloseTo(6, 6);
    expect(beatAtSeconds(7.4)).toBeCloseTo(6, 6);
    expect(beatAtSeconds(8.0)).toBeCloseTo(7, 6);
  });

  test('SCROLL/BPM/STOP: keeps zero and negative scroll with LR2-style stop compensation', () => {
    const json = createEmptyJson('bms');
    const baseBpm = 150;
    json.metadata.bpm = baseBpm;
    json.resources.bpm['01'] = baseBpm * 100001;
    json.resources.stop['01'] = 30000;
    json.bms.scroll['01'] = 0;
    json.bms.scroll['02'] = -1;
    json.events = [
      { measure: 0, channel: '08', position: [0, 1], value: '01' },
      { measure: 0, channel: '09', position: [0, 1], value: '01' },
      { measure: 0, channel: 'SC', position: [0, 1], value: '01' },
      { measure: 0, channel: 'SC', position: [1, 2], value: '02' },
    ];

    const resolver = createTimingResolver(json);
    const beatResolver = createBeatResolver(json);
    const scrollTimeline = createScrollTimeline(json, beatResolver);
    expect(scrollTimeline).toEqual([
      { beat: 0, speed: 0 },
      { beat: 2, speed: -1 },
    ]);

    const bpmTimeline = createBpmTimeline(json, resolver);
    expect(bpmTimeline).toHaveLength(1);
    expect(bpmTimeline[0]).toEqual({ bpm: baseBpm * 100001, seconds: 0 });

    const stopWindows = createStopBeatWindows(resolver);
    expect(stopWindows).toHaveLength(1);
    expect(stopWindows[0]?.durationSeconds).toBeCloseTo((3 / 1920) * (240 / baseBpm), 6);
  });

  test('SPEED: extracts visual speed keyframes from SP channel references', () => {
    const json = createEmptyJson('bms');
    json.bms.speed['01'] = 1;
    json.bms.speed['02'] = 0.5;
    json.events = [
      { measure: 1, channel: 'SP', position: [1, 2], value: '02' },
      { measure: 1, channel: 'SP', position: [0, 2], value: '01' },
    ];

    const beatResolver = createBeatResolver(json);
    expect(createSpeedTimeline(json, beatResolver)).toEqual([
      { beat: 4, speed: 1 },
      { beat: 6, speed: 0.5 },
    ]);
  });
});
