import { describe, expect, it } from 'vite-plus/test';
import {
  PEAK_GAIN_MAX_BOOST_LINEAR,
  PEAK_GAIN_TARGET_LINEAR,
  applyChartPeakGain,
  resolvePeakGain,
  type PeakSampleBuffer,
} from './peak-gain.ts';

function buffer(channels: readonly (readonly number[])[]): PeakSampleBuffer {
  const data = channels.map((samples) => Float32Array.from(samples));
  return {
    numberOfChannels: data.length,
    getChannelData: (channel) => data[channel]!,
  };
}

describe('resolvePeakGain', () => {
  it('brings a peak to −3 dBFS and leaves a peak that is already there', () => {
    expect(resolvePeakGain(0.5)).toBeCloseTo(PEAK_GAIN_TARGET_LINEAR / 0.5);
    expect(resolvePeakGain(PEAK_GAIN_TARGET_LINEAR)).toBeCloseTo(1);
    expect(resolvePeakGain(0)).toBe(1);
  });

  it('caps how far a near-silent chart is turned up', () => {
    expect(resolvePeakGain(1e-6)).toBeCloseTo(PEAK_GAIN_MAX_BOOST_LINEAR);
  });
});

describe('applyChartPeakGain', () => {
  it('uses the loudest sample and keeps the others in proportion', () => {
    const loud = buffer([[0.5, -0.25]]);
    const quiet = buffer([[0.1], [-0.1]]);
    const gain = applyChartPeakGain([loud, quiet]);
    expect(gain).toBeCloseTo(PEAK_GAIN_TARGET_LINEAR / 0.5);
    expect(loud.getChannelData(0)[0]).toBeCloseTo(PEAK_GAIN_TARGET_LINEAR);
    expect(loud.getChannelData(0)[1]).toBeCloseTo(-PEAK_GAIN_TARGET_LINEAR / 2);
    expect(quiet.getChannelData(0)[0]).toBeCloseTo(0.1 * gain);
  });
});
