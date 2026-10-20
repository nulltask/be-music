/**
 * Stretching many samples in one pass: a stage's samples are laid end to end with silence between them, stretched as
 * one signal, and cut back out. An offline stretcher that needs a set-up per call (Signalsmith Stretch renders through
 * an `OfflineAudioContext`) then runs once per stage instead of once per keysound. The silence keeps one sample's tail
 * from bleeding into the next through the stretcher's frames.
 */

/** Where each sample sits in a batch, in input samples, and the batch's length. */
export interface StretchBatchLayout {
  starts: number[];
  length: number;
}

/** Lays samples of `lengths` end to end, `gap` samples apart (and `gap` before the first and after the last). */
export function layoutStretchBatch(lengths: readonly number[], gap: number): StretchBatchLayout {
  const starts: number[] = [];
  let cursor = gap;
  for (const length of lengths) {
    starts.push(cursor);
    cursor += length + gap;
  }
  return { starts, length: cursor };
}

/**
 * Copies `channels` (each sample's channels, any count) into a batch of `channelCount` channels laid out by `layout`.
 * A mono sample goes to every channel; a sample with more channels than the batch drops the extra ones.
 */
export function packStretchBatch(
  samples: readonly (readonly Float32Array[])[],
  layout: StretchBatchLayout,
  channelCount: number,
): Float32Array<ArrayBuffer>[] {
  const batch = Array.from({ length: channelCount }, () => new Float32Array(layout.length));
  samples.forEach((channels, index) => {
    const start = layout.starts[index]!;
    for (let channel = 0; channel < channelCount; channel += 1) {
      const source = channels[channels.length === 1 ? 0 : channel];
      if (source !== undefined) batch[channel]!.set(source, start);
    }
  });
  return batch;
}

/**
 * Cuts each sample back out of a batch stretched by `rate` (played `rate` times as fast): a sample that started at
 * input sample `s` with `n` samples now starts at `s / rate` and lasts `n / rate`. A mono sample comes back mono (the
 * batch's channels averaged).
 */
export function unpackStretchBatch(
  stretched: readonly Float32Array[],
  layout: StretchBatchLayout,
  samples: readonly (readonly Float32Array[])[],
  rate: number,
): Float32Array<ArrayBuffer>[][] {
  return samples.map((channels, index) => {
    const start = Math.round(layout.starts[index]! / rate);
    const length = Math.max(1, Math.round(channels[0]!.length / rate));
    const cut = (source: Float32Array): Float32Array<ArrayBuffer> => {
      const out = new Float32Array(length);
      out.set(source.subarray(start, Math.min(source.length, start + length)));
      return out;
    };
    if (channels.length === 1 && stretched.length > 1) {
      const mono = new Float32Array(length);
      for (const channel of stretched) {
        const part = cut(channel);
        for (let i = 0; i < length; i += 1) mono[i]! += part[i]! / stretched.length;
      }
      return [mono];
    }
    return channels.map((_, channel) => cut(stretched[Math.min(channel, stretched.length - 1)]!));
  });
}
