import { AUDIO_BAND_COUNT, bandLevel } from '@be-music/skin-sdk';

/**
 * Synesthesia's floor as a spectrum: the music's spectrum is written across the screen (bass on the left, highs on the
 * right) and pushed out from the viewer into the distance, so the ground right in front of the camera shows what is
 * playing now and the far floor what played a moment ago.
 */

/** Spectrum snapshots kept per second of history. */
export const SPECTRUM_HISTORY_HZ = 60;
/** How fast (world units per second) the spectrum travels away from the viewer across the floor. */
export const SPECTRUM_WAVE_SPEED = 900;
/** Tallest a ridge rises (world units) when its band is at full level. */
export const SPECTRUM_RIDGE_HEIGHT = 120;

/** A ring of the latest spectrum snapshots, sampled at {@link SPECTRUM_HISTORY_HZ}. */
export class SpectrumHistory {
  public readonly bands: number;
  public readonly capacity: number;
  private readonly frames: Float32Array;
  /** Slot of the newest snapshot. */
  private head = 0;
  /** How many slots hold a snapshot so far. */
  private filled = 0;
  /** Fraction of a tick carried over between pushes. */
  private carry = 0;

  public constructor(bands = AUDIO_BAND_COUNT, capacity = 4 * SPECTRUM_HISTORY_HZ) {
    this.bands = bands;
    this.capacity = capacity;
    this.frames = new Float32Array(bands * capacity);
  }

  /** Advances the history by `dt` seconds, writing `levels` (one 0..1 value per band) into every tick that passed. */
  public push(levels: ArrayLike<number>, dt: number): void {
    this.carry += Math.max(0, dt) * SPECTRUM_HISTORY_HZ;
    const ticks = Math.min(this.capacity, Math.floor(this.carry));
    this.carry -= Math.floor(this.carry);
    for (let tick = 0; tick < ticks; tick += 1) {
      this.head = (this.head + 1) % this.capacity;
      const base = this.head * this.bands;
      for (let band = 0; band < this.bands; band += 1) this.frames[base + band] = levels[band] ?? 0;
      this.filled = Math.min(this.capacity, this.filled + 1);
    }
  }

  /**
   * The level at `position` across the spectrum (0 = lowest band, 1 = highest, linearly blended between bands) as it was
   * `ageSeconds` ago, blended between snapshots. 0 before the history began or past its end.
   */
  public sample(position: number, ageSeconds: number): number {
    const age = Math.max(0, ageSeconds) * SPECTRUM_HISTORY_HZ;
    const older = Math.floor(age);
    const blend = age - older;
    const band = Math.max(0, Math.min(1, position)) * (this.bands - 1);
    const low = Math.floor(band);
    const high = Math.min(this.bands - 1, low + 1);
    const across = band - low;
    const newer = this.levelAt(older, low) + (this.levelAt(older, high) - this.levelAt(older, low)) * across;
    const elder =
      this.levelAt(older + 1, low) + (this.levelAt(older + 1, high) - this.levelAt(older + 1, low)) * across;
    return newer + (elder - newer) * blend;
  }

  private levelAt(age: number, band: number): number {
    if (age >= this.filled) return 0;
    const slot = (this.head - age + this.capacity) % this.capacity;
    return this.frames[slot * this.bands + band]!;
  }
}

/** Writes each band's display level ({@link bandLevel}) of `bands` into `out` and returns it. */
export function spectrumLevels(bands: readonly number[], out: Float32Array): Float32Array {
  for (let band = 0; band < out.length; band += 1) out[band] = bandLevel(bands, band, out.length);
  return out;
}

/**
 * How high (world units) the floor rises at `position` across the spectrum (0 = bass at the screen's left edge, 1 =
 * highs at its right) and depth `z`: that band as it was when the wave now at `z` left the viewer. The level is eased in
 * so quiet bands lie flat and loud ones stand up as ridges.
 */
export function spectrumRise(history: SpectrumHistory, position: number, z: number): number {
  const level = history.sample(position, Math.max(0, z) / SPECTRUM_WAVE_SPEED);
  return SPECTRUM_RIDGE_HEIGHT * level ** 1.5;
}

/** Widest gap (world units) between a floor row's points, used for the far rows. */
const ROW_STEP_MAX = 50;
/** Finest the floor rows get: {@link ROW_STEP_MAX} halved this many times. */
const ROW_STEP_HALVINGS = 3;

/**
 * Gap (world units) between the points of a floor row at depth `z`, so they land about `screenGap` px apart on screen
 * (`focal` is the projection's focal length) and near rows read as continuous waveforms. Steps are {@link ROW_STEP_MAX}
 * halved a whole number of times, so a row moving closer only gains points in between — it never shifts the ones it has.
 */
export function floorRowStep(z: number, focal: number, screenGap: number): number {
  const ideal = (screenGap * (focal + Math.max(0, z))) / focal;
  let step = ROW_STEP_MAX;
  for (let halving = 0; halving < ROW_STEP_HALVINGS && step / 2 >= ideal; halving += 1) step /= 2;
  return step;
}
