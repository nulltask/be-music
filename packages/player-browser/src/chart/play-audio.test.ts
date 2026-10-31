import { createEmptyJSON, type BeMusicJSON } from '@be-music/chart-source';
import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import type { BrowserAssetSource } from '../collection/types.ts';
import { collectChartVolumeMultipliers, loadPlaySamples } from './play-audio.ts';
import { PEAK_GAIN_TARGET_LINEAR } from './peak-gain.ts';

const mocks = vi.hoisted(() => ({
  loadAssetBytes: vi.fn(),
  resolveChartAudioAsset: vi.fn(),
  stretchDecodedSamples: vi.fn(),
  readNativeAudioSampleRate: vi.fn(),
}));

vi.mock('../collection/collection.ts', () => ({
  loadAssetBytes: mocks.loadAssetBytes,
  resolveChartAudioAsset: mocks.resolveChartAudioAsset,
}));

vi.mock('../runtime/wav-playback.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime/wav-playback.ts')>();
  mocks.readNativeAudioSampleRate.mockImplementation(actual.readNativeAudioSampleRate);
  return { ...actual, readNativeAudioSampleRate: mocks.readNativeAudioSampleRate };
});

vi.mock('../runtime/play-tempo.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../runtime/play-tempo.ts')>()),
  stretchDecodedSamples: mocks.stretchDecodedSamples,
}));

function chartWithWAVs(wav: Record<string, string>): BeMusicJSON {
  const chart = createEmptyJSON('bms');
  chart.resources.wav = wav;
  return chart;
}

function fakeAudioContext(): BaseAudioContext & { decoded: string[] } {
  const decoded: string[] = [];
  return {
    decoded,
    decodeAudioData: async (buffer: ArrayBuffer) => {
      const text = new TextDecoder().decode(buffer);
      if (text === 'broken') throw new Error('unsupported codec');
      decoded.push(text);
      return { duration: 1, sampleRate: 44100, label: text } as unknown as AudioBuffer;
    },
  } as unknown as BaseAudioContext & { decoded: string[] };
}

const SOURCE = {} as BrowserAssetSource;

describe('collectChartVolumeMultipliers', () => {
  test('preserves a composed stage gain below an integer percentage without rounding', () => {
    const chart = createEmptyJSON('bms');
    chart.bms.wavCmds = ['01 01 33'];
    chart.resources.wavGain = { '01': 0.77 };
    expect(collectChartVolumeMultipliers(chart).get('01')).toBe(0.33 * 0.77);
  });
  test('reads volume after pan in a whitespace-separated EXWAV declaration', () => {
    const chart = createEmptyJSON('bms');
    chart.bms.exWAV = { '01': 'pvf 500 -600 48000 sample.wav' };
    expect(collectChartVolumeMultipliers(chart).get('01')).toBeCloseTo(10 ** (-6 / 20));
  });

  test('multiplies #WAVCMD and #EXWAV volumes of the same slot', () => {
    const chart = createEmptyJSON('bms');
    chart.bms.wavCmds = ['01 01 100', '01 02 0'];
    chart.bms.exWAV = { '01': 'v -2000 quiet.wav', '03': 'v 0 unity.wav' };
    const multipliers = collectChartVolumeMultipliers(chart);
    expect(multipliers.get('01')).toBeCloseTo(0.1, 3);
    expect(multipliers.get('02')).toBe(0);
    expect(multipliers.get('03')).toBeCloseTo(1, 6);
    expect(multipliers.has('04')).toBe(false);
  });
});

describe('loadPlaySamples', () => {
  beforeEach(() => {
    mocks.loadAssetBytes.mockReset();
    mocks.resolveChartAudioAsset.mockReset();
    mocks.stretchDecodedSamples.mockReset();
    mocks.resolveChartAudioAsset.mockImplementation((_source, _chartPath, path: string) => path);
    mocks.loadAssetBytes.mockImplementation(async (path: string) =>
      path === 'missing.wav' ? undefined : new TextEncoder().encode(path.includes('broken') ? 'broken' : path),
    );
  });

  test('loads EXWAV-only resources and prefers EXWAV over WAV for a shared slot', async () => {
    const chart = chartWithWAVs({ '01': 'ordinary.wav' });
    chart.bms.exWAV = { '01': 'v -600 extended.wav', '02': 'p 0 only.wav' };
    const samples = new Map<string, AudioBuffer>();
    const context = fakeAudioContext();
    await loadPlaySamples({
      audioContext: context,
      chart,
      source: SOURCE,
      chartPath: 'main.bms',
      samples,
      tempo: 1,
      tempoPitchMode: 'pitch',
      tempoStretchAlgorithm: 'signalsmith',
    });
    expect(context.decoded.sort()).toEqual(['extended.wav', 'only.wav']);
    expect([...samples.keys()].sort()).toEqual(['extended.wav', 'only.wav', 'only.wav\0slot:02']);
  });

  test('keeps a decoded EXWAV sample whose native rate cannot be read', async () => {
    const chart = chartWithWAVs({});
    chart.bms.exWAV = { '01': 'f 44100 pitched.wav' };
    mocks.readNativeAudioSampleRate.mockRejectedValueOnce(new Error('unknown container'));
    const samples = new Map<string, AudioBuffer>();
    const context = fakeAudioContext();
    await loadPlaySamples({
      audioContext: context,
      chart,
      source: SOURCE,
      chartPath: 'main.bms',
      samples,
      tempo: 1,
      tempoPitchMode: 'pitch',
      tempoStretchAlgorithm: 'signalsmith',
    });
    expect(context.decoded).toEqual(['pitched.wav']);
    expect(mocks.readNativeAudioSampleRate).toHaveBeenCalledOnce();
    expect(samples.has('pitched.wav')).toBe(true);
  });

  test('keys every decoded sample as the audio session looks it up and skips undecodable ones', async () => {
    const samples = new Map<string, AudioBuffer>();
    const stretched = await loadPlaySamples({
      audioContext: fakeAudioContext(),
      chart: chartWithWAVs({ '01': 'Sub\\Kick.WAV', '02': 'missing.wav', '03': 'broken.ogg' }),
      source: SOURCE,
      chartPath: 'Songs/a/main.bms',
      samples,
      tempo: 1,
      tempoPitchMode: 'pitch',
      tempoStretchAlgorithm: 'signalsmith',
    });
    expect(stretched).toBe(false);
    expect([...samples.keys()]).toEqual(['sub/kick.wav']);
    expect(mocks.stretchDecodedSamples).not.toHaveBeenCalled();
  });

  test('resolves each sample under #PATH_WAV', async () => {
    const chart = chartWithWAVs({ '01': 'kick.wav' });
    chart.bms.pathWAV = 'wav/';
    await loadPlaySamples({
      audioContext: fakeAudioContext(),
      chart,
      source: SOURCE,
      chartPath: 'Songs/a/main.bms',
      samples: new Map(),
      tempo: 1,
      tempoPitchMode: 'pitch',
      tempoStretchAlgorithm: 'signalsmith',
    });
    expect(mocks.resolveChartAudioAsset).toHaveBeenCalledWith(SOURCE, 'Songs/a/main.bms', 'kick.wav', {
      pathPrefix: 'wav/',
    });
  });

  test('stretches the samples only for keep pitch at another tempo', async () => {
    const options = {
      audioContext: fakeAudioContext(),
      chart: chartWithWAVs({ '01': 'kick.wav' }),
      source: SOURCE,
      chartPath: 'Songs/a/main.bms',
      samples: new Map<string, AudioBuffer>(),
      tempoStretchAlgorithm: 'wsola' as const,
    };
    expect(await loadPlaySamples({ ...options, tempo: 1.5, tempoPitchMode: 'pitch' })).toBe(false);
    expect(await loadPlaySamples({ ...options, tempo: 1, tempoPitchMode: 'keep-pitch' })).toBe(false);
    expect(mocks.stretchDecodedSamples).not.toHaveBeenCalled();
    expect(await loadPlaySamples({ ...options, tempo: 1.5, tempoPitchMode: 'keep-pitch' })).toBe(true);
    expect(mocks.stretchDecodedSamples).toHaveBeenCalledWith(
      options.audioContext,
      options.samples,
      new Map([['kick.wav', 1.5]]),
      'wsola',
      expect.any(Function),
    );
  });

  test('scales audible buffers once even when an identity effect aliases the raw buffer', async () => {
    const channels = new Map<string, Float32Array>([
      ['kick.wav', Float32Array.from([0.5, -0.25])],
      ['snare.wav', Float32Array.from([0.1])],
    ]);
    const audioContext = {
      decodeAudioData: async (buffer: ArrayBuffer) => {
        const data = channels.get(new TextDecoder().decode(buffer))!;
        return { sampleRate: 44100, numberOfChannels: 1, getChannelData: () => data } as unknown as AudioBuffer;
      },
    } as unknown as BaseAudioContext;
    const chart = chartWithWAVs({ '01': 'kick.wav', '02': 'snare.wav' });
    chart.bms.wavCmds = ['00 01 60'];
    await loadPlaySamples({
      audioContext,
      chart,
      source: SOURCE,
      chartPath: 'Songs/a/main.bms',
      samples: new Map(),
      tempo: 1,
      tempoPitchMode: 'pitch',
      tempoStretchAlgorithm: 'signalsmith',
      peakGain: true,
    });
    const gain = PEAK_GAIN_TARGET_LINEAR / 0.5;
    expect(channels.get('kick.wav')![0]).toBeCloseTo(PEAK_GAIN_TARGET_LINEAR);
    expect(channels.get('snare.wav')![0]).toBeCloseTo(0.1 * gain);
  });

  test('stops decoding once the play is cancelled', async () => {
    const audioContext = fakeAudioContext();
    const samples = new Map<string, AudioBuffer>();
    await loadPlaySamples({
      audioContext,
      chart: chartWithWAVs({ '01': 'kick.wav', '02': 'snare.wav' }),
      source: SOURCE,
      chartPath: 'Songs/a/main.bms',
      samples,
      tempo: 1.5,
      tempoPitchMode: 'keep-pitch',
      tempoStretchAlgorithm: 'signalsmith',
      isCancelled: () => true,
    });
    expect(audioContext.decoded).toEqual([]);
    expect(samples.size).toBe(0);
    expect(mocks.stretchDecodedSamples).not.toHaveBeenCalled();
  });
});
