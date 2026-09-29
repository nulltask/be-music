import { describe, expect, it } from 'vite-plus/test';
import {
  AUDIO_BAND_COUNT,
  SILENT_AUDIO,
  analyzeAudioFrame,
  createAudioAnalysisState,
  logBandBins,
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
