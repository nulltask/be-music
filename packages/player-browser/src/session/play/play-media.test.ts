import type { BeMusicReplay } from '@be-music/player-engine/replay';
import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { loadPlaySamples } from '../../chart/play-audio.ts';
import { isSilentJudgeTimingPlay, prepareAudio, type PlayMediaContext } from './play-media.ts';

vi.mock('../../chart/play-audio.ts', () => ({ loadPlaySamples: vi.fn(async () => false) }));
vi.mock('../../runtime/web-audio-session.ts', () => ({ createWebAudioSession: vi.fn(() => ({})) }));

function replayWith(judgeTimingAutoAdjust: unknown): BeMusicReplay {
  return { play: { mode: 'manual', options: { judgeTimingAutoAdjust } } } as unknown as BeMusicReplay;
}

/** A media context whose audio graph comes from a fake audio service. */
function context(options: Partial<PlayMediaContext['options']>): PlayMediaContext {
  const handle = { audioContext: {}, audioBus: { bgmMixer: {} }, analyzer: undefined };
  return {
    options: { audio: { openPlayGraph: () => handle } as never, ...options },
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
