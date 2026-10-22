import type { NonstopStitchMap } from '@be-music/player-engine/course';
import { describe, expect, test, vi } from 'vite-plus/test';
import { createNonstopStageMixer, nonstopFadeCurve, nonstopStageGainAt } from './nonstop-audio.ts';

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

  test('carries on a fade from where it is', () => {
    expect([...nonstopFadeCurve('in', 3, 0.5)]).toEqual([0.25, 0.5625, 1]);
    expect([...nonstopFadeCurve('out', 2, 0.5)]).toEqual([0.25, 0]);
  });
});

describe('nonstopStageGainAt', () => {
  test('follows the fade-in and fade-out curves, 1 outside them', () => {
    const [first, second] = MAP.stages;
    expect(nonstopStageGainAt(first!, 10)).toBe(1);
    expect(nonstopStageGainAt(first!, 25)).toBe(0.25);
    expect(nonstopStageGainAt(first!, 31)).toBe(0);
    expect(nonstopStageGainAt(second!, 14)).toBe(0);
    expect(nonstopStageGainAt(second!, 17.5)).toBe(0.25);
    expect(nonstopStageGainAt(second!, 21)).toBe(1);
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
    // The chart started at 2 on the audio clock: chart second 1 now.
    mixer.retime(1, (seconds) => 2 + seconds);
    const [out] = gains[0]!.gain.setValueCurveAtTime.mock.calls;
    expect(out?.slice(1)).toEqual([22, 10]);
    const [fadeIn] = gains[1]!.gain.setValueCurveAtTime.mock.calls;
    expect(fadeIn?.slice(1)).toEqual([17, 5]);
    expect(gains[1]!.gain.setValueAtTime).toHaveBeenCalledWith(0, 3);
    mixer.dispose();
    expect(gains.every((gain) => gain.disconnect.mock.calls.length === 1)).toBe(true);
  });
});

describe('play tempo', () => {
  test('schedules the fades at the play tempo: chart seconds take 1 / tempo on the audio clock', () => {
    const { context, gains } = fakeContext(0);
    const mixer = createNonstopStageMixer(context, {} as AudioNode, MAP);
    // The chart starts at 2 on the audio clock, at half speed.
    mixer.retime(0, (seconds) => 2 + seconds / 0.5);
    expect(gains[0]!.gain.setValueCurveAtTime.mock.calls[0]?.slice(1)).toEqual([42, 20]);
    expect(gains[1]!.gain.setValueCurveAtTime.mock.calls[0]?.slice(1)).toEqual([32, 10]);
  });
});

describe('keep pitch', () => {
  test('plays every stage at its own speed once its samples are stretched', () => {
    const { context } = fakeContext();
    const mixer = createNonstopStageMixer(context, {} as AudioNode, MAP, { keepPitch: true });
    expect([mixer.rate(0), mixer.rate(1)]).toEqual([1, 1]);
  });
});

describe('live tempo', () => {
  test('retimes the fades from the current chart time, carrying on a fade under way', () => {
    const { context, gains } = fakeContext(10);
    const mixer = createNonstopStageMixer(context, {} as AudioNode, MAP);
    // Chart 17.5 s now (mid fade-in of the second stage), and chart second s falls at 10 + (s - 17.5) / 2 from here.
    mixer.retime(17.5, (seconds) => 10 + (seconds - 17.5) / 2);
    const [first, second] = gains;
    expect(first!.gain.cancelScheduledValues).toHaveBeenCalledWith(0);
    expect(first!.gain.setValueAtTime).toHaveBeenCalledWith(1, 10);
    expect(first!.gain.setValueCurveAtTime.mock.calls[0]?.slice(1)).toEqual([11.25, 5]);
    // The fade-in is half done: its curve picks up from there, starting now, without a value set first.
    expect(second!.gain.setValueAtTime).not.toHaveBeenCalled();
    const [curve, start, duration] = second!.gain.setValueCurveAtTime.mock.calls[0]!;
    expect((curve as Float32Array)[0]).toBe(0.25);
    expect([start, duration]).toEqual([10, 1.25]);
  });
});
