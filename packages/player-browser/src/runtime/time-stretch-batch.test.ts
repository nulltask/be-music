import { describe, expect, it } from 'vite-plus/test';
import { layoutStretchBatch, packStretchBatch, unpackStretchBatch } from './time-stretch-batch.ts';

const ramp = (length: number, from = 1) => Float32Array.from({ length }, (_, index) => from + index);

describe('stretch batches', () => {
  it('lays samples end to end with a gap around each', () => {
    expect(layoutStretchBatch([3, 5], 2)).toEqual({ starts: [2, 7], length: 14 });
    expect(layoutStretchBatch([], 2)).toEqual({ starts: [], length: 2 });
  });

  it('packs mono samples into every channel and stereo ones channel by channel', () => {
    const samples = [[ramp(2)], [ramp(2, 10), ramp(2, 20)]];
    const layout = layoutStretchBatch([2, 2], 1);
    const [left, right] = packStretchBatch(samples, layout, 2);
    expect([...left!]).toEqual([0, 1, 2, 0, 10, 11, 0]);
    expect([...right!]).toEqual([0, 1, 2, 0, 20, 21, 0]);
  });

  it('cuts the samples back out at their stretched places and lengths', () => {
    const samples = [[ramp(2)], [ramp(4, 10), ramp(4, 20)]];
    const layout = layoutStretchBatch([2, 4], 2);
    const batch = packStretchBatch(samples, layout, 2);
    // A rate of 1 is the identity: every sample comes back as it went in, mono ones mono.
    const same = unpackStretchBatch(batch, layout, samples, 1);
    expect(same.map((channels) => channels.map((channel) => [...channel]))).toEqual([
      [[1, 2]],
      [
        [10, 11, 12, 13],
        [20, 21, 22, 23],
      ],
    ]);
    // At half speed each sample starts and lasts twice as long.
    const slow = unpackStretchBatch(
      batch.map((channel) => Float32Array.from({ length: channel.length * 2 }, (_, i) => channel[i >> 1]!)),
      layout,
      samples,
      0.5,
    );
    expect(slow[0]!.map((channel) => [...channel])).toEqual([[1, 1, 2, 2]]);
    expect(slow[1]![1]!.length).toBe(8);
  });
});
