import { describe, expect, test } from 'vite-plus/test';
import { decodeAudioSample } from './decode.ts';

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
