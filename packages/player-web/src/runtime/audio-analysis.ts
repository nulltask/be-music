/**
 * Live audio features for audio-reactive skins: loudness, a log-spaced spectrum, bass / mid / high energy, and onset
 * (transient) detection by spectral flux. {@link analyzeAudioFrame} is pure over an explicit state object so it can be
 * tested without Web Audio; {@link AudioAnalyzer} wraps an `AnalyserNode` and samples it once per rendered frame.
 */

/** Number of log-spaced spectrum bands in {@link AudioFeatures.bands}. */
export const AUDIO_BAND_COUNT = 16;

export interface AudioFeatures {
  /** Smoothed loudness in 0..1 (RMS mapped from -48 dBFS → 0 to 0 dBFS → 1). */
  readonly level: number;
  /** Fast-attack, slow-release loudness in 0..1 — good for meters and flashes. */
  readonly peak: number;
  /** Instantaneous RMS level in dBFS, clamped to [-96, 0]. */
  readonly db: number;
  /** Smoothed energy in 0..1 below 150 Hz / 150 Hz–2 kHz / above 2 kHz. */
  readonly bass: number;
  readonly mid: number;
  readonly high: number;
  /** {@link AUDIO_BAND_COUNT} log-spaced band energies (≈ 30 Hz → 14 kHz), each 0..1, smoothed. */
  readonly bands: readonly number[];
  /** 1 on a detected transient (kick, snare, stab), decaying toward 0 over ~150 ms. */
  readonly onset: number;
  /** Clock ms of the most recent onset (`undefined` until the first). */
  readonly onsetAtMs: number | undefined;
}

export const SILENT_AUDIO: AudioFeatures = Object.freeze({
  level: 0,
  peak: 0,
  db: -96,
  bass: 0,
  mid: 0,
  high: 0,
  bands: Object.freeze(Array.from({ length: AUDIO_BAND_COUNT }, () => 0)),
  onset: 0,
  onsetAtMs: undefined,
});

/** Half-open FFT bin ranges `[start, end)` for `count` log-spaced bands between `minHz` and `maxHz`. */
export function logBandBins(
  count: number,
  minHz: number,
  maxHz: number,
  sampleRate: number,
  fftSize: number,
): Array<readonly [number, number]> {
  const binCount = Math.floor(fftSize / 2);
  const hzPerBin = sampleRate / fftSize;
  const ranges: Array<readonly [number, number]> = [];
  let previousEnd = Math.max(1, Math.floor(minHz / hzPerBin));
  for (let band = 0; band < count; band += 1) {
    const upperHz = minHz * (maxHz / minHz) ** ((band + 1) / count);
    const end = Math.min(binCount, Math.max(previousEnd + 1, Math.round(upperHz / hzPerBin)));
    ranges.push([Math.min(previousEnd, end - 1), end]);
    previousEnd = end;
  }
  return ranges;
}

export interface AudioAnalysisState {
  bands: number[];
  bass: number;
  mid: number;
  high: number;
  level: number;
  peak: number;
  /** Previous raw band energies, for spectral flux. */
  previousRaw: number[];
  /** Running mean of the flux (adaptive onset threshold). */
  fluxMean: number;
  onset: number;
  onsetAtMs: number | undefined;
}

export function createAudioAnalysisState(): AudioAnalysisState {
  return {
    bands: Array.from({ length: AUDIO_BAND_COUNT }, () => 0),
    bass: 0,
    mid: 0,
    high: 0,
    level: 0,
    peak: 0,
    previousRaw: Array.from({ length: AUDIO_BAND_COUNT }, () => 0),
    fluxMean: 0,
    onset: 0,
    onsetAtMs: undefined,
  };
}

export interface AudioFrameInput {
  /** `AnalyserNode.getByteFrequencyData` output: one 0..255 value per bin. */
  frequency: Uint8Array;
  /** `AnalyserNode.getFloatTimeDomainData` output: samples in [-1, 1]. */
  waveform: Float32Array;
  sampleRate: number;
  fftSize: number;
  /** Seconds since the previous frame (clamped to 0..0.25). */
  dtSeconds: number;
  nowMs: number;
}

const MIN_ONSET_GAP_MS = 90;

/** Advances `state` by one frame and returns the features for it. */
export function analyzeAudioFrame(state: AudioAnalysisState, input: AudioFrameInput): AudioFeatures {
  const dt = Math.max(0, Math.min(0.25, Number.isFinite(input.dtSeconds) ? input.dtSeconds : 0));
  const { frequency, waveform, sampleRate, fftSize } = input;
  // Loudness from the waveform's RMS.
  let sum = 0;
  for (let index = 0; index < waveform.length; index += 1) sum += waveform[index]! * waveform[index]!;
  const rms = waveform.length > 0 ? Math.sqrt(sum / waveform.length) : 0;
  const db = rms > 1e-5 ? Math.max(-96, Math.min(0, 20 * Math.log10(rms))) : -96;
  const loudness = Math.max(0, Math.min(1, (db + 48) / 48));

  const average = (fromHz: number, toHz: number): number => {
    const hzPerBin = sampleRate / fftSize;
    const start = Math.max(0, Math.floor(fromHz / hzPerBin));
    const end = Math.min(frequency.length, Math.max(start + 1, Math.ceil(toHz / hzPerBin)));
    let total = 0;
    for (let bin = start; bin < end; bin += 1) total += frequency[bin] ?? 0;
    return end > start ? total / (end - start) / 255 : 0;
  };
  const ranges = logBandBins(AUDIO_BAND_COUNT, 30, 14000, sampleRate, fftSize);
  const raw = ranges.map(([start, end]) => {
    let total = 0;
    for (let bin = start; bin < end; bin += 1) total += frequency[bin] ?? 0;
    return end > start ? total / (end - start) / 255 : 0;
  });

  // Fast attack, slower release: visuals snap to a hit and ease off.
  const follow = (current: number, target: number, releaseSeconds: number) =>
    target > current
      ? current + (target - current) * Math.min(1, dt * 30)
      : current + (target - current) * Math.min(1, dt / releaseSeconds);
  for (let band = 0; band < AUDIO_BAND_COUNT; band += 1) {
    state.bands[band] = follow(state.bands[band]!, raw[band]!, 0.18);
  }
  state.bass = follow(state.bass, average(20, 150), 0.2);
  state.mid = follow(state.mid, average(150, 2000), 0.2);
  state.high = follow(state.high, average(2000, 12000), 0.15);
  state.level = follow(state.level, loudness, 0.25);
  state.peak = Math.max(loudness, state.peak * Math.exp(-dt / 0.35));

  // Onsets: spectral flux (rise in band energy, weighted toward the low end) against its own running mean.
  let flux = 0;
  for (let band = 0; band < AUDIO_BAND_COUNT; band += 1) {
    const rise = raw[band]! - state.previousRaw[band]!;
    if (rise > 0) flux += rise * (band < 5 ? 1.5 : 1);
  }
  flux /= AUDIO_BAND_COUNT;
  state.previousRaw = raw;
  const threshold = state.fluxMean * 1.6 + 0.012;
  const sinceOnset = state.onsetAtMs === undefined ? Number.POSITIVE_INFINITY : input.nowMs - state.onsetAtMs;
  if (dt > 0 && flux > threshold && sinceOnset >= MIN_ONSET_GAP_MS && loudness > 0.05) {
    state.onset = 1;
    state.onsetAtMs = input.nowMs;
  } else {
    state.onset *= Math.exp(-dt / 0.15);
  }
  state.fluxMean += (flux - state.fluxMean) * Math.min(1, dt / 0.5);

  return {
    level: state.level,
    peak: state.peak,
    db,
    bass: state.bass,
    mid: state.mid,
    high: state.high,
    bands: state.bands.slice(),
    onset: state.onset,
    onsetAtMs: state.onsetAtMs,
  };
}

/**
 * Taps an audio graph with an `AnalyserNode` (connect sources to {@link input}; it outputs nowhere) and turns it into
 * {@link AudioFeatures} once per frame. Repeated `sample` calls within the same millisecond reuse the last result.
 */
export class AudioAnalyzer {
  public readonly input: AnalyserNode;
  private readonly frequency: Uint8Array<ArrayBuffer>;
  private readonly waveform: Float32Array<ArrayBuffer>;
  private readonly state = createAudioAnalysisState();
  private readonly sampleRate: number;
  private lastMs: number | undefined;
  private last: AudioFeatures = SILENT_AUDIO;

  public constructor(context: BaseAudioContext) {
    this.input = context.createAnalyser();
    this.input.fftSize = 2048;
    this.input.smoothingTimeConstant = 0.5;
    this.frequency = new Uint8Array(this.input.frequencyBinCount);
    this.waveform = new Float32Array(this.input.fftSize);
    this.sampleRate = context.sampleRate;
  }

  public sample(nowMs: number): AudioFeatures {
    if (this.lastMs !== undefined && nowMs === this.lastMs) return this.last;
    const dt = this.lastMs === undefined ? 0 : (nowMs - this.lastMs) / 1000;
    this.lastMs = nowMs;
    this.input.getByteFrequencyData(this.frequency);
    this.input.getFloatTimeDomainData(this.waveform);
    this.last = analyzeAudioFrame(this.state, {
      frequency: this.frequency,
      waveform: this.waveform,
      sampleRate: this.sampleRate,
      fftSize: this.input.fftSize,
      dtSeconds: dt,
      nowMs,
    });
    return this.last;
  }

  public dispose(): void {
    try {
      this.input.disconnect();
    } catch {
      // Already disconnected (or the context closed first).
    }
  }
}
