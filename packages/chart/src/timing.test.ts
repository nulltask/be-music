import { describe, expect, test } from 'vite-plus/test';
import { createEmptyJson } from '../../json/src/index.ts';
import {
  collectSampleTriggers,
  createTimingBuildContext,
  createTimingResolver,
  createTimingResolverWithContext,
} from './index.ts';

describe('timing', () => {
  test('integrates BPM changes and stops into seconds', () => {
    const json = createEmptyJson();
    json.metadata.bpm = 120;
    json.resources.bpm['01'] = 240;
    json.resources.stop['01'] = 48;
    json.events = [
      { measure: 1, channel: '08', position: [0, 1], value: '01' },
      { measure: 1, channel: '09', position: [1, 2], value: '01' },
      { measure: 2, channel: '11', position: [0, 1], value: '0A' },
    ];
    const timing = createTimingResolver(json);
    expect(timing.tempoPoints).toEqual([
      { beat: 0, bpm: 120, seconds: 0 },
      { beat: 4, bpm: 240, seconds: 2 },
    ]);
    // 48 / 192 of a 240 BPM measure = 0.25 s.
    expect(timing.stopPoints).toEqual([{ beat: 6, seconds: 0.25, cumulativeSeconds: 0.25 }]);
    // Measure 2 starts at beat 8: 2 s + 4 beats at 240 BPM + the stop.
    expect(timing.beatToSeconds(8)).toBeCloseTo(3.25);
    expect(timing.bpmAtBeat(5)).toBe(240);
  });

  test('reads #STP stops in milliseconds', () => {
    const json = createEmptyJson();
    json.metadata.bpm = 120;
    json.bms.stp = ['001.500 1000'];
    const timing = createTimingResolver(json);
    expect(timing.stopPoints).toEqual([{ beat: 6, seconds: 1, cumulativeSeconds: 1 }]);
  });

  test('the context variant gives the same resolver', () => {
    const json = createEmptyJson();
    json.metadata.bpm = 150;
    json.events = [{ measure: 0, channel: '03', position: [1, 2], value: '78' }];
    const context = createTimingBuildContext(json);
    expect(createTimingResolverWithContext(json, context).tempoPoints).toEqual(createTimingResolver(json).tempoPoints);
  });
});

describe('sample triggers', () => {
  test('collects BGM and lane keysounds but not mines or #LNOBJ tails', () => {
    const json = createEmptyJson();
    json.metadata.bpm = 120;
    json.bms.lnObjs = ['ZZ'];
    json.resources.wav['01'] = 'a.wav';
    json.events = [
      { measure: 0, channel: '01', position: [0, 1], value: '01' },
      { measure: 0, channel: '11', position: [1, 2], value: '01' },
      { measure: 1, channel: '11', position: [0, 1], value: 'ZZ' },
      { measure: 1, channel: 'D1', position: [0, 1], value: '0A' },
    ];
    expect(
      collectSampleTriggers(json).map((trigger) => [
        trigger.seconds,
        trigger.channel,
        trigger.sampleKey,
        trigger.samplePath,
      ]),
    ).toEqual([
      [0, '01', '01', 'a.wav'],
      [1, '11', '01', 'a.wav'],
    ]);
  });
});
