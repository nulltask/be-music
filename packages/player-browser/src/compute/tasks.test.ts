import { expect, test } from 'vite-plus/test';
import { zipSync, strToU8 } from 'fflate';
import { parseBMS } from '@be-music/chart-parser';
import { readdirSync, readFileSync } from 'node:fs';
import { decodeUTF8Text, parseBMSBytes, parseBmson } from '@be-music/chart-parser';
import { compactChartPreservation } from '../collection/chart-preservation.ts';
import { md5HexOfBytes } from '../collection/md5.ts';
import { restoreDeferredChartFields, restorePackedCollectionChart } from '../collection/compact-chart.ts';
import { timeStretchChannels } from '../runtime/time-stretch.ts';
import { parseChartTask, unzipTask, stretchTask, executeBrowserTask } from './tasks.ts';
const TEXT = '#TITLE Worker\n#BPM 120\n#WAV01 kick.wav\n#00111:0101\n#00231:01';
test('parse/count/pack survives a structured-clone boundary and restores lazy events', () => {
  const result = structuredClone(parseChartTask({ path: 'test.bms', bytes: strToU8(TEXT) }));
  expect(result.scored.notes).toBe(2);
  expect(result.chart.events).toEqual([]);
  expect(result.packed!.length).toBe(3);
  // What a chart list reads stays on the chart; the rest travels as JSON text until the collection puts it back.
  expect(Object.keys(result.chart)).toEqual(['format', 'sourceFormat', 'metadata', 'events']);
  expect(result.deferred!.keys).toEqual(['resources', 'measures', 'bms', 'bmson', 'preservation']);
  expect(typeof result.deferred!.json).toBe('string');
  expect(result.md5).toBe(md5HexOfBytes(strToU8(TEXT)));
  restorePackedCollectionChart(result.chart, result.packed, result.strings);
  restoreDeferredChartFields(result.chart, result.deferred);
  expect(result.chart.events).toEqual(parseBMS(TEXT).events);
  expect(result.chart.metadata.title).toBe('Worker');
  expect(result.chart.bms.wavNameBytePrefixes).toEqual({ 'kick.wav': '6b69' });
  expect(result.chart.preservation.bms.sourceLines).toEqual([{ kind: 'header', command: 'WAV01', value: 'kick.wav' }]);
});
test('an .n2s path is read as a Nanasi Groove 2 container', () => {
  expect(() => parseChartTask({ path: 'music/song/01_song_n.N2S', bytes: strToU8(TEXT) })).toThrow('missing ZEXA tag');
});
test('an .lrs path is read as LRX with the files beside it', () => {
  const lrs = strToU8('<LRS><n c="301" s="0" p="150" /><n c="1" s="0" p="0" /></LRS>');
  const lrh = strToU8('<LRH><information title="Side" lanetype="1" /></LRH>');
  const result = parseChartTask({ path: 'song/01.LRS', bytes: lrs, siblings: { lrh } });
  restorePackedCollectionChart(result.chart, result.packed, result.strings);
  restoreDeferredChartFields(result.chart, result.deferred);
  expect(result.chart.sourceFormat).toBe('lrx');
  expect(result.chart.metadata.title).toBe('Side');
  expect(result.scored).toEqual({ notes: 1, playVariant: '5' });
});
test('ZIP limits and skin filtering are applied inside the task', () => {
  const bytes = zipSync({ 'a.bms': strToU8(TEXT), '__MACOSX/junk': strToU8('junk') });
  const input = { bytes, limit: 4096, limitMessage: 'too big' };
  expect(Object.keys(unzipTask(input))).toEqual(['a.bms', '__MACOSX/junk']);
  expect(Object.keys(unzipTask({ ...input, skin: true }))).toEqual(['a.bms']);
  expect(() => unzipTask({ ...input, limit: 1 })).toThrow('too big');
  expect(() => unzipTask({ ...input, bytes: new Uint8Array([1, 2]) })).toThrow();
});
test('stereo WSOLA and task dispatch use the same algorithm', () => {
  const input = {
    channels: [Float32Array.from({ length: 512 }, (_, i) => Math.sin(i / 4)), new Float32Array(512)],
    sampleRate: 8000,
    rate: 0.75,
  };
  expect(structuredClone(stretchTask(input))).toEqual(
    timeStretchChannels(input.channels, input.sampleRate, input.rate),
  );
  expect(executeBrowserTask('stretch', input)).toEqual(stretchTask(input));
  expect(() => executeBrowserTask('arbitrary', {})).toThrow('Unknown browser task');
});

test.each([null, undefined, 'broken', '2.0.0'])(
  'browser chart loading propagates invalid bmson version %s',
  (version) => {
    const input = {
      path: 'chart.bmson',
      bytes: strToU8(JSON.stringify({ version, info: { init_bpm: 120 }, sound_channels: [] })),
    };
    expect(() => parseChartTask(input)).toThrow(/bmson.*version|legacy bmson/);
    expect(() => executeBrowserTask('parse-chart', input)).toThrow();
  },
);

test('browser chart loading accepts stable bmson with build metadata', () => {
  const result = parseChartTask({
    path: 'chart.bmson',
    bytes: strToU8(JSON.stringify({ version: '1.0.0+local', info: { init_bpm: 120 }, sound_channels: [] })),
  });
  restoreDeferredChartFields(result.chart, result.deferred);
  expect(result.chart.bmson.version).toBe('1.0.0+local');
});

const FIXTURES = new URL('../../../../test/fixtures/', import.meta.url);
const CHART_FIXTURES = readdirSync(FIXTURES).filter((name) => /\.(bms|bme|bml|pms|bmson)$/i.test(name));

test.each(CHART_FIXTURES)('a chart listed from the task result equals the chart parsed in place: %s', (name) => {
  const bytes = new Uint8Array(readFileSync(new URL(name, FIXTURES)));
  const expected = name.endsWith('.bmson') ? parseBmson(decodeUTF8Text(bytes)) : parseBMSBytes(bytes);
  compactChartPreservation(expected);
  // As the collection lists it: across a worker (or the parsed-chart cache), then its events and fields put back.
  const result = structuredClone(parseChartTask({ path: name, bytes }));
  restorePackedCollectionChart(result.chart, result.packed, result.strings);
  restoreDeferredChartFields(result.chart, result.deferred);
  expect(result.chart).toEqual(expected);
  expect(JSON.parse(JSON.stringify(result.chart))).toEqual(JSON.parse(JSON.stringify(expected)));
});
