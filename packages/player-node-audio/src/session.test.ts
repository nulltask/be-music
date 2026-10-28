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
  json.bms.pathWAV = 'audio/';
  json.events = [0, 1].map((measure) => ({ measure, channel: '01', position: [0, 1] as const, value: '01' }));
  const durations = await loadNodeAudioSampleDurations(resolveChart(json), { baseDir: '/charts' });
  expect(durations.get('01')).toBe(2);
  expect(renderSingleSample).toHaveBeenCalledTimes(1);
  expect(renderSingleSample).toHaveBeenCalledWith(
    '01',
    'sample.wav',
    expect.objectContaining({ baseDir: '/charts', base: 36, pathPrefix: 'audio/' }),
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

test('bmson continuations play independently while simultaneous uses of one slice share a voice', async () => {
  vi.mocked(renderSingleSample).mockClear();
  const json = createEmptyJSON('bmson');
  json.bms.pathWAV = 'audio/';
  json.metadata.bpm = 120;
  json.resources.wav = { '01': 'stem.wav' };
  json.events = [
    { measure: 0, channel: '11', position: [0, 1], value: '01', bmson: { c: false } },
    { measure: 0, channel: '12', position: [1, 4], value: '01', bmson: { c: true } },
    { measure: 0, channel: '13', position: [1, 4], value: '01', bmson: { c: true } },
  ];
  vi.mocked(renderSingleSample).mockResolvedValueOnce({
    sampleRate: 44_100,
    left: new Float32Array(88_200),
    right: new Float32Array(88_200),
    durationSeconds: 2,
    peak: 0,
  });
  let seconds = 0;
  vi.mocked(createNodeAudioSink).mockResolvedValueOnce({
    runtime: 'node',
    engine: 'webaudio',
    label: 'test',
    write: () => true,
    waitWritable: async () => undefined,
    end: async () => undefined,
    destroy: () => undefined,
    onError: () => undefined,
    getClockState: () => ({ outputSeconds: seconds, scheduledSeconds: seconds }),
    suspend: async () => undefined,
    resume: async () => undefined,
  });
  const session = await createNodeAudioSession({
    json,
    resolvedChart: resolveChart(json),
    options: {},
    mode: 'manual',
  });
  expect(session).toBeDefined();
  expect(renderSingleSample).toHaveBeenCalledWith('01', 'stem.wav', expect.objectContaining({ pathPrefix: 'audio/' }));
  session!.triggerEvent?.(json.events[0]!);
  session!.triggerEvent?.(json.events[1]!);
  session!.triggerEvent?.(json.events[2]!);
  expect(session!.getActiveAudioVoiceCount?.()).toBe(2);
  seconds = 0.05;
  session!.triggerEvent?.(json.events[2]!);
  expect(session!.getActiveAudioVoiceCount?.()).toBe(2);
  session!.stopChannel?.('13');
  expect(session!.getActiveAudioVoiceCount?.()).toBe(1);
  session!.stopChannel?.('11');
  expect(session!.getActiveAudioVoiceCount?.()).toBe(0);
  await session!.dispose();
});
