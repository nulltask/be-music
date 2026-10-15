import type { NonstopStitchMap } from '@be-music/player/course';
import { describe, expect, test, vi } from 'vite-plus/test';
import { createNonstopStageMixer, nonstopFadeCurve, resolveNonstopStretchRates } from './nonstop-audio.ts';

function fakeContext(currentTime = 0) {
  const gains: Array<{
    gain: {
      value: number;
      setValueAtTime: ReturnType<typeof vi.fn>;
      setValueCurveAtTime: ReturnType<typeof vi.fn>;
      cancelScheduledValues: ReturnType<typeof vi.fn>;
    };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  const context = {
    currentTime,
    createGain: () => {
      const gain = {
        gain: { value: 1, setValueAtTime: vi.fn(), setValueCurveAtTime: vi.fn(), cancelScheduledValues: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      gains.push(gain);
      return gain;
    },
  } as unknown as BaseAudioContext;
  return { context, gains };
}

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
      soundFadeOut: { start: 20, end: 30 },
      bgaFadeOut: { start: 20, end: 23 },
      lr2StageMarker: false,
    },
    {
      placement: placement(1.25),
      windowStart: 20,
      windowEnd: Number.POSITIVE_INFINITY,
      wavKeys: ['03'],
      bmpKeys: [],
      soundFadeIn: { start: 15, end: 20 },
      bgaFadeIn: { start: 17, end: 20 },
      lr2StageMarker: false,
    },
  ],
  tempo: [],
  stageRanks: [],
};

describe('nonstopFadeCurve', () => {
  test('ramps the volume linearly and applies its square, as LR2 does', () => {
    expect([...nonstopFadeCurve('in', 5)]).toEqual([0, 0.0625, 0.25, 0.5625, 1]);
    expect([...nonstopFadeCurve('out', 3)]).toEqual([1, 0.25, 0]);
  });
});

describe('createNonstopStageMixer', () => {
  test('gives each stage its rate and fade gain, starting a faded-in stage silent', () => {
    const { context, gains } = fakeContext();
    const destination = {} as AudioNode;
    const mixer = createNonstopStageMixer(context, destination, MAP);
    expect([mixer.stageOf('01'), mixer.stageOf('03'), mixer.stageOf('zz')]).toEqual([0, 1, undefined]);
    expect([mixer.rate(0), mixer.rate(1)]).toEqual([1, 1.25]);
    expect(gains.map((gain) => gain.gain.value)).toEqual([1, 0]);
    expect(gains.every((gain) => gain.connect.mock.calls[0]?.[0] === destination)).toBe(true);
    expect(mixer.bgmInput(1)).toBe(gains[1]);
  });

  test('schedules the fades against the chart start on the audio clock', () => {
    const { context, gains } = fakeContext(3);
    const mixer = createNonstopStageMixer(context, {} as AudioNode, MAP);
    mixer.schedule(2);
    const [out] = gains[0]!.gain.setValueCurveAtTime.mock.calls;
    expect(out?.slice(1)).toEqual([22, 10]);
    const [fadeIn] = gains[1]!.gain.setValueCurveAtTime.mock.calls;
    expect(fadeIn?.slice(1)).toEqual([17, 5]);
    expect(gains[1]!.gain.setValueAtTime).toHaveBeenCalledWith(0, 3);
    mixer.dispose();
    expect(gains.every((gain) => gain.disconnect.mock.calls.length === 1)).toBe(true);
  });
});

describe('Master Tempo', () => {
  test('plays every stage at its own speed once its samples are stretched', () => {
    const { context } = fakeContext();
    const mixer = createNonstopStageMixer(context, {} as AudioNode, MAP, { masterTempo: true });
    expect([mixer.rate(0), mixer.rate(1)]).toEqual([1, 1]);
  });

  test('stretches the samples of the stages a FIT connection retimes', () => {
    const rates = resolveNonstopStretchRates(MAP, { '01': 's0/A.wav', '02': 's0/b.wav', '03': 's1/Kick.WAV' }, (path) =>
      path.toLowerCase(),
    );
    expect([...rates]).toEqual([['s1/kick.wav', 1.25]]);
  });
});
