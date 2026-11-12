import type { BeMusicReplay } from '@be-music/player-engine/replay';
import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { loadPlaySamples } from '../../chart/play-audio.ts';
import { createChartSampleCache, type ChartSampleCache } from '../../runtime/chart-sample-cache.ts';
import { decodeGuideSounds, isSilentJudgeTimingPlay, prepareAudio, type PlayMediaContext } from './play-media.ts';

vi.mock('../../chart/play-audio.ts', () => ({ loadPlaySamples: vi.fn(async () => false) }));
vi.mock('../../runtime/web-audio-session.ts', () => ({ createWebAudioSession: vi.fn(() => ({})) }));

function replayWith(judgeTimingAutoAdjust: unknown): BeMusicReplay {
  return { play: { mode: 'manual', options: { judgeTimingAutoAdjust } } } as unknown as BeMusicReplay;
}

/** A media context whose audio graph comes from a fake audio service. */
function context(
  options: Partial<PlayMediaContext['options']>,
  chartSamples: ChartSampleCache = createChartSampleCache(),
): PlayMediaContext {
  const handle = { audioContext: {}, audioBus: { bgmMixer: {} }, analyzer: undefined };
  return {
    options: { audio: { openPlayGraph: () => handle, chartSamples } as never, ...options },
    chart: { chart: {}, chartPath: 'a/chart.bms' } as never,
    source: {} as never,
    resolvedChart: {} as never,
    disposed: false,
    tempo: 1,
    audioVolumes: { key: 1, bgm: 1 },
    audioCompressorParams: {},
    decodedSamples: new Map(),
    wavCmdVolumeMultipliers: new Map(),
  } as unknown as PlayMediaContext;
}

beforeEach(() => {
  vi.mocked(loadPlaySamples).mockClear();
});

test('a play is silent under LR2 SILENT: the selected mode live, the recorded one in a replay', () => {
  expect(isSilentJudgeTimingPlay({ judgeTimingAutoAdjust: 'LR2-SILENT' })).toBe(true);
  for (const mode of ['OFF', 'BEATORAJA', 'LR2-ON', undefined] as const)
    expect(isSilentJudgeTimingPlay({ judgeTimingAutoAdjust: mode })).toBe(false);
  expect(isSilentJudgeTimingPlay({ judgeTimingAutoAdjust: 'OFF', replay: replayWith('LR2-SILENT') })).toBe(true);
  expect(isSilentJudgeTimingPlay({ judgeTimingAutoAdjust: 'LR2-SILENT', replay: replayWith('LR2-ON') })).toBe(false);
  // A replay recorded before the modes holds a boolean.
  expect(isSilentJudgeTimingPlay({ judgeTimingAutoAdjust: 'LR2-SILENT', replay: replayWith(true) })).toBe(false);
});

test('LR2 SILENT loads none of the chart’s samples, and still builds the audio session', async () => {
  const silent = context({ judgeTimingAutoAdjust: 'LR2-SILENT' });
  await prepareAudio(silent);
  expect(loadPlaySamples).not.toHaveBeenCalled();
  expect(silent.webAudioSession).toBeDefined();
  await prepareAudio(context({ judgeTimingAutoAdjust: 'LR2-ON' }));
  expect(loadPlaySamples).toHaveBeenCalledTimes(1);
});

test('a play decodes through the audio service’s chart sample cache', async () => {
  const chartSamples = createChartSampleCache();
  await prepareAudio(context({}, chartSamples));
  expect(vi.mocked(loadPlaySamples).mock.calls[0]![0].sampleCache).toBe(chartSamples);
});

test('LR2 SILENT releases the samples kept for another chart', async () => {
  const chartSamples = createChartSampleCache();
  chartSamples
    .claim({ source: {}, chartPath: 'b/chart.bms', pathPrefix: undefined, sampleRate: 48_000 })
    .set('kick.wav', { buffer: {} as AudioBuffer });
  await prepareAudio(context({ judgeTimingAutoAdjust: 'LR2-SILENT' }, chartSamples));
  expect(chartSamples.size).toBe(0);
});

test('keep-pitch decodes at the effective chart and player rate', async () => {
  const media = { ...context({ tempoPitchMode: 'keep-pitch' }), tempo: 1.25, playbackTempo: 2.5 };
  await prepareAudio(media);
  expect(vi.mocked(loadPlaySamples).mock.calls[0]?.[0]).toMatchObject({
    tempo: 2.5,
    tempoPitchMode: 'keep-pitch',
  });
});

test('the guide sounds are decoded through the audio service: the ones the set has and that decode', async () => {
  const buffer = (id: number) => ({ id }) as unknown as AudioBuffer;
  const decodeSound = vi.fn(async (sound: { path?: string }) =>
    sound.path === 'guide-pg.wav' ? buffer(1) : sound.path === 'guide-ms.wav' ? buffer(6) : undefined,
  );
  const decoded = await decodeGuideSounds(
    { decodeSound },
    { PG: { path: 'guide-pg.wav' }, GR: { path: 'missing.wav' }, MS: { path: 'guide-ms.wav' } },
  );
  expect([...decoded.keys()].sort()).toEqual(['MS', 'PG']);
  expect(decoded.get('PG')).toEqual(buffer(1));
  // A sound that fails to decode is left out, and no service or no sounds give none.
  const failing = { decodeSound: vi.fn(async () => Promise.reject(new Error('decode'))) };
  expect((await decodeGuideSounds(failing, { PG: { path: 'guide-pg.wav' } })).size).toBe(0);
  expect((await decodeGuideSounds(undefined, { PG: { path: 'guide-pg.wav' } })).size).toBe(0);
  expect((await decodeGuideSounds({ decodeSound }, undefined)).size).toBe(0);
});
