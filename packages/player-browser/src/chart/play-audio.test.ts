import { createEmptyJSON, type BeMusicJSON } from '@be-music/chart-source';
import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import type { BrowserAssetSource } from '../collection/types.ts';
import {
  collectChartVolumeMultipliers,
  estimateMaxAudioSeconds,
  loadPlaySamples,
  resolveAudioDecodeConcurrency,
  resolvePlayWindowSamples,
} from './play-audio.ts';
import { createChartSampleCache } from '../runtime/chart-sample-cache.ts';
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
  return playEverySlot(chart);
}

/** BGM events naming every `#WAV` and `#EXWAV` slot, so each is a sample the play decodes. */
function playEverySlot(chart: BeMusicJSON): BeMusicJSON {
  const slots = new Set([...Object.keys(chart.resources.wav), ...Object.keys(chart.bms.exWAV)]);
  chart.events = [...slots].map((value) => ({ measure: 0, channel: '01', position: [0, 1], value }));
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
    playEverySlot(chart);
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
    playEverySlot(chart);
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

  test('decodes only the samples some event plays, once per path', async () => {
    const chart = createEmptyJSON('bms');
    chart.resources.wav = { '01': 'kick.wav', '02': 'declared-only.wav', '03': 'kick.wav', '04': 'mine.wav' };
    chart.events = [
      { measure: 0, channel: '01', position: [0, 1], value: '01' },
      { measure: 0, channel: '11', position: [0, 1], value: '03' },
      { measure: 0, channel: 'D1', position: [0, 1], value: '04' },
    ];
    const context = fakeAudioContext();
    const samples = new Map<string, AudioBuffer>();
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
    expect(context.decoded).toEqual(['kick.wav']);
    expect([...samples.keys()]).toEqual(['kick.wav']);
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

  describe('with a chart sample cache', () => {
    function load(
      overrides: Partial<Parameters<typeof loadPlaySamples>[0]> & { audioContext: BaseAudioContext },
    ): Promise<boolean> {
      return loadPlaySamples({
        chart: chartWithWAVs({ '01': 'kick.wav', '02': 'snare.wav' }),
        source: SOURCE,
        chartPath: 'Songs/a/main.bms',
        samples: new Map(),
        tempo: 1,
        tempoPitchMode: 'pitch',
        tempoStretchAlgorithm: 'signalsmith',
        ...overrides,
      });
    }

    test('a retry of the same chart decodes nothing again and gets the same buffers', async () => {
      const sampleCache = createChartSampleCache();
      const first = fakeAudioContext();
      const firstSamples = new Map<string, AudioBuffer>();
      await load({ audioContext: first, samples: firstSamples, sampleCache });
      expect(first.decoded.sort()).toEqual(['kick.wav', 'snare.wav']);
      const retry = fakeAudioContext();
      const retrySamples = new Map<string, AudioBuffer>();
      await load({ audioContext: retry, samples: retrySamples, sampleCache });
      expect(retry.decoded).toEqual([]);
      expect(mocks.loadAssetBytes).toHaveBeenCalledTimes(2);
      expect(retrySamples.get('kick.wav')).toBe(firstSamples.get('kick.wav'));
    });

    test('another chart of the track decodes only the files it does not share', async () => {
      const sampleCache = createChartSampleCache();
      const first = new Map<string, AudioBuffer>();
      await load({ audioContext: fakeAudioContext(), samples: first, sampleCache });
      const hyper = fakeAudioContext();
      const hyperSamples = new Map<string, AudioBuffer>();
      await load({
        audioContext: hyper,
        chart: chartWithWAVs({ '01': 'kick.wav', '02': 'hat.wav' }),
        chartPath: 'Songs/a/hyper.bms',
        samples: hyperSamples,
        sampleCache,
      });
      expect(hyper.decoded).toEqual(['hat.wav']);
      expect(hyperSamples.get('kick.wav')).toBe(first.get('kick.wav'));
      expect(sampleCache.key?.chartPath).toBe('Songs/a/hyper.bms');
      // The snare only the first chart played went before the hyper decoded.
      expect(sampleCache.size).toBe(2);
    });

    test('a same-named path that resolves to another file decodes again', async () => {
      // Each chart's paths resolve beside it, as `resolveChartAudioAsset` does.
      mocks.resolveChartAudioAsset.mockImplementation(
        (_source, chartPath: string, path: string) => `${chartPath.slice(0, chartPath.lastIndexOf('/'))}/${path}`,
      );
      const sampleCache = createChartSampleCache();
      await load({ audioContext: fakeAudioContext(), sampleCache });
      const other = fakeAudioContext();
      await load({ audioContext: other, chartPath: 'Songs/b/main.bms', sampleCache });
      expect(other.decoded.sort()).toEqual(['Songs/b/kick.wav', 'Songs/b/snare.wav']);
      expect(sampleCache.size).toBe(2);
    });

    test('another source decodes everything again', async () => {
      const sampleCache = createChartSampleCache();
      await load({ audioContext: fakeAudioContext(), sampleCache });
      const other = fakeAudioContext();
      await load({ audioContext: other, source: {} as BrowserAssetSource, sampleCache });
      expect(other.decoded.sort()).toEqual(['kick.wav', 'snare.wav']);
    });

    test('decodes again at another context sample rate', async () => {
      const sampleCache = createChartSampleCache();
      await load({ audioContext: Object.assign(fakeAudioContext(), { sampleRate: 48_000 }), sampleCache });
      const resampled = Object.assign(fakeAudioContext(), { sampleRate: 44_100 });
      await load({ audioContext: resampled, sampleCache });
      expect(resampled.decoded.sort()).toEqual(['kick.wav', 'snare.wav']);
    });

    test('keeps only the samples the latest play used', async () => {
      const sampleCache = createChartSampleCache();
      await load({ audioContext: fakeAudioContext(), sampleCache });
      const chart = chartWithWAVs({ '01': 'kick.wav', '02': 'snare.wav' });
      chart.events = chart.events.filter((event) => event.value === '01');
      const retry = fakeAudioContext();
      await load({ audioContext: retry, chart, sampleCache });
      expect(retry.decoded).toEqual([]);
      expect(sampleCache.size).toBe(1);
    });

    test('peak gain scales copies and leaves the cached decodes as they were', async () => {
      const raw = Float32Array.from([0.5, -0.25]);
      const audioContext = {
        sampleRate: 48_000,
        decodeAudioData: async () =>
          ({ sampleRate: 48_000, numberOfChannels: 1, length: 2, getChannelData: () => raw }) as unknown as AudioBuffer,
        createBuffer: (channels: number, length: number, sampleRate: number) => {
          const data = Array.from({ length: channels }, () => new Float32Array(length));
          return {
            sampleRate,
            numberOfChannels: channels,
            length,
            getChannelData: (channel: number) => data[channel]!,
            copyToChannel: (source: Float32Array, channel: number) => data[channel]!.set(source),
          } as unknown as AudioBuffer;
        },
      } as unknown as BaseAudioContext;
      const sampleCache = createChartSampleCache();
      const samples = new Map<string, AudioBuffer>();
      const chart = chartWithWAVs({ '01': 'kick.wav' });
      await load({ audioContext, chart, samples, sampleCache, peakGain: true });
      expect(raw[0]).toBe(0.5);
      expect(samples.get('kick.wav')!.getChannelData(0)[0]).toBeCloseTo(PEAK_GAIN_TARGET_LINEAR);
      const retrySamples = new Map<string, AudioBuffer>();
      await load({ audioContext, chart, samples: retrySamples, sampleCache, peakGain: true });
      expect(raw[0]).toBe(0.5);
      expect(retrySamples.get('kick.wav')!.getChannelData(0)[0]).toBeCloseTo(PEAK_GAIN_TARGET_LINEAR);
    });
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

describe('a play of part of the chart', () => {
  const wave = (seconds: number): Uint8Array => {
    // A 1 kHz mono 8-bit PCM WAVE: its data is as many bytes as milliseconds, its header 44.
    const data = Math.round(seconds * 1000);
    const bytes = new Uint8Array(44 + data);
    const view = new DataView(bytes.buffer);
    const text = (offset: number, value: string) => [...value].forEach((c, i) => (bytes[offset + i] = c.charCodeAt(0)));
    text(0, 'RIFF');
    view.setUint32(4, 36 + data, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 1000, true);
    view.setUint32(28, 1000, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    text(36, 'data');
    view.setUint32(40, data, true);
    return bytes;
  };

  test('estimateMaxAudioSeconds reads a WAVE’s length, and bounds any other file’s by a low bitrate', () => {
    expect(estimateMaxAudioSeconds(wave(2.5))).toBeCloseTo(2.5);
    // 40 kB of anything else: 10 s at 32 kbps, longer than it can play.
    expect(estimateMaxAudioSeconds(new Uint8Array(40_000))).toBe(10);
  });

  test('resolvePlayWindowSamples keeps what the window triggers, and when each other sample was last triggered before it', () => {
    const triggers = [
      { seconds: 0, sampleKey: 'AA' },
      { seconds: 3, sampleKey: 'BB' },
      { seconds: 5, sampleKey: 'CC' },
      { seconds: 6, sampleKey: 'BB' },
      { seconds: 7, sampleKey: 'DD' },
      { seconds: 12, sampleKey: 'EE' },
    ];
    const { inWindow, before } = resolvePlayWindowSamples({ startSeconds: 4, endSeconds: 10, triggers });
    expect([...inWindow].sort()).toEqual(['BB', 'CC', 'DD']);
    expect([...before]).toEqual([['AA', 0]]);
  });

  test('decodes the samples the window sounds, and those before it that ring into it', async () => {
    const chart = createEmptyJSON('bms');
    chart.resources.wav = { '01': 'song.wav', '02': 'hit.wav', '03': 'in.wav', '04': 'after.wav' };
    chart.events = [];
    const files: Record<string, Uint8Array> = {
      'song.wav': wave(60),
      'hit.wav': wave(0.5),
      'in.wav': wave(0.5),
      'after.wav': wave(0.5),
    };
    mocks.resolveChartAudioAsset.mockReset();
    mocks.loadAssetBytes.mockReset();
    mocks.resolveChartAudioAsset.mockImplementation((_source, _chartPath, path: string) => path);
    mocks.loadAssetBytes.mockImplementation(async (path: string) => files[path]);
    // Every slot is played, each at its own time: the song from 0, a short hit at 1, one in the window, one after it.
    chart.events = ['01', '02', '03', '04'].map((value) => ({ measure: 0, channel: '01', position: [0, 1], value }));
    const decoded: string[] = [];
    const context = {
      decodeAudioData: async (buffer: ArrayBuffer) => {
        const bytes = new Uint8Array(buffer);
        const name = Object.entries(files).find(
          ([, file]) => file.length === bytes.length && file !== files['hit.wav'],
        )?.[0];
        decoded.push(name ?? 'short');
        return { duration: 1, sampleRate: 44100 } as unknown as AudioBuffer;
      },
    } as unknown as BaseAudioContext;
    await loadPlaySamples({
      audioContext: context,
      chart,
      source: SOURCE,
      chartPath: 'main.bms',
      samples: new Map(),
      tempo: 1,
      tempoPitchMode: 'pitch',
      tempoStretchAlgorithm: 'signalsmith',
      window: {
        startSeconds: 4,
        endSeconds: 8,
        triggers: [
          { seconds: 0, sampleKey: '01' },
          { seconds: 1, sampleKey: '02' },
          { seconds: 5, sampleKey: '03' },
          { seconds: 9, sampleKey: '04' },
        ],
      },
    });
    // The song still rings at 4 s and the sample in the window plays; the hit ended at 1.5 s and the last comes after.
    expect(decoded.length).toBe(2);
    expect(decoded).toContain('song.wav');
    expect(mocks.loadAssetBytes).not.toHaveBeenCalledWith('after.wav');
  });
});

describe('resolveAudioDecodeConcurrency', () => {
  test('decodes one sample per core, between 4 and 16', () => {
    expect(resolveAudioDecodeConcurrency(10)).toBe(10);
    expect(resolveAudioDecodeConcurrency(2)).toBe(4);
    expect(resolveAudioDecodeConcurrency(64)).toBe(16);
    expect(resolveAudioDecodeConcurrency(undefined)).toBe(8);
    expect(resolveAudioDecodeConcurrency(Number.NaN)).toBe(8);
  });
});
