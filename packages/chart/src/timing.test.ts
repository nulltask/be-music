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

  test('keeps the last BMS #STOP at one position, as LR2 and beatoraja do', () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.resources.stop['01'] = 48;
    json.resources.stop['02'] = 96;
    json.bms.stp = ['001.000 500'];
    json.events = [
      { measure: 1, channel: '09', position: [0, 1], value: '01' },
      { measure: 1, channel: '09', position: [0, 1], value: '02' },
    ];
    // 96 / 192 of a 120 BPM measure = 1 s replaces the 0.5 s stop; `#STP` lines still add up (0.5 s).
    expect(createTimingResolver(json).stopPoints.map((point) => point.seconds)).toEqual([0.5, 1]);
  });

  test('adds up bmson stop_events on one pulse, as the bmson spec says', () => {
    const json = createEmptyJson('bmson');
    json.metadata.bpm = 120;
    json.resources.stop['01'] = 48;
    json.resources.stop['02'] = 96;
    json.events = [
      { measure: 1, channel: '09', position: [0, 1], value: '01' },
      { measure: 1, channel: '09', position: [0, 1], value: '02' },
    ];
    expect(createTimingResolver(json).stopPoints.at(-1)?.cumulativeSeconds).toBeCloseTo(1.5);
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
