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
