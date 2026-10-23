/**
 * One gain for a whole chart, so charts authored at different levels sit nearer each other. The loudest sample's peak
 * is brought to {@link PEAK_GAIN_TARGET_LINEAR}; every other sample keeps its level relative to that peak. A boost is
 * capped so a near-silent sample cannot lift the noise floor without limit.
 */

/** −3 dBFS. Leaves a little room above the loudest sample before several notes sum. */
export const PEAK_GAIN_TARGET_LINEAR = 10 ** (-3 / 20);
/** +24 dB. The most a quiet chart is turned up. */
export const PEAK_GAIN_MAX_BOOST_LINEAR = 10 ** (24 / 20);

/** The slice of an `AudioBuffer` the peak scan reads and scales. */
export interface PeakSampleBuffer {
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

/** The largest absolute sample in `buffer`. */
export function samplePeak(buffer: PeakSampleBuffer): number {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (const sample of data) {
      const value = Math.abs(sample);
      if (value > peak) peak = value;
    }
  }
  return peak;
}

/**
 * The linear gain that brings `peak` to the target. `1` when there is no signal, or the peak is already there. Never
 * larger than the boost cap.
 */
export function resolvePeakGain(
  peak: number,
  target = PEAK_GAIN_TARGET_LINEAR,
  maxBoost = PEAK_GAIN_MAX_BOOST_LINEAR,
): number {
  if (!(peak > 0) || !Number.isFinite(peak) || !(target > 0)) return 1;
  const gain = target / peak;
  if (!Number.isFinite(gain) || gain <= 0) return 1;
  return Math.min(gain, maxBoost);
}

/** Scales every channel of `buffers` by `gain`. A gain of 1 leaves them untouched. */
export function applyPeakGain(buffers: Iterable<PeakSampleBuffer>, gain: number): void {
  if (!(gain > 0) || !Number.isFinite(gain) || Math.abs(gain - 1) < 1e-4) return;
  for (const buffer of buffers) {
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) data[index] = (data[index] ?? 0) * gain;
    }
  }
}

/**
 * Scales `buffers` together so the loudest peak among them meets the target. Returns the gain applied (`1` when
 * nothing changed).
 */
export function applyChartPeakGain(buffers: Iterable<PeakSampleBuffer>): number {
  const list = [...buffers];
  let peak = 0;
  for (const buffer of list) peak = Math.max(peak, samplePeak(buffer));
  const gain = resolvePeakGain(peak);
  applyPeakGain(list, gain);
  return gain;
}
