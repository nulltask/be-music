import { createEmptyJSON, type BeMusicJSON } from '@be-music/chart-source';
import { describe, expect, test } from 'vite-plus/test';
import { parseJSONDocument } from './bms-json-document.ts';
import { parseBMS, parseChart } from './parser.ts';

describe('parseJSONDocument', () => {
  test('preserves exact gain values, clones the map and keeps base-62 slot case through JSON', () => {
    const source = createEmptyJSON('bms');
    source.bms.base = 62;
    source.resources.wavGain = { '0a': 0.77 * 0.37, '0A': 1.41, '01': 0 };
    const parsed = parseJSONDocument(source);
    expect(parsed.resources.wavGain).toEqual(source.resources.wavGain);
    expect(parseChart(JSON.stringify(parsed), 'json').resources.wavGain).toEqual(source.resources.wavGain);
    parsed.resources.wavGain!['0a'] = 1;
    expect(source.resources.wavGain['0a']).toBe(0.77 * 0.37);
  });
  test.each([null, [], '0.77', { '01': -1 }, { '01': Infinity }, { '01': '0.77' }])(
    'rejects invalid intrinsic gain metadata: %j',
    (gain) => {
      const source = createEmptyJSON();
      (source.resources as unknown as Record<string, unknown>).wavGain = gain;
      expect(() => parseJSONDocument(source)).toThrow(TypeError);
    },
  );
  test('re-reads an emitted BMS-JSON document the way parseChart reads its text', () => {
    const text = JSON.stringify(parseBMS(['#TITLE Doc', '#BPM 150', '#WAV01 kick.wav', '#00111:01'].join('\n')));
    const json = parseJSONDocument(JSON.parse(text) as Partial<BeMusicJSON>);
    expect(json.metadata.title).toBe('Doc');
    expect(json.resources.wav).toEqual({ '01': 'kick.wav' });
    expect(json).toEqual(parseChart(text, 'json'));
  });

  test('moves known BMS extension headers out of metadata.extras', () => {
    const metadata = { ...createEmptyJSON('json').metadata, extras: { LNTYPE: '2', CUSTOM: 'x' } };
    const json = parseJSONDocument({ metadata });
    expect(json.bms.lnType).toBe(2);
    expect(json.metadata.extras).toEqual({ CUSTOM: 'x' });
  });
});

test('JSON round-trip preserves stitched bmson resource keys and source-audio coordinates', () => {
  const chart = createEmptyJSON('bmson');
  chart.bms.base = 62;
  chart.bmson.info.totalUnit = 'absolute';
  chart.resources.wav['100'] = 'stage/sample.wav';
  chart.events = [
    {
      measure: 0,
      channel: '11',
      position: [0, 1],
      value: '100',
      bmson: { c: true, sampleOffsetSeconds: 1.25, sampleDurationSeconds: 0.75 },
    },
  ];
  const parsed = parseJSONDocument(JSON.parse(JSON.stringify(chart)));
  expect(parsed.events).toEqual(chart.events);
  expect(parsed.bmson.info.totalUnit).toBe('absolute');
  expect(parsed.resources.wav['100']).toBe('stage/sample.wav');
  const invalid = JSON.parse(JSON.stringify(chart));
  invalid.events[0].bmson.sampleOffsetSeconds = -1;
  invalid.events[0].bmson.sampleDurationSeconds = 'bad';
  invalid.bmson.info.totalUnit = 'unknown';
  const rejected = parseJSONDocument(invalid);
  expect(rejected.events[0]!.bmson).toEqual({ c: true });
  expect(rejected.bmson.info.totalUnit).toBeUndefined();
});
