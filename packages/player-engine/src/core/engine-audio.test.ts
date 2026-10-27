import { expect, test, vi } from 'vite-plus/test';
import { resolveChart } from '@be-music/chart-model';
import { createEmptyJSON } from '@be-music/chart-source';
import { createAudioSessionIfEnabled, createDebugActiveAudioEstimator } from './engine-audio.ts';
import type { AudioSession } from './engine-types.ts';

const resolved = resolveChart(createEmptyJSON('bms'));

test('playback without an audio adapter stays silent', async () => {
  await expect(createAudioSessionIfEnabled(resolved, {}, 'auto')).resolves.toBeUndefined();
});

test('disabled audio never opens the host adapter', async () => {
  const createAudioSession = vi.fn();
  await expect(
    createAudioSessionIfEnabled(resolved, { audio: false, createAudioSession }, 'auto'),
  ).resolves.toBeUndefined();
  expect(createAudioSession).not.toHaveBeenCalled();
});

test('the host receives the same resolved chart as the engine', async () => {
  const session: AudioSession = {
    start: vi.fn(),
    finish: vi.fn(),
    dispose: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    chartStartDelayMs: 0,
    backendLabel: 'test',
  };
  const createAudioSession = vi.fn(async () => session);
  const options = { createAudioSession, writeOutput: vi.fn() };
  const onLoadProgress = vi.fn();
  expect(await createAudioSessionIfEnabled(resolved, options, 'manual', onLoadProgress)).toBe(session);
  expect(createAudioSession).toHaveBeenCalledWith({
    json: resolved.source,
    resolvedChart: resolved,
    options,
    mode: 'manual',
    onLoadProgress,
  });
});

test('silent active-audio diagnostics use host durations and support seeking backwards', async () => {
  const json = createEmptyJSON('bms');
  json.resources.wav = { '01': 'sample.wav' };
  json.events = [{ measure: 0, channel: '01', position: [0, 1], value: '01' }];
  const chart = resolveChart(json);
  const loadSampleDurations = vi.fn(async () => new Map([['01', 2]]));
  const estimator = await createDebugActiveAudioEstimator(chart, { loadSampleDurations });
  expect(loadSampleDurations).toHaveBeenCalledWith(chart, expect.any(Object));
  expect(estimator.resolve(1).activeAudioFiles).toEqual(['sample.wav']);
  expect(estimator.resolve(3).activeAudioVoiceCount).toBe(0);
  expect(estimator.resolve(0.5).activeAudioVoiceCount).toBe(1);
  const fallback = await createDebugActiveAudioEstimator(chart);
  expect(fallback.resolve(1).activeAudioVoiceCount).toBe(0);
});
