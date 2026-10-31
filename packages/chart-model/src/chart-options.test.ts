import { expect, test } from 'vite-plus/test';
import { cloneJSON, createEmptyJSON } from '@be-music/chart-source';
import { buildChartOptionTimeline } from './chart-options.ts';
import { collectSampleTriggers } from './sample-triggers.ts';

function chart() {
  const json = createEmptyJSON();
  json.metadata.bpm = 120;
  json.bms.options = ['774:HI-SPEED_x2.00', 'charatbeatHDX:BGAMODE 0', 'unknown:raw argument'];
  json.bms.option = 'legacy stale alias';
  json.bms.changeOption = { '01': '774:HIDDEN_STEALTH', '02': '774:HIDDEN_OFF' };
  json.events = [
    { measure: 1, channel: 'A6', position: [0, 1] as [number, number], value: '01' },
    { measure: 2, channel: 'A6', position: [0, 1] as [number, number], value: '02' },
  ];
  return json;
}

test('retains complete ordered declarations without interpreting unknown vendors or mutating the source', () => {
  const json = chart();
  const before = cloneJSON(json);
  const timeline = buildChartOptionTimeline(json);
  expect(timeline.initial).toEqual(json.bms.options);
  expect(timeline.cues).toEqual([
    { seconds: 2, key: '01', declaration: '774:HIDDEN_STEALTH' },
    { seconds: 4, key: '02', declaration: '774:HIDDEN_OFF' },
  ]);
  timeline.initial[0] = 'edited';
  timeline.cues[0]!.declaration = 'edited';
  expect(json).toEqual(before);
});

test('legacy single-option input works and an explicit empty ordered list overrides it', () => {
  const json = chart();
  delete json.bms.options;
  expect(buildChartOptionTimeline(json).initial).toEqual(['legacy stale alias']);
  json.bms.options = [];
  expect(buildChartOptionTimeline(json).initial).toEqual([]);
});

test('BPM/STOP timing and equal-time normalized IR order survive sorting', () => {
  const json = chart();
  json.resources.stop['01'] = 192;
  json.events.unshift({ measure: 1, channel: '09', position: [0, 1], value: '01' });
  json.events.push({ measure: 2, channel: 'a6', position: [0, 1], value: '01' });
  expect(buildChartOptionTimeline(json).cues.map(({ seconds, declaration }) => [seconds, declaration])).toEqual([
    [2, '774:HIDDEN_STEALTH'],
    [6, '774:HIDDEN_OFF'],
    [6, '774:HIDDEN_STEALTH'],
  ]);
});

test('normalizes padded channels, preserves base-62 keys, ignores rests and retains missing references', () => {
  const json = chart();
  json.bms.base = 62;
  json.bms.changeOption['0a'] = '774:HI-SPEED_x0.77';
  json.events = ['0a', '0A', '00', ''].map((value) => ({ measure: 1, channel: ' a6 ', position: [0, 1], value }));
  expect(buildChartOptionTimeline(json).cues).toEqual([
    { seconds: 2, key: '0a', declaration: '774:HI-SPEED_x0.77' },
    { seconds: 2, key: '0A' },
  ]);
});

test('skips non-finite cue time and never triggers same-id WAV resources', () => {
  const json = chart();
  json.resources.wav = { '01': 'unrelated.wav', '02': 'also-unrelated.wav' };
  expect(collectSampleTriggers(json)).toEqual([]);
  expect(buildChartOptionTimeline(json, { eventToSeconds: () => Infinity }).cues).toEqual([]);
});

test('unresolved branch programs are rejected instead of silently choosing partial initial options', () => {
  const json = chart();
  json.bms.controlFlow.push({ kind: 'directive', command: 'RANDOM', value: '2' });
  expect(() => buildChartOptionTimeline(json)).toThrow('Resolve BMS control flow');
});
