import { expect, test } from 'vite-plus/test';
import { createEmptyJSON, cloneJSON } from '@be-music/chart-source';
import { buildChartTextTimeline, pickChartText } from './chart-text.ts';
import { collectSampleTriggers } from './sample-triggers.ts';
import { isSampleTriggerChannel } from './channels.ts';

function chart() {
  const json = createEmptyJSON();
  json.metadata.bpm = 120;
  json.resources.text = { '00': '"MISS!!"', '01': '"こんにちは  世界"', '02': '""', '03': 'raw "quoted" text' };
  json.events = ['01', '02', '03', '04'].map((value, index) => ({
    measure: index + 1,
    position: [0, 1],
    channel: '99',
    value,
  }));
  return json;
}

test('resolves replacement, explicit clearing and missing-reference clearing at exact cue boundaries', () => {
  const json = chart();
  const before = cloneJSON(json);
  const timeline = buildChartTextTimeline(json);
  expect(timeline.cues.map((cue) => cue.text)).toEqual(['こんにちは  世界', '', 'raw "quoted" text', '']);
  expect(pickChartText(timeline, 1.999)).toBe('');
  expect(pickChartText(timeline, 2)).toBe('こんにちは  世界');
  expect(pickChartText(timeline, 4)).toBe('');
  expect(pickChartText(timeline, 7)).toBe('raw "quoted" text');
  expect(pickChartText(timeline, 8)).toBe('');
  expect(json).toEqual(before);
});

test('TEXT00 is miss-only and explicit empty miss text remains distinct from no declaration', () => {
  const json = chart();
  expect(buildChartTextTimeline(json).missText).toBe('MISS!!');
  expect(pickChartText(buildChartTextTimeline(json), 0)).toBe('');
  json.resources.text['00'] = '""';
  expect(buildChartTextTimeline(json).missText).toBe('');
  delete json.resources.text['00'];
  expect(buildChartTextTimeline(json).missText).toBeUndefined();
});

test('seeking is a stateless lookup and equal-time selections use the last IR cue', () => {
  const json = chart();
  json.events = [json.events[2]!, { ...json.events[0]!, measure: 3 }, json.events[1]!];
  const timeline = buildChartTextTimeline(json);
  expect(pickChartText(timeline, 6)).toBe('こんにちは  世界');
  expect(pickChartText(timeline, 4)).toBe('');
  expect(pickChartText(timeline, 2)).toBe('');
  expect(pickChartText(timeline, 6)).toBe('こんにちは  世界');
});

test('STOP timing delays later text cues on the same chart clock', () => {
  const json = chart();
  json.resources.stop = { '01': 192 };
  json.events.push({ measure: 1, position: [0, 1], channel: '09', value: '01' });
  const timeline = buildChartTextTimeline(json);
  expect(timeline.cues[1]!.seconds).toBe(6);
  expect(pickChartText(timeline, 5.99)).toBe('こんにちは  世界');
  expect(pickChartText(timeline, 6)).toBe('');
});

test('base-62 text ids retain case, zero is a rest, and invalid clock times do not select text', () => {
  const json = chart();
  json.bms.base = 62;
  json.resources.text = { '0a': 'lower', '0A': 'upper', '00': 'miss' };
  json.events = ['0a', '0A', '00'].map((value, measure) => ({ measure, channel: '99', position: [0, 1], value }));
  const timeline = buildChartTextTimeline(json);
  expect(timeline.cues.map((cue) => cue.text)).toEqual(['lower', 'upper']);
  expect(buildChartTextTimeline(json, { eventToSeconds: () => Infinity }).cues).toEqual([]);
});

test.each(['99', ' 99 ', '00000099'])('channel %s never triggers the identically indexed WAV', (channel) => {
  expect(isSampleTriggerChannel(channel)).toBe(false);
});

test('channel 99 cannot become a sample trigger, while ordinary BGM still plays', () => {
  const json = chart();
  json.resources.wav = { '01': 'wrong.wav' };
  json.events.push({ measure: 1, channel: '01', position: [0, 1], value: '01' });
  expect(collectSampleTriggers(json).map((trigger) => trigger.channel)).toEqual(['01']);
});
