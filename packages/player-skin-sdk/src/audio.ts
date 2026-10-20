/** Number of log-spaced spectrum bands in {@link BeMusicAudioFrame.bands}. */
export const AUDIO_BAND_COUNT = 16;

/**
 * Live analysis of what is playing, sampled once per frame. Gameplay taps the whole mix; select taps the BGM and chart
 * preview. Absent when the host has no Web Audio.
 */
export interface BeMusicAudioFrame {
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

/** A frame of silence. */
export const SILENT_AUDIO: BeMusicAudioFrame = Object.freeze({
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
