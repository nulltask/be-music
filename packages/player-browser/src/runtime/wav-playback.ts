import { resolveBmsWAVPlayback, type BmsWAVPlaybackModifiers } from '@be-music/chart-model';
import { transformStereoPCM } from '@be-music/shared-utils/core';

/** Apply authored sample effects before any keep-pitch tempo stretch; each slot owns its resulting buffer. */
export function prepareWAVPlaybackBuffer(
  context: Pick<BaseAudioContext, 'createBuffer'>,
  buffer: AudioBuffer,
  modifiers: BmsWAVPlaybackModifiers,
  nativeSampleRate = buffer.sampleRate,
): AudioBuffer {
  const options = resolveBmsWAVPlayback(modifiers, nativeSampleRate);
  if (
    options.playbackRate === 1 &&
    options.leftGain === 1 &&
    options.rightGain === 1 &&
    options.maxDurationSeconds === undefined
  )
    return buffer;
  const pcm = transformStereoPCM(
    buffer.getChannelData(0),
    buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0),
    buffer.sampleRate,
    buffer.sampleRate,
    options,
  );
  // Web Audio cannot allocate zero frames. A zero-frame decoded input is represented by one silent frame.
  const output = context.createBuffer(2, Math.max(1, pcm.left.length), buffer.sampleRate);
  output.getChannelData(0).set(pcm.left);
  output.getChannelData(1).set(pcm.right);
  return output;
}

/** DecodeAudioData resamples to the host rate, so EXWAV frequency must use the encoded track's rate instead. */
export async function readNativeAudioSampleRate(bytes: Uint8Array): Promise<number> {
  const { Input, BufferSource, ALL_FORMATS } = await import('mediabunny');
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    const rate = await track?.getSampleRate();
    if (rate === undefined || !Number.isFinite(rate) || rate <= 0)
      throw new Error('Cannot determine native audio sample rate for EXWAV frequency');
    return rate;
  } finally {
    input.dispose();
  }
}
