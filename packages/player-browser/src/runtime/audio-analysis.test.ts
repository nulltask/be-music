import { describe, expect, it } from 'vite-plus/test';
import {
  AUDIO_BAND_COUNT,
  SILENT_AUDIO,
  aWeightingDb,
  analyzeAudioFrame,
  createAudioAnalysisState,
  createRecentRange,
  erbBandBins,
  erbRate,
  hzAtErbRate,
  logBandBins,
  normalizeBandsToRecentRange,
  normalizeToRecentRange,
  weightBandLevel,
  type AudioFrameInput,
} from './audio-analysis.ts';

const SAMPLE_RATE = 48000;
const FFT = 2048;

function frame(
  overrides: Partial<AudioFrameInput> & { level?: number; lowBins?: number; allBins?: number },
): AudioFrameInput {
  const frequency = new Uint8Array(FFT / 2).fill(overrides.allBins ?? 0);
  if (overrides.lowBins !== undefined) frequency.fill(overrides.lowBins, 0, 7);
  const waveform = new Float32Array(FFT);
  const amplitude = overrides.level ?? 0;
  for (let index = 0; index < waveform.length; index += 1) waveform[index] = amplitude * Math.sin(index / 7);
  return { frequency, waveform, sampleRate: SAMPLE_RATE, fftSize: FFT, dtSeconds: 1 / 60, nowMs: 0, ...overrides };
}

describe('logBandBins', () => {
  it('covers the range with contiguous, non-empty, widening bands', () => {
    const bins = logBandBins(16, 30, 14000, SAMPLE_RATE, FFT);
    expect(bins).toHaveLength(16);
    for (let band = 1; band < bins.length; band += 1) {
      expect(bins[band]![0]).toBe(bins[band - 1]![1]);
      expect(bins[band]![1]).toBeGreaterThan(bins[band]![0]);
    }
    expect(bins.at(-1)![1] - bins.at(-1)![0]).toBeGreaterThan(bins[0]![1] - bins[0]![0]);
    expect(bins.at(-1)![1]).toBeLessThanOrEqual(FFT / 2);
  });
});

describe('erbRate', () => {
  it("counts the ear's critical bands, and inverts", () => {
    expect(erbRate(1000)).toBeCloseTo(15.6, 1);
    expect(erbRate(0)).toBe(0);
    for (const hz of [30, 440, 14000]) expect(hzAtErbRate(erbRate(hz))).toBeCloseTo(hz, 6);
  });
});

describe('erbBandBins', () => {
  it('covers the range with contiguous, non-empty bands', () => {
    const bins = erbBandBins(16, 30, 14000, SAMPLE_RATE, FFT);
    expect(bins).toHaveLength(16);
    for (let band = 1; band < bins.length; band += 1) {
      expect(bins[band]![0]).toBe(bins[band - 1]![1]);
      expect(bins[band]![1]).toBeGreaterThan(bins[band]![0]);
    }
    expect(bins[0]![0]).toBe(1);
    expect(bins.at(-1)![1]).toBeLessThanOrEqual(FFT / 2);
  });

  it('gives the bass fewer, wider-in-bins bands than an octave split, and the mids more', () => {
    const erb = erbBandBins(16, 30, 14000, SAMPLE_RATE, FFT);
    const log = logBandBins(16, 30, 14000, SAMPLE_RATE, FFT);
    const below = (bins: Array<readonly [number, number]>, hz: number) =>
      bins.filter(([, end]) => end * (SAMPLE_RATE / FFT) <= hz).length;
    expect(below(erb, 250)).toBeLessThan(below(log, 250));
    expect(erb[0]![1] - erb[0]![0]).toBeGreaterThan(log[0]![1] - log[0]![0]);
  });
});

describe('aWeightingDb', () => {
  it('follows the IEC 61672 curve', () => {
    expect(aWeightingDb(1000)).toBeCloseTo(0, 1);
    expect(aWeightingDb(100)).toBeCloseTo(-19.1, 0);
    expect(aWeightingDb(31.5)).toBeCloseTo(-39.4, 0);
    expect(aWeightingDb(2500)).toBeGreaterThan(1);
    expect(aWeightingDb(10000)).toBeCloseTo(-2.5, 0);
  });
});

describe('weightBandLevel', () => {
  it('shifts a level by dB across the analyser range, clamped, leaving silence silent', () => {
    expect(weightBandLevel(0.5, -35)).toBeCloseTo(0, 6);
    expect(weightBandLevel(0.5, 7)).toBeCloseTo(0.6, 6);
    expect(weightBandLevel(0.95, 7)).toBe(1);
    expect(weightBandLevel(0, 20)).toBe(0);
  });
});

describe('normalizeBandsToRecentRange', () => {
  it("keeps the bands' relative shape under one shared gain", () => {
    const range = createRecentRange();
    let placed: number[] = [];
    for (let frame = 0; frame < 60; frame += 1) placed = normalizeBandsToRecentRange([0.2, 0.5, 0.8], range, 1 / 60);
    expect(placed[0]!).toBeLessThan(placed[1]!);
    expect(placed[1]!).toBeLessThan(placed[2]!);
    expect(placed[0]!).toBeLessThan(0.1);
    expect(placed[2]!).toBeGreaterThan(0.9);
  });

  it('leaves silent bands at zero and an all-silent frame at zero', () => {
    const range = createRecentRange();
    expect(normalizeBandsToRecentRange([0, 0], range, 1 / 60)).toEqual([0, 0]);
    expect(normalizeBandsToRecentRange([0, 0.6, 0.7], range, 1 / 60)[0]).toBe(0);
  });
});

describe('analyzeAudioFrame', () => {
  it('reports silence as zero', () => {
    const features = analyzeAudioFrame(createAudioAnalysisState(), frame({}));
    expect(features.level).toBe(0);
    expect(features.db).toBe(-96);
    expect(features.onset).toBe(0);
    expect(features.bands).toHaveLength(AUDIO_BAND_COUNT);
  });

  it('measures loudness in dBFS and follows it', () => {
    const state = createAudioAnalysisState();
    let features = SILENT_AUDIO;
    for (let step = 0; step < 30; step += 1)
      features = analyzeAudioFrame(state, frame({ level: 0.5, nowMs: step * 16 }));
    // A 0.5-amplitude sine has RMS ≈ 0.354 ≈ -9 dBFS.
    expect(features.db).toBeCloseTo(-9, 0);
    expect(features.level).toBeGreaterThan(0.75);
    expect(features.peak).toBeGreaterThanOrEqual(features.level - 1e-9);
  });

  it('puts low-bin energy into bass and the first bands', () => {
    const state = createAudioAnalysisState();
    let features = SILENT_AUDIO;
    for (let step = 0; step < 20; step += 1) {
      features = analyzeAudioFrame(state, frame({ level: 0.3, lowBins: 230, nowMs: step * 16 }));
    }
    expect(features.bass).toBeGreaterThan(0.5);
    expect(features.high).toBeLessThan(0.05);
    expect(features.bands[0]).toBeGreaterThan(features.bands.at(-1)!);
  });

  it('detects an onset on a sudden rise, then decays and rate-limits', () => {
    const state = createAudioAnalysisState();
    for (let step = 0; step < 30; step += 1)
      analyzeAudioFrame(state, frame({ level: 0.2, allBins: 20, nowMs: step * 16 }));
    const hit = analyzeAudioFrame(state, frame({ level: 0.6, allBins: 200, nowMs: 30 * 16 }));
    expect(hit.onset).toBe(1);
    expect(hit.onsetAtMs).toBe(30 * 16);
    // Another rise 16 ms later is inside the minimum gap.
    const again = analyzeAudioFrame(state, frame({ level: 0.9, allBins: 255, nowMs: 31 * 16 }));
    expect(again.onsetAtMs).toBe(30 * 16);
    expect(again.onset).toBeLessThan(1);
  });

  it('ignores invalid frame steps', () => {
    const state = createAudioAnalysisState();
    const features = analyzeAudioFrame(state, frame({ level: 0.5, allBins: 200, dtSeconds: Number.NaN }));
    expect(features.onset).toBe(0);
    expect(features.level).toBe(0);
  });
});

describe('normalizeToRecentRange', () => {
  it('stretches a signal over the range it recently covered', () => {
    const range = createRecentRange();
    normalizeToRecentRange(0.9, range, 1 / 60);
    normalizeToRecentRange(0.7, range, 1 / 60);
    expect(normalizeToRecentRange(0.9, range, 1 / 60)).toBeGreaterThan(0.9);
    expect(normalizeToRecentRange(0.7, range, 1 / 60)).toBeLessThan(0.1);
  });

  it('reads a loud, steady signal as mid-scale instead of pinning it at the maximum', () => {
    const range = createRecentRange();
    let value = 0;
    for (let frame = 0; frame < 60 * 8; frame += 1) value = normalizeToRecentRange(0.95, range, 1 / 60);
    expect(value).toBeCloseTo(0.5, 2);
  });

  it('swings fully with a loud signal that pulses', () => {
    const range = createRecentRange();
    let low = 1;
    let high = 0;
    for (let frame = 0; frame < 60 * 6; frame += 1) {
      const value = normalizeToRecentRange(frame % 30 < 15 ? 0.95 : 0.8, range, 1 / 60);
      if (frame > 60 * 3) {
        low = Math.min(low, value);
        high = Math.max(high, value);
      }
    }
    expect(high).toBeGreaterThan(0.9);
    expect(low).toBeLessThan(0.2);
  });
});
