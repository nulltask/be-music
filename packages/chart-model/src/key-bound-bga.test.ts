import { createEmptyJSON } from '@be-music/chart-source';
import { expect, test } from 'vite-plus/test';
import { buildKeyBoundBGATimeline, parseBMSKeyBoundBGA, pickKeyBoundBGAFrame } from './key-bound-bga.ts';
import { collectSampleTriggers } from './sample-triggers.ts';
import { isSampleTriggerChannel } from './channels.ts';
import { createTimingResolver } from './timing.ts';

test('parses standard packed frames, millisecond times and the real BMP00 frame', () => {
  expect(parseBMSKeyBoundBGA('100:400:16:0:255,255,255,255 00110022')).toEqual({
    frameIntervalMs: 100,
    durationMs: 400,
    channel: '16',
    loop: false,
    argb: { a: 255, r: 255, g: 255, b: 255 },
    frames: ['00', '11', '00', '22'],
  });
  expect(parseBMSKeyBoundBGA(' 50 : 0 : 29 : 1 : 0, 1, 2, 3 0a0Z ')).toMatchObject({
    durationMs: 0,
    channel: '29',
    loop: true,
    argb: { a: 0, r: 1, g: 2, b: 3 },
    frames: ['0A', '0Z'],
  });
  expect(parseBMSKeyBoundBGA('50:0:11:1:0,0,0,0 0a0Azz', 62)!.frames).toEqual(['0a', '0A', 'zz']);
});

test.each([
  '',
  '10:5:1:FF000000 02 03',
  '0:400:16:0:255,255,255,255 0102',
  '-1:400:16:0:255,255,255,255 0102',
  '100:-1:16:0:255,255,255,255 0102',
  '100:400:10:0:255,255,255,255 0102',
  '100:400:31:0:255,255,255,255 0102',
  '100:400:16:2:255,255,255,255 0102',
  '100:400:16:0:256,255,255,255 0102',
  '100:400:16:0:255,255x,255,255 0102',
  '100:400:16:0:255,255,,255 0102',
  '100:400:16:0:255,255,255,255 010',
  '100:400:16:0:255,255,255,255 01 02',
  '100:400:16:0:255,255,255,255 01-02',
  '100:400:16:0:255,255,255,255',
  '9007199254740992:400:16:0:255,255,255,255 01',
  '100:9007199254740992:16:0:255,255,255,255 01',
])('rejects malformed or legacy SWBGA syntax (%s)', (raw) => {
  expect(parseBMSKeyBoundBGA(raw)).toBeUndefined();
});

test('selects frames at exact millisecond boundaries, holding the last frame and expiring at duration', () => {
  const definition = parseBMSKeyBoundBGA('100:450:16:0:255,255,255,255 001102')!;
  expect(
    [-1, 0, 99.9, 100, 200, 300, 449, 450, Infinity, NaN].map((time) => pickKeyBoundBGAFrame(definition, time)),
  ).toEqual([undefined, '00', '00', '11', '02', '02', '02', undefined, undefined, undefined]);
});

test('held-duration frames loop until their caller releases the key', () => {
  const definition = parseBMSKeyBoundBGA('50:0:11:1:0,0,0,0 01020304')!;
  expect([0, 50, 100, 150, 200, 250, 1000].map((time) => pickKeyBoundBGAFrame(definition, time))).toEqual([
    '01',
    '02',
    '03',
    '04',
    '01',
    '02',
    '01',
  ]);
});

test('builds A5 selections with STOP timing, base-62 ids and stable equal-time ordering without changing the chart', () => {
  const chart = createEmptyJSON('bms');
  chart.bms.base = 62;
  chart.metadata.bpm = 120;
  chart.resources.stop['01'] = 192;
  chart.bms.swBGA['0a'] = '100:400:16:0:255,255,255,255 000102';
  chart.bms.swBGA['0A'] = '50:0:11:1:0,0,0,0 0a0A';
  chart.bms.swBGA['02'] = 'legacy:invalid';
  chart.events = [
    { measure: 0, position: [1, 2], channel: '09', value: '01' },
    ...['0a', '00', 'ZZ', '02', '0A'].map((value) => ({ measure: 1, position: [0, 1] as const, channel: 'a5', value })),
  ];
  const original = structuredClone(chart);
  const cues = buildKeyBoundBGATimeline(chart, createTimingResolver(chart));
  expect(cues.map((cue) => [cue.seconds, cue.definitionId, cue.definition.frames])).toEqual([
    [4, '0a', ['00', '01', '02']],
    [4, '0A', ['0a', '0A']],
  ]);
  expect(buildKeyBoundBGATimeline(chart, { eventToSeconds: () => NaN })).toEqual([]);
  expect(chart).toEqual(original);
});

test('A0–A6 controls never trigger a WAV with the same id, including direct and normalized channel paths', () => {
  const chart = createEmptyJSON('bms');
  chart.resources.wav['61'] = 'keysound.wav';
  for (const channel of ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6']) {
    for (const spelling of [channel, channel.toLowerCase(), ` ${channel.toLowerCase()} `])
      expect(isSampleTriggerChannel(spelling)).toBe(false);
    chart.events.push({ channel, value: '61', measure: 0, position: [0, 1] });
  }
  chart.events.push(
    { channel: '01', value: '61', measure: 0, position: [0, 1] },
    { channel: '11', value: '61', measure: 1, position: [0, 1] },
  );
  expect(collectSampleTriggers(chart).map((trigger) => [trigger.channel, trigger.samplePath])).toEqual([
    ['01', 'keysound.wav'],
    ['11', 'keysound.wav'],
  ]);
});
