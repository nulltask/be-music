import { expect, test } from 'vite-plus/test';
import { prepareWAVPlaybackBuffer, readNativeAudioSampleRate } from './wav-playback.ts';

function buffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  return {
    sampleRate,
    numberOfChannels: channels.length,
    length: channels[0]!.length,
    duration: channels[0]!.length / sampleRate,
    getChannelData: (index: number) => channels[index]!,
  } as AudioBuffer;
}
const context = {
  createBuffer: (channels: number, length: number, rate: number) =>
    buffer(
      Array.from({ length: channels }, () => new Float32Array(length)),
      rate,
    ),
};

test('prepares separate slot buffers with native-rate frequency, pitch, stereo balance and duration', () => {
  const raw = buffer([new Float32Array(48000).fill(1), new Float32Array(48000).fill(0.5)], 48000);
  const changed = prepareWAVPlaybackBuffer(
    context,
    raw,
    { frequencyHz: 44100, semitones: 12, pan: 10000, durationSeconds: 0.2 },
    22050,
  );
  expect(changed.duration).toBe(0.2);
  expect(changed.getChannelData(0).every((value) => value === 0)).toBe(true);
  expect(changed.getChannelData(1).every((value) => value === 0.5)).toBe(true);
  const other = prepareWAVPlaybackBuffer(context, raw, { semitones: -12 });
  expect(other.duration).toBe(2);
  expect(raw.duration).toBe(1);
  expect(raw.getChannelData(0)[0]).toBe(1);
});

test('mono is duplicated before balance attenuation and natural end is never padded', () => {
  const raw = buffer([new Float32Array(441).fill(1)], 44100);
  const changed = prepareWAVPlaybackBuffer(context, raw, { pan: -10000, durationSeconds: 10 });
  expect(changed.duration).toBe(raw.duration);
  expect(changed.getChannelData(0)[0]).toBe(1);
  expect(changed.getChannelData(1)[0]).toBe(0);
});

test('metadata preserves a WAV source rate independently of the browser output rate', async () => {
  const bytes = new Uint8Array(44 + 400);
  const view = new DataView(bytes.buffer);
  for (const [offset, text] of [
    [0, 'RIFF'],
    [8, 'WAVE'],
    [12, 'fmt '],
    [36, 'data'],
  ] as const) {
    bytes.set(new TextEncoder().encode(text), offset);
  }
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, 22050, true);
  view.setUint32(28, 88200, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, 400, true);
  expect(await readNativeAudioSampleRate(bytes)).toBe(22050);
});

test('metadata failure is explicit rather than using a device-dependent rate', async () => {
  await expect(readNativeAudioSampleRate(Uint8Array.of(1, 2, 3))).rejects.toThrow();
});
