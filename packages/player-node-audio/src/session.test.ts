import { expect, test, vi } from 'vite-plus/test';
import { resolveChart } from '@be-music/chart-model';
import { createEmptyJSON } from '@be-music/chart-source';
import { createNodeAudioSession, loadNodeAudioSampleDurations } from './index.ts';
import { renderSingleSample } from '@be-music/chart-audio-renderer';
import { createNodeAudioSink } from './audio-sink.ts';

vi.mock('@be-music/chart-audio-renderer', () => ({
  renderSingleSample: vi.fn(async () => ({
    sampleRate: 44_100,
    left: new Float32Array(0),
    right: new Float32Array(0),
    durationSeconds: 2,
    peak: 0,
  })),
}));
vi.mock('./audio-sink.ts', () => ({ createNodeAudioSink: vi.fn(async () => undefined) }));

test('duration loading decodes each referenced sample once with its chart radix', async () => {
  vi.mocked(renderSingleSample).mockClear();
  const json = createEmptyJSON('bms');
  json.resources.wav = { '01': 'sample.wav' };
  json.events = [0, 1].map((measure) => ({ measure, channel: '01', position: [0, 1] as const, value: '01' }));
  const durations = await loadNodeAudioSampleDurations(resolveChart(json), { baseDir: '/charts' });
  expect(durations.get('01')).toBe(2);
  expect(renderSingleSample).toHaveBeenCalledTimes(1);
  expect(renderSingleSample).toHaveBeenCalledWith(
    '01',
    'sample.wav',
    expect.objectContaining({ baseDir: '/charts', base: 36 }),
  );
});

test('disabled audio does not open Node output', async () => {
  vi.mocked(createNodeAudioSink).mockClear();
  const json = createEmptyJSON('bms');
  await expect(
    createNodeAudioSession({ json, resolvedChart: resolveChart(json), options: { audio: false }, mode: 'auto' }),
  ).resolves.toBeUndefined();
  expect(createNodeAudioSink).not.toHaveBeenCalled();
});

test('unavailable Node output returns no session', async () => {
  const json = createEmptyJSON('bms');
  await expect(
    createNodeAudioSession({
      json,
      resolvedChart: resolveChart(json),
      options: { writeOutput: () => undefined },
      mode: 'manual',
    }),
  ).resolves.toBeUndefined();
  expect(createNodeAudioSink).toHaveBeenCalled();
});

test('duration loading propagates cancellation before decoding', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    loadNodeAudioSampleDurations(resolveChart(createEmptyJSON('bms')), { signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
});
