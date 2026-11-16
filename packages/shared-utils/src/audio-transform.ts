import { throwIfAborted } from './abort.ts';

export interface StereoPCMTransform {
  playbackRate?: number;
  leftGain?: number;
  rightGain?: number;
  maxDurationSeconds?: number;
}

/**
 * Resample and attenuate a decoded stereo sample without modifying its source. Duration limits are sounding time
 * after pitch conversion: a longer limit never loops or pads the sample. Mono callers supply the same channel twice.
 */
export function transformStereoPCM(
  left: Float32Array,
  right: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number,
  options: StereoPCMTransform = {},
  signal?: AbortSignal,
): { left: Float32Array; right: Float32Array } {
  const rate = options.playbackRate ?? 1;
  if (![inputSampleRate, outputSampleRate, rate].every((value) => Number.isFinite(value) && value > 0)) {
    throw new RangeError('Sample rates and playback rate must be finite and positive');
  }
  if (![options.leftGain ?? 1, options.rightGain ?? 1].every(Number.isFinite))
    throw new RangeError('Channel gains must be finite');
  throwIfAborted(signal);
  const sourceLength = Math.min(left.length, right.length);
  const step = (inputSampleRate * rate) / outputSampleRate;
  let length = sourceLength === 0 ? 0 : Math.max(1, Math.round(sourceLength / step));
  if (options.maxDurationSeconds !== undefined) {
    if (!Number.isFinite(options.maxDurationSeconds) || options.maxDurationSeconds < 0)
      throw new RangeError('Invalid sample duration');
    length = Math.min(length, Math.round(options.maxDurationSeconds * outputSampleRate));
  }
  const outputLeft = new Float32Array(length);
  const outputRight = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    if ((index & 0x7ff) === 0) throwIfAborted(signal);
    const position = Math.min(index * step, sourceLength - 1);
    const lower = Math.floor(position);
    const upper = Math.min(lower + 1, sourceLength - 1);
    const fraction = position - lower;
    outputLeft[index] = (left[lower]! * (1 - fraction) + left[upper]! * fraction) * (options.leftGain ?? 1);
    outputRight[index] = (right[lower]! * (1 - fraction) + right[upper]! * fraction) * (options.rightGain ?? 1);
  }
  return { left: outputLeft, right: outputRight };
}

/**
 * Length of the gain ramp at a sample-slice boundary, in source seconds. Long enough to turn the step of a cut
 * waveform into a ramp (a click needs well under a millisecond), short enough to keep the attack of a drum hit that
 * starts a slice: a 3 ms ramp audibly blunted it.
 */
export const SAMPLE_SLICE_FADE_SECONDS = 0.001;

/** Gain ramps of a played sample window, in the caller's unit (seconds or frames). */
export interface SampleSliceEnvelope {
  /** Ramp up from silence at the window start; 0 when the window starts at the file's beginning. */
  fadeIn: number;
  /** Ramp down to silence that continues past the window end; 0 when the window plays to the file's end. */
  fadeOut: number;
}

/**
 * Resolves the ramps that keep a bmson slice from clicking where it cuts the source file. A window that starts inside
 * the file ramps up from silence, and one that stops before the file ends keeps playing the audio past its end while
 * it ramps down. The next slice of the same file ramps up over that same stretch, so a continuation crossfades with
 * itself and sums back to the uncut waveform. `offset`, `length`, `sourceLength` and `fadeLength` share one unit;
 * `length` of `undefined` plays to the file's end.
 */
export function resolveSampleSliceEnvelope(
  offset: number,
  length: number | undefined,
  sourceLength: number,
  fadeLength: number,
): SampleSliceEnvelope {
  const remaining = sourceLength - Math.max(0, offset);
  if (!(remaining > 0) || !(fadeLength > 0)) return { fadeIn: 0, fadeOut: 0 };
  const played = length === undefined ? remaining : Math.min(Math.max(0, length), remaining);
  return {
    fadeIn: offset > 0 ? Math.min(fadeLength, played) : 0,
    fadeOut: played < remaining ? Math.min(fadeLength, remaining - played) : 0,
  };
}

/**
 * {@link resolveSampleSliceEnvelope} widened by a voice's own ramps: an `attack` from silence at the window start and a
 * `release` to silence past the window end (an LRX `atk` / `rls`), in the same unit. The ramps a cut needs stay as a
 * minimum; a release only applies when the window stops before the file ends, and neither outlasts the audio there is.
 */
export function resolveSampleVoiceEnvelope(
  offset: number,
  length: number | undefined,
  sourceLength: number,
  fadeLength: number,
  attack = 0,
  release = 0,
): SampleSliceEnvelope {
  const slice = resolveSampleSliceEnvelope(offset, length, sourceLength, fadeLength);
  const remaining = sourceLength - Math.max(0, offset);
  if (!(remaining > 0)) return slice;
  const played = length === undefined ? remaining : Math.min(Math.max(0, length), remaining);
  return {
    fadeIn: attack > 0 ? Math.max(slice.fadeIn, Math.min(attack, played)) : slice.fadeIn,
    fadeOut:
      release > 0 && played < remaining
        ? Math.max(slice.fadeOut, Math.min(release, remaining - played))
        : slice.fadeOut,
  };
}

/**
 * Left and right gains of a stereo balance `pan` from −1 (left) to 1 (right): the far channel fades out linearly while
 * the near one stays at full gain, as FMOD's `setPan` acts on a stereo sound. Out-of-range values are clamped.
 */
export function resolveStereoBalance(pan: number): { left: number; right: number } {
  const clamped = Number.isFinite(pan) ? Math.max(-1, Math.min(1, pan)) : 0;
  return { left: clamped > 0 ? 1 - clamped : 1, right: clamped < 0 ? 1 + clamped : 1 };
}

/** `channel` read at a fractional frame `position` by linear interpolation; 0 outside it. */
export function readSampleFrame(channel: Float32Array, position: number): number {
  const lower = Math.floor(position);
  if (lower < 0 || lower >= channel.length) return 0;
  const fraction = position - lower;
  const upper = lower + 1 < channel.length ? channel[lower + 1]! : 0;
  return fraction === 0 ? channel[lower]! : channel[lower]! * (1 - fraction) + upper * fraction;
}

/**
 * The gain at `position` of a window `length` long (`Infinity` when it plays to the file's end) under `envelope`:
 * 0 → 1 over the fade-in, 1 → 0 over the fade-out past `length`, and 0 outside the window and its fade-out.
 */
export function sampleSliceEnvelopeGain(position: number, length: number, envelope: SampleSliceEnvelope): number {
  if (position < 0) return 0;
  if (position < length) return position < envelope.fadeIn ? position / envelope.fadeIn : 1;
  const tail = position - length;
  return tail < envelope.fadeOut ? 1 - tail / envelope.fadeOut : 0;
}
