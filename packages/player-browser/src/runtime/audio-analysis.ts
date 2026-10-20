/**
 * Live audio features for audio-reactive skins: loudness, a spectrum in the ear's bands (ERB-spaced, A-weighted), bass / mid / high energy, and onset
 * (transient) detection by spectral flux. {@link analyzeAudioFrame} is pure over an explicit state object so it can be
 * tested without Web Audio; {@link AudioAnalyzer} wraps an `AnalyserNode` and samples it once per rendered frame.
 */

import { AUDIO_BAND_COUNT, SILENT_AUDIO, type BeMusicAudioFrame } from '@be-music/player-skin-sdk';

export { AUDIO_BAND_COUNT, SILENT_AUDIO };

/** One frame's analysis (the skin SDK's {@link BeMusicAudioFrame}). */
export type AudioFeatures = BeMusicAudioFrame;

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

/** The ERB-rate scale (Glasberg & Moore): how many of the ear's critical bands lie below `hz`. */
export function erbRate(hz: number): number {
  return 21.4 * Math.log10(1 + 0.00437 * hz);
}

/** The frequency at ERB-rate `erb` (the inverse of {@link erbRate}). */
export function hzAtErbRate(erb: number): number {
  return (10 ** (erb / 21.4) - 1) / 0.00437;
}

/**
 * Half-open FFT bin ranges `[start, end)` for `count` bands spaced evenly on the ERB-rate scale between `minHz` and
 * `maxHz`: as wide as the ear's own frequency resolution, nearly constant in hertz below about 500 Hz and widening
 * like octaves above. So the bass gets a few bands, each spanning several FFT bins, and the mids, where melody and
 * voice sit, get the most.
 */
export function erbBandBins(
  count: number,
  minHz: number,
  maxHz: number,
  sampleRate: number,
  fftSize: number,
): Array<readonly [number, number]> {
  const binCount = Math.floor(fftSize / 2);
  const hzPerBin = sampleRate / fftSize;
  const minErb = erbRate(minHz);
  const step = (erbRate(maxHz) - minErb) / count;
  const ranges: Array<readonly [number, number]> = [];
  let previousEnd = Math.max(1, Math.floor(minHz / hzPerBin));
  for (let band = 0; band < count; band += 1) {
    const upperHz = hzAtErbRate(minErb + step * (band + 1));
    const end = Math.min(binCount, Math.max(previousEnd + 1, Math.round(upperHz / hzPerBin)));
    ranges.push([Math.min(previousEnd, end - 1), end]);
    previousEnd = end;
  }
  return ranges;
}

/**
 * The A-weighting (IEC 61672) at `hz`, in dB: about 0 at 1 kHz, -20 dB at 100 Hz, -50 dB at 20 Hz, a little above 0
 * around 2-4 kHz. The equal-loudness curve of quiet listening, which is how strongly the ear hears each part of the
 * spectrum next to the rest.
 */
export function aWeightingDb(hz: number): number {
  const f2 = hz * hz;
  const ra =
    (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return ra > 0 ? 20 * Math.log10(ra) + 2 : Number.NEGATIVE_INFINITY;
}

/** The dB range `getByteFrequencyData` maps onto 0..255 ({@link AudioAnalyzer} sets it on its analyser). */
export const FREQUENCY_MIN_DB = -100;
export const FREQUENCY_MAX_DB = -30;

/**
 * A band's level (0..1 of the analyser's dB range) as the ear weighs it: `weightDb` added in dB, back on 0..1. Silence
 * stays 0, so a boost never lifts an empty band.
 */
export function weightBandLevel(level: number, weightDb: number): number {
  if (level <= 0) return 0;
  const span = FREQUENCY_MAX_DB - FREQUENCY_MIN_DB;
  return Math.max(0, Math.min(1, level + weightDb / span));
}

/** A running window of what a signal has recently done: its floor and ceiling (see {@link normalizeToRecentRange}). */
export interface RecentRange {
  floor: number;
  ceiling: number;
}

/** Narrowest window a signal is stretched over, so a near-steady signal stays near-steady instead of amplifying noise. */
/** An empty range: the first value seen becomes both its floor and its ceiling. */
export function createRecentRange(): RecentRange {
  return { floor: Number.POSITIVE_INFINITY, ceiling: Number.NEGATIVE_INFINITY };
}

/** Share of the absolute level kept in the analysed bands next to their recent-range placement. */
const ABSOLUTE_SHARE = 0.35;
const MIN_RECENT_SPAN = 0.12;
/** Seconds the floor takes to rise after a quiet passage / the ceiling to fall after a loud one. */
const FLOOR_RISE_SECONDS = 3;
const CEILING_FALL_SECONDS = 2;

/**
 * Automatic gain for visuals: places `value` within the range the signal has covered over the last few seconds and
 * returns 0..1, updating `range` in place. The floor drops instantly and creeps back up; the ceiling jumps instantly and
 * eases back down. A loud, compressed mix whose raw spectrum sits near full scale therefore still swings from bottom
 * to top with the music instead of pinning at the maximum.
 */
export function normalizeToRecentRange(value: number, range: RecentRange, dtSeconds: number): number {
  const dt = Math.max(0, dtSeconds);
  if (value < range.floor) range.floor = value;
  else range.floor += (value - range.floor) * Math.min(1, dt / FLOOR_RISE_SECONDS);
  if (value > range.ceiling) range.ceiling = value;
  else range.ceiling += (value - range.ceiling) * Math.min(1, dt / CEILING_FALL_SECONDS);
  // A window narrower than the minimum is widened about its middle, so a steady signal reads mid-scale.
  const span = Math.max(MIN_RECENT_SPAN, range.ceiling - range.floor);
  const bottom = (range.floor + range.ceiling - span) / 2;
  return Math.max(0, Math.min(1, (value - bottom) / span));
}

/**
 * Automatic gain shared by every band: the range widens to the frame's lowest and highest band at once and drifts back
 * like {@link normalizeToRecentRange}, and every band is placed within that one range. Unlike a gain per band, the
 * shape across the spectrum survives: a band the ear hears less (after weighting) stays lower than its neighbours.
 */
export function normalizeBandsToRecentRange(
  values: readonly number[],
  range: RecentRange,
  dtSeconds: number,
): number[] {
  const dt = Math.max(0, dtSeconds);
  const audible = values.filter((value) => value > 0);
  if (audible.length > 0) {
    const low = Math.min(...audible);
    const high = Math.max(...audible);
    if (low < range.floor) range.floor = low;
    else range.floor += (low - range.floor) * Math.min(1, dt / FLOOR_RISE_SECONDS);
    if (high > range.ceiling) range.ceiling = high;
    else range.ceiling += (high - range.ceiling) * Math.min(1, dt / CEILING_FALL_SECONDS);
  }
  if (!Number.isFinite(range.floor) || !Number.isFinite(range.ceiling)) return values.map(() => 0);
  const span = Math.max(MIN_RECENT_SPAN, range.ceiling - range.floor);
  const bottom = (range.floor + range.ceiling - span) / 2;
  return values.map((value) => (value > 0 ? Math.max(0, Math.min(1, (value - bottom) / span)) : 0));
}

export interface AudioAnalysisState {
  bands: number[];
  /** Recent range of the weighted bands (shared), and of bass / mid / high, for their automatic gain. */
  spectrumRange: RecentRange;
  bassRange: RecentRange;
  midRange: RecentRange;
  highRange: RecentRange;
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
    spectrumRange: createRecentRange(),
    bassRange: createRecentRange(),
    midRange: createRecentRange(),
    highRange: createRecentRange(),
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

/** The spectrum's range: from the lowest kick to the top of the cymbals. */
const SPECTRUM_MIN_HZ = 30;
const SPECTRUM_MAX_HZ = 14000;
/** Bands that cover the low end (below about 200 Hz), weighted up in the onset flux. */
const LOW_END_BANDS = 2;

const LAYOUTS = new Map<string, { ranges: Array<readonly [number, number]>; weightsDb: number[] }>();

/** The band bins and each band's A-weighting (at its centre on the ERB scale), worked out once per sample rate / FFT. */
function spectrumLayout(sampleRate: number, fftSize: number) {
  const key = `${sampleRate}/${fftSize}`;
  let layout = LAYOUTS.get(key);
  if (layout === undefined) {
    const ranges = erbBandBins(AUDIO_BAND_COUNT, SPECTRUM_MIN_HZ, SPECTRUM_MAX_HZ, sampleRate, fftSize);
    const hzPerBin = sampleRate / fftSize;
    const weightsDb = ranges.map(([start, end]) =>
      aWeightingDb(hzAtErbRate((erbRate(start * hzPerBin) + erbRate(end * hzPerBin)) / 2)),
    );
    layout = { ranges, weightsDb };
    LAYOUTS.set(key, layout);
  }
  return layout;
}

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
  const { ranges, weightsDb } = spectrumLayout(sampleRate, fftSize);
  const raw = ranges.map(([start, end]) => {
    let total = 0;
    for (let bin = start; bin < end; bin += 1) total += frequency[bin] ?? 0;
    return end > start ? total / (end - start) / 255 : 0;
  });
  // What the ear hears of each band: quiet ends (sub-bass, air) count for less than the presence range.
  const heard = raw.map((level, band) => weightBandLevel(level, weightsDb[band]!));

  // Fast attack, slower release: visuals snap to a hit and ease off.
  const follow = (current: number, target: number, releaseSeconds: number) =>
    target > current
      ? current + (target - current) * Math.min(1, dt * 30)
      : current + (target - current) * Math.min(1, dt / releaseSeconds);
  // Bands and bass / mid / high are mostly placed within their recent range (see `normalizeToRecentRange`), so visuals
  // swing with the music however loud the mix is; a little of the absolute level stays so loud still reads louder than
  // quiet, and silence still reads as zero.
  const gain = (value: number, range: RecentRange) =>
    value < 0.01 ? 0 : ABSOLUTE_SHARE * value + (1 - ABSOLUTE_SHARE) * normalizeToRecentRange(value, range, dt);
  // One gain for the whole spectrum, so its weighted shape survives; a little absolute level, as above.
  const placed = normalizeBandsToRecentRange(heard, state.spectrumRange, dt);
  for (let band = 0; band < AUDIO_BAND_COUNT; band += 1) {
    const value = heard[band]! < 0.01 ? 0 : ABSOLUTE_SHARE * heard[band]! + (1 - ABSOLUTE_SHARE) * placed[band]!;
    state.bands[band] = follow(state.bands[band]!, value, 0.18);
  }
  state.bass = follow(state.bass, gain(average(20, 150), state.bassRange), 0.2);
  state.mid = follow(state.mid, gain(average(150, 2000), state.midRange), 0.2);
  state.high = follow(state.high, gain(average(2000, 12000), state.highRange), 0.15);
  state.level = follow(state.level, loudness, 0.25);
  state.peak = Math.max(loudness, state.peak * Math.exp(-dt / 0.35));

  // Onsets: spectral flux (rise in band energy, weighted toward the low end) against its own running mean.
  let flux = 0;
  for (let band = 0; band < AUDIO_BAND_COUNT; band += 1) {
    const rise = raw[band]! - state.previousRaw[band]!;
    if (rise > 0) flux += rise * (band < LOW_END_BANDS ? 1.5 : 1);
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
    // The dB range the band levels and their A-weighting are read against.
    this.input.minDecibels = FREQUENCY_MIN_DB;
    this.input.maxDecibels = FREQUENCY_MAX_DB;
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
