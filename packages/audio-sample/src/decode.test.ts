import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vite-plus/test';
import { decodeAudioSample, resampleLinear } from './decode.ts';

describe('decodeAudioSample', () => {
  test('accepts Uint8Array WAV bytes without requiring Node Buffer helpers', async () => {
    // Stereo PCM16 at 8 kHz, two frames.
    const encoded = new Uint8Array(
      Buffer.from(
        '524946462c00000057415645666d74201000000001000200401f0000007d0000040010006461746108000000ff7f00c000800040',
        'hex',
      ),
    );

    const decoded = await decodeAudioSample(encoded, 'fixture.wav');

    expect(decoded.sampleRate).toBe(8000);
    expect(decoded.left).toHaveLength(2);
    expect(decoded.right).toHaveLength(2);
    expect(decoded.left[0]).toBeCloseTo(32767 / 32768);
    expect(decoded.left[1]).toBe(-1);
    expect(decoded.right![0]).toBe(-0.5);
    expect(decoded.right![1]).toBe(0.5);
  });
});

function wave(encoding: number, bits: number, data: number[], padChunk = false): Uint8Array {
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(encoding);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(8000, 4);
  fmt.writeUInt32LE((8000 * bits) / 8, 8);
  fmt.writeUInt16LE(bits / 8, 12);
  fmt.writeUInt16LE(bits, 14);
  // An odd-length ancillary chunk is padded and the pad byte is excluded from its declared size.
  function chunk(name: string, bytes: Uint8Array): Buffer {
    const header = Buffer.alloc(8);
    header.write(name);
    header.writeUInt32LE(bytes.length, 4);
    return Buffer.concat([header, bytes, Buffer.alloc(bytes.length % 2)]);
  }
  const body = Buffer.concat([
    Buffer.from('WAVE'),
    chunk('fmt ', fmt),
    ...(padChunk ? [chunk('JUNK', Uint8Array.of(99))] : []),
    chunk('data', Uint8Array.from(data)),
  ]);
  return chunk('RIFF', body);
}

test('skips padded RIFF chunks and decodes unsigned PCM8 around its midpoint', async () => {
  const bytes = wave(1, 8, [0, 64, 128, 192, 255], true);
  const encoded = Uint8Array.of(222, ...bytes, 222).subarray(1, bytes.length + 1);
  const result = await decodeAudioSample(encoded, 'wrong-extension.ogg');
  expect(result.sampleRate).toBe(8000);
  expect(result.left).toEqual(Float32Array.of(-1, -0.5, 0, 0.5, 0.9921875));
  expect(result.right).toBeUndefined();
});

test.each([
  { encoding: 1, bits: 24, bytes: [0, 0, 0x80, 0, 0, 0x40], samples: [-1, 0.5] },
  { encoding: 1, bits: 32, bytes: [0, 0, 0, 0xc0, 0, 0, 0, 0x40], samples: [-0.5, 0.5] },
  { encoding: 3, bits: 32, bytes: [0, 0, 0xc0, 0xbf, 0, 0, 0x80, 0x3e, 0, 0, 0xc0, 0x3f], samples: [-1, 0.25, 1] },
])('decodes WAV format $encoding at $bits bits', async ({ encoding, bits, bytes, samples }) => {
  const result = await decodeAudioSample(wave(encoding, bits, bytes));
  expect([...result.left]).toEqual(samples);
});

test('reports a recognized unsupported encoding and an incomplete WAV without falling through to other decoders', async () => {
  await expect(decodeAudioSample(wave(6, 8, [128]))).rejects.toThrow('Unsupported WAV encoding format: 6');
  await expect(decodeAudioSample(wave(1, 8, []))).rejects.toThrow('Missing fmt/data chunks');
});

test.each([
  ['mp3', 44100],
  ['ogg', 44100],
  ['opus', 48000],
] as const)('sniffs %s and preserves both channels of the 0.3 s fixture tone', async (format, sampleRate) => {
  const bytes = await readFile(new URL(`../../../test/fixtures/render-codec-test.${format}`, import.meta.url));
  const audio = await decodeAudioSample(bytes, 'sample.wav');
  expect(audio.sampleRate).toBe(sampleRate);
  expect(audio.right?.length).toBe(audio.left.length);
  expect(audio.left.length / sampleRate).toBeGreaterThan(0.29);
  expect(audio.left.length / sampleRate).toBeLessThan(0.31);
  // Ignore codec priming at the edges. Both channels carry the recorded ~875 Hz tone at ~0.09 full scale.
  for (const channel of [audio.left, audio.right!]) {
    const middle = channel.slice(Math.round(sampleRate * 0.05), Math.round(sampleRate * 0.25));
    const rises = middle.filter((value, index) => index > 0 && middle[index - 1]! < 0 && value >= 0).length;
    expect(rises).toBeGreaterThanOrEqual(173);
    expect(rises).toBeLessThanOrEqual(177);
    expect(Math.max(...middle)).toBeCloseTo(0.09, 2);
  }
});

test('interpolates between samples and repeats the final frame at the end of a 2× upsample', () => {
  expect(resampleLinear(Float32Array.of(-1, 1, -0.5), 8000, 16000)).toEqual(
    Float32Array.of(-1, 0, 1, 0.25, -0.5, -0.5),
  );
});

test('propagates cancellation before opening the audio decoder', async () => {
  const reason = new DOMException('chart changed', 'AbortError');
  const signal = AbortSignal.abort(reason);
  await expect(decodeAudioSample(wave(1, 8, [64]), 'sample.wav', signal)).rejects.toMatchObject({ name: 'AbortError' });
});
