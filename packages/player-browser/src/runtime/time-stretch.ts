import { logger } from '../logger.ts';
import { layoutStretchBatch, packStretchBatch, unpackStretchBatch } from './time-stretch-batch.ts';

const log = logger('time-stretch');

/**
 * Time stretching that keeps the pitch, for a NONSTOP stage whose FIT connection changes its
 * tempo: WSOLA (waveform-similarity overlap-add). Each output frame is a Hann-windowed input frame taken near where the
 * new tempo puts it, shifted by up to {@link SEARCH_SECONDS} to the offset whose waveform best continues the previous
 * frame, so the overlaps add up without phase cancellation.
 */

/** Frame length: long enough for low notes, short enough to keep transients. */
const FRAME_SECONDS = 0.05;
/** How far a frame may move from its nominal place to line up with the previous one. */
const SEARCH_SECONDS = 0.012;
/** The search compares every `SEARCH_STEP`th sample, then settles on the best offset at that step. */
const SEARCH_STEP = 4;

/**
 * `channels` played `rate` times as fast without changing their pitch: the result lasts `length / rate` samples
 * (`rate` 0.5 doubles it, 2 halves it). Every channel takes the same frame offsets (found on their mix), so the stereo
 * image holds. A `rate` of 1 (or not finite and positive) returns copies of the input.
 */
export function timeStretchChannels(
  channels: readonly Float32Array[],
  sampleRate: number,
  rate: number,
): Float32Array<ArrayBuffer>[] {
  const inputLength = channels[0]?.length ?? 0;
  if (!(rate > 0) || !Number.isFinite(rate) || rate === 1 || inputLength === 0) {
    return channels.map((channel) => new Float32Array(channel));
  }
  const frame = Math.max(8, 2 * Math.round((FRAME_SECONDS * sampleRate) / 2));
  const hop = frame / 2;
  const search = Math.max(SEARCH_STEP, Math.round(SEARCH_SECONDS * sampleRate));
  const outputLength = Math.max(1, Math.round(inputLength / rate));
  const window = hann(frame);
  const mix = mono(channels);
  const outputs = channels.map(() => new Float32Array(outputLength + frame));
  const at = (signal: Float32Array, index: number): number =>
    index >= 0 && index < signal.length ? signal[index]! : 0;

  // `natural`: where the previous frame's waveform continues in the input, the frame the overlap should resemble. The
  // first frame starts half a frame early so the output's first samples are covered by two windows too: a sample's
  // attack is not faded in.
  let natural = 0;
  for (let outStart = -hop; outStart < outputLength; outStart += hop) {
    const nominal = Math.round(outStart * rate);
    let start = nominal;
    if (outStart > -hop) {
      let best = -Infinity;
      for (let offset = -search; offset <= search; offset += SEARCH_STEP) {
        const candidate = nominal + offset;
        let score = 0;
        for (let index = 0; index < hop; index += SEARCH_STEP) {
          score += at(mix, candidate + index) * at(mix, natural + index);
        }
        if (score > best) {
          best = score;
          start = candidate;
        }
      }
    }
    for (let channel = 0; channel < channels.length; channel += 1) {
      const input = channels[channel]!;
      const output = outputs[channel]!;
      for (let index = Math.max(0, -outStart); index < frame; index += 1) {
        output[outStart + index]! += window[index]! * at(input, start + index);
      }
    }
    natural = start + hop;
  }
  return outputs.map((output) => output.subarray(0, outputLength).slice());
}

/** A periodic Hann window: at 50 % overlap its frames sum to exactly 1. */
function hann(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let index = 0; index < length; index += 1) window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / length);
  return window;
}

function mono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const mix = new Float32Array(channels[0]!.length);
  for (const channel of channels) for (let index = 0; index < mix.length; index += 1) mix[index]! += channel[index]!;
  return mix;
}

/** The time stretcher a keep-pitch play uses. */
export type TimeStretchAlgorithm = 'wsola' | 'signalsmith';

/** Silence between samples stretched together, longer than a stretcher's frames. */
const BATCH_GAP_SECONDS = 0.5;

/**
 * `buffers` played `rate` times as fast at their own pitch, as new buffers of `context`. `wsola` stretches each one with
 * {@link timeStretchChannels}; `signalsmith` stretches them together with Signalsmith Stretch (laid end to end, see
 * `layoutStretchBatch`), falling back to WSOLA where it cannot run.
 */
export async function stretchAudioBuffers(
  context: BaseAudioContext,
  buffers: readonly AudioBuffer[],
  rate: number,
  algorithm: TimeStretchAlgorithm,
): Promise<AudioBuffer[]> {
  const samples = buffers.map((buffer) =>
    Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index)),
  );
  const sampleRate = buffers[0]?.sampleRate ?? context.sampleRate;
  let stretched: Float32Array<ArrayBuffer>[][] | undefined;
  if (algorithm === 'signalsmith' && buffers.length > 0) {
    try {
      const layout = layoutStretchBatch(
        samples.map((channels) => channels[0]!.length),
        Math.round(BATCH_GAP_SECONDS * sampleRate),
      );
      const channelCount = Math.min(2, Math.max(...samples.map((channels) => channels.length)));
      const batch = packStretchBatch(samples, layout, channelCount);
      const { signalsmithStretchChannels } = await import('./time-stretch-signalsmith.ts');
      stretched = unpackStretchBatch(await signalsmithStretchChannels(batch, sampleRate, rate), layout, samples, rate);
    } catch (error) {
      log.warn('Signalsmith Stretch unavailable; stretching with WSOLA', error);
    }
  }
  stretched ??= samples.map((channels) => timeStretchChannels(channels, sampleRate, rate));
  return stretched.map((channels) => {
    const buffer = context.createBuffer(channels.length, channels[0]!.length, sampleRate);
    channels.forEach((channel, index) => buffer.copyToChannel(channel, index));
    return buffer;
  });
}
