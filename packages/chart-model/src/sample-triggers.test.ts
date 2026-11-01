import { describe, expect, test } from 'vite-plus/test';
import { createEmptyJSON, type BeMusicEvent } from '@be-music/chart-source';
import {
  collectSampleTriggers,
  createBmsonSamplePlaybackMap,
  createTimingResolver,
  createBeatResolver,
  resolveReferencedBmsWAVResources,
} from './index.ts';

function chart(events: BeMusicEvent[]) {
  const json = createEmptyJSON('bmson');
  json.metadata.bpm = 120;
  json.resources.wav['01'] = 'stem.wav';
  json.events = events;
  return json;
}

function note(quarter: number, c: boolean, channel = '11'): BeMusicEvent {
  return { measure: 0, channel, position: [quarter, 4], value: '01', bmson: { c } };
}

describe('bmson sound slices', () => {
  test('cuts every playable pulse independently of continuation and restart', () => {
    const triggers = collectSampleTriggers(chart([note(0, false), note(1, true), note(2, false), note(3, true)]));
    expect(triggers.map((t) => t.sampleOffsetSeconds)).toEqual([0, 0.5, 0, 0.5]);
    expect(triggers.map((t) => t.sampleDurationSeconds)).toEqual([0.5, 0.5, 0.5, undefined]);
    expect(new Set(triggers.map((t) => t.sampleSliceId)).size).toBe(4);
  });

  test('sorts mixed playable and BGM input before assigning slices', () => {
    const first = note(0, false, '01');
    const second = note(1, true);
    const third = note(2, true, '01');
    const json = chart([first, second, third]);
    const resolver = createTimingResolver(json);
    const slices = createBmsonSamplePlaybackMap(json, resolver, [second, third, first], createBeatResolver(json));
    expect(slices.get(first)).toMatchObject({ offsetSeconds: 0, durationSeconds: 0.5 });
    expect(slices.get(second)).toMatchObject({ offsetSeconds: 0.5, durationSeconds: 0.5 });
    expect(slices.get(third)).toMatchObject({ offsetSeconds: 1, durationSeconds: undefined });
  });

  test('a mixed-flag chord restarts once and shares its slice across lanes', () => {
    const triggers = collectSampleTriggers(chart([note(0, false), note(1, true), note(1, false, '12'), note(2, true)]));
    expect(triggers.map((t) => t.sampleOffsetSeconds)).toEqual([0, 0, 0, 0.5]);
    expect(triggers[1]!.sampleSliceId).toBe(triggers[2]!.sampleSliceId);
    expect(triggers[1]!.sampleDurationSeconds).toBe(0.5);
    expect(triggers[2]!.sampleDurationSeconds).toBe(0.5);
  });

  test('first continuation starts at zero and a STOP extends the slice beginning there', () => {
    const json = chart([note(0, true), note(1, true), note(2, true)]);
    json.resources.stop['01'] = 48;
    json.events.push({ measure: 0, channel: '09', position: [1, 4], value: '01' });
    const triggers = collectSampleTriggers(json);
    expect(triggers.map((t) => t.sampleOffsetSeconds)).toEqual([0, 0.5, 1.5]);
    expect(triggers.map((t) => t.sampleDurationSeconds)).toEqual([0.5, 1, undefined]);
  });

  test('a BPM change inside a continuation run keeps offsets on elapsed time and shortens later slices', () => {
    const json = chart([note(0, true), note(1, true), note(2, true), note(3, true)]);
    json.resources.bpm['01'] = 240;
    json.events.push({ measure: 0, channel: '08', position: [2, 4], value: '01' });
    const triggers = collectSampleTriggers(json);
    // Two beats at 120 BPM (0.5 s each), then beats at 240 BPM (0.25 s each).
    expect(triggers.map((t) => t.sampleOffsetSeconds)).toEqual([0, 0.5, 1, 1.25]);
    expect(triggers.map((t) => t.sampleDurationSeconds)).toEqual([0.5, 0.5, 0.25, undefined]);
  });
});

describe('resolveReferencedBmsWAVResources', () => {
  test('keeps the slots a sample event names and drops declared-only, landmine and tweak-only slots', () => {
    const json = createEmptyJSON('bms');
    json.resources.wav = {
      '01': 'bgm.wav',
      '02': 'note.wav',
      '03': 'invisible.wav',
      '04': 'ln.wav',
      '05': 'unused.wav',
    };
    json.resources.wav['0A'] = 'mine-value.wav';
    json.bms.exWAV = { '02': 'v 0 extended.wav', '06': 'v 0 only-exwav.wav' };
    json.events = [
      { measure: 0, channel: '01', position: [0, 1], value: '01' },
      { measure: 0, channel: '11', position: [0, 1], value: '02' },
      { measure: 0, channel: '31', position: [0, 1], value: '03' },
      { measure: 0, channel: '51', position: [0, 1], value: '04' },
      // A landmine's value is its damage, not a sample.
      { measure: 0, channel: 'D1', position: [0, 1], value: '0A' },
      // A BGA cue shares the key space but plays no sound.
      { measure: 0, channel: '04', position: [0, 1], value: '05' },
    ];
    expect(resolveReferencedBmsWAVResources(json)).toEqual({
      '01': 'bgm.wav',
      '02': 'extended.wav',
      '03': 'invisible.wav',
      '04': 'ln.wav',
    });
  });

  test('matches lower-case base-36 values and bmson sound channel names', () => {
    const bms = createEmptyJSON('bms');
    bms.resources.wav = { AB: 'kick.wav' };
    bms.events = [{ measure: 0, channel: '11', position: [0, 1], value: 'ab' }];
    expect(resolveReferencedBmsWAVResources(bms)).toEqual({ AB: 'kick.wav' });
    const bmson = chart([note(0, false)]);
    bmson.resources.wav['02'] = 'silent.wav';
    expect(resolveReferencedBmsWAVResources(bmson)).toEqual({ '01': 'stem.wav' });
  });
});
