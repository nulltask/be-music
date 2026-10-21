import { expect, test } from 'vite-plus/test';
import { zipSync, strToU8 } from 'fflate';
import { parseBMS } from '@be-music/chart-parser';
import { restorePackedCollectionChart } from '../collection/compact-chart.ts';
import { timeStretchChannels } from '../runtime/time-stretch.ts';
import { parseChartTask, unzipTask, stretchTask, executeBrowserTask } from './tasks.ts';
const TEXT = '#TITLE Worker\n#BPM 120\n#WAV01 kick.wav\n#00111:0101\n#00231:01';
test('parse/count/pack survives a structured-clone boundary and restores lazy events', () => {
  const result = structuredClone(parseChartTask({ path: 'test.bms', bytes: strToU8(TEXT) }));
  expect(result.scored.notes).toBe(2);
  expect(result.chart.events).toEqual([]);
  expect(result.packed!.length).toBe(3);
  restorePackedCollectionChart(result.chart, result.packed, result.strings);
  expect(result.chart.events).toEqual(parseBMS(TEXT).events);
  expect(result.chart.metadata.title).toBe('Worker');
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
