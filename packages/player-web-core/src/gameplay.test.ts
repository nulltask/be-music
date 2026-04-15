import { createEmptyJson } from '@be-music/json';
import { describe, expect, test } from 'vitest';
import { createBeatResolver } from '../../chart/src/index.ts';
import { BrowserScrollDistanceMapper } from './browser-scroll-distance.ts';
import {
  createBeatAtSecondsResolverFromTimingResolver,
  createScrollTimeline,
  createSpeedTimeline,
  createTimingResolver,
} from './timing.ts';
import { extractWebTimedNotes } from './web-playable-notes.ts';

describe('player-web-core gameplay timing', () => {
  test('timing resolver applies STOP duration to later beats', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.resources.stop['01'] = 192;
    json.events.push({
      measure: 1,
      channel: '09',
      position: [0, 1],
      value: '01',
    });

    const resolver = createTimingResolver(json);

    expect(resolver.beatToSeconds(4)).toBeCloseTo(2, 6);
    expect(resolver.beatToSeconds(8)).toBeCloseTo(6, 6);
  });

  test('extractWebTimedNotes resolves LNOBJ long notes and suppresses the end object', () => {
    const json = createEmptyJson('bms');
    json.bms.lnObjs = ['ZZ'];
    json.events.push(
      {
        measure: 0,
        channel: '11',
        position: [0, 1],
        value: '01',
      },
      {
        measure: 1,
        channel: '11',
        position: [0, 1],
        value: 'ZZ',
      },
    );

    const timed = extractWebTimedNotes(json);

    expect(timed.playableNotes).toHaveLength(1);
    expect(timed.playableNotes[0]!.channel).toBe('11');
    expect(timed.playableNotes[0]!.beat).toBeCloseTo(0, 6);
    expect(timed.playableNotes[0]!.endBeat).toBeCloseTo(4, 6);
  });

  test('scroll and speed timelines preserve zero, negative, and interpolated visual motion', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.bms.scroll['01'] = 0;
    json.bms.scroll['02'] = -1;
    json.bms.speed['01'] = 1;
    json.bms.speed['02'] = 4;
    json.events.push(
      { measure: 0, channel: 'SC', position: [0, 1], value: '01' },
      { measure: 0, channel: 'SC', position: [1, 2], value: '02' },
      { measure: 0, channel: 'SP', position: [0, 1], value: '01' },
      { measure: 0, channel: 'SP', position: [1, 2], value: '02' },
    );

    const beatResolver = createBeatResolver(json);
    const scrollTimeline = createScrollTimeline(json, beatResolver);
    const speedTimeline = createSpeedTimeline(json, beatResolver);
    const mapper = new BrowserScrollDistanceMapper(scrollTimeline, speedTimeline);

    expect(scrollTimeline).toEqual([
      { beat: 0, speed: 0 },
      { beat: 2, speed: -1 },
    ]);
    expect(speedTimeline).toEqual([
      { beat: 0, speed: 1 },
      { beat: 2, speed: 4 },
    ]);
    expect(mapper.distanceBetween(0, 1)).toBeCloseTo(0, 6);
    expect(mapper.distanceBetween(0, 3)).toBeLessThan(0);
    expect(mapper.speedAtBeat(1)).toBeCloseTo(2.5, 6);
  });

  test('beat-at-seconds resolver keeps beat fixed while STOP is active', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.resources.stop['01'] = 192;
    json.events.push({
      measure: 0,
      channel: '09',
      position: [2, 4],
      value: '01',
    });

    const resolver = createTimingResolver(json);
    const beatAtSeconds = createBeatAtSecondsResolverFromTimingResolver(resolver);

    expect(beatAtSeconds(0.5)).toBeCloseTo(1, 6);
    expect(beatAtSeconds(1.2)).toBeCloseTo(2, 6);
    expect(beatAtSeconds(2.8)).toBeCloseTo(2, 6);
    expect(beatAtSeconds(3.5)).toBeCloseTo(3, 6);
  });
});
