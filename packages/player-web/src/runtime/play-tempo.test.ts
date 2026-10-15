import type { NonstopStitchMap } from '@be-music/player/course';
import type { BeMusicEvent } from '@be-music/json';
import { describe, expect, test } from 'vite-plus/test';
import {
  chartToElapsedSeconds,
  clampPlayTempo,
  elapsedToChartSeconds,
  resolveSamplePlaybackRate,
  resolveSampleStretchRates,
  stretchDecodedSamples,
  stretchSlicePlayback,
} from './play-tempo.ts';

const placement = (rate = 1) => ({
  measureOffset: 0,
  offsetSeconds: 0,
  rate,
  cut: 0,
  boundaryMeasure: 0,
  boundarySeconds: 0,
});

const MAP: NonstopStitchMap = {
  stages: [
    {
      placement: placement(),
      windowStart: 0,
      windowEnd: 20,
      wavKeys: ['01', '02'],
      bmpKeys: [],
      lr2StageMarker: false,
    },
    {
      placement: placement(1.25),
      windowStart: 20,
      windowEnd: Number.POSITIVE_INFINITY,
      wavKeys: ['03'],
      bmpKeys: [],
      lr2StageMarker: false,
    },
  ],
  tempo: [],
  stageRanks: [],
};

const WAV = { '01': 's0/A.wav', '02': 's0/b.wav', '03': 's1/Kick.WAV' };
const lower = (path: string) => path.toLowerCase();

describe('clampPlayTempo', () => {
  test('clamps to -50 %..+50 % on a 1 % grid and falls back to 1', () => {
    expect([0.2, 0.5, 0.804, 1, 1.5, 3].map(clampPlayTempo)).toEqual([0.5, 0.5, 0.8, 1, 1.5, 1.5]);
    expect([undefined, Number.NaN, 0, -1, Number.POSITIVE_INFINITY].map(clampPlayTempo)).toEqual([1, 1, 1, 1, 1]);
  });
});

describe('play clock and chart time', () => {
  test('a second of play clock covers `tempo` seconds of chart, and back', () => {
    expect(elapsedToChartSeconds(2, 0.75)).toBe(1.5);
    expect(chartToElapsedSeconds(1.5, 0.75)).toBe(2);
    expect(chartToElapsedSeconds(3, 1.5)).toBe(2);
  });
});

describe('resolveSamplePlaybackRate', () => {
  test('moves the pitch with the tempo and the FIT rate, or plays stretched samples at 1', () => {
    expect(resolveSamplePlaybackRate('pitch', 0.8)).toBe(0.8);
    expect(resolveSamplePlaybackRate('pitch', 0.8, 1.25)).toBe(1);
    expect(resolveSamplePlaybackRate('pitch', 1.2, 1.25)).toBe(1.5);
    expect(resolveSamplePlaybackRate('keep-pitch', 0.8, 1.25)).toBe(1);
  });
});

describe('resolveSampleStretchRates', () => {
  test('stretches every sample by the tempo', () => {
    expect([...resolveSampleStretchRates(WAV, lower, 0.5)]).toEqual([
      ['s0/a.wav', 0.5],
      ['s0/b.wav', 0.5],
      ['s1/kick.wav', 0.5],
    ]);
  });

  test('stretches only the samples of the stages a FIT connection retimes at tempo 1', () => {
    expect([...resolveSampleStretchRates(WAV, lower, 1, MAP)]).toEqual([['s1/kick.wav', 1.25]]);
  });

  test('multiplies the tempo with a FIT stage rate, leaving out what plays at 1', () => {
    expect([...resolveSampleStretchRates(WAV, lower, 0.8, MAP)]).toEqual([
      ['s0/a.wav', 0.8],
      ['s0/b.wav', 0.8],
    ]);
  });
});

describe('stretchSlicePlayback', () => {
  test('shrinks each slice by the rate, copying the map at rate 1', () => {
    const event = {} as BeMusicEvent;
    const other = {} as BeMusicEvent;
    const slices = new Map([
      [event, { offsetSeconds: 2, durationSeconds: 1, sliceId: 'a' }],
      [other, { offsetSeconds: 1, sliceId: 'b' }],
    ]);
    expect(stretchSlicePlayback(slices, 1)).toEqual(slices);
    expect(stretchSlicePlayback(slices, 1)).not.toBe(slices);
    const stretched = stretchSlicePlayback(slices, 0.5);
    expect(stretched.get(event)).toEqual({ offsetSeconds: 4, durationSeconds: 2, sliceId: 'a' });
    expect(stretched.get(other)).toEqual({ offsetSeconds: 2, sliceId: 'b' });
  });
});

describe('stretchDecodedSamples', () => {
  function fakeBuffer(length: number, sampleRate = 8000): AudioBuffer {
    const channel = new Float32Array(length).map((_, index) => Math.sin(index / 5));
    return {
      length,
      sampleRate,
      numberOfChannels: 1,
      duration: length / sampleRate,
      getChannelData: () => channel,
    } as unknown as AudioBuffer;
  }
  const context = {
    sampleRate: 8000,
    createBuffer: (channels: number, length: number, sampleRate: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        length,
        sampleRate,
        numberOfChannels: channels,
        getChannelData: (index: number) => data[index]!,
        copyToChannel: (source: Float32Array, index: number) => data[index]!.set(source),
      };
    },
  } as unknown as BaseAudioContext;

  test('replaces each sample with one lasting 1 / rate as long, leaving the others', async () => {
    const samples = new Map([
      ['a', fakeBuffer(8000)],
      ['b', fakeBuffer(4000)],
      ['c', fakeBuffer(4000)],
    ]);
    const untouched = samples.get('c');
    await stretchDecodedSamples(
      context,
      samples,
      new Map([
        ['a', 0.5],
        ['b', 2],
        ['missing', 0.5],
      ]),
      'wsola',
    );
    expect(samples.get('a')!.length).toBe(16000);
    expect(samples.get('b')!.length).toBe(2000);
    expect(samples.get('c')).toBe(untouched);
    expect(samples.has('missing')).toBe(false);
  });

  test('stops once cancelled', async () => {
    const original = fakeBuffer(800);
    const samples = new Map([['a', original]]);
    await stretchDecodedSamples(context, samples, new Map([['a', 0.5]]), 'wsola', () => true);
    expect(samples.get('a')).toBe(original);
  });
});
