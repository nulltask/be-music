import { describe, expect, test } from 'vitest';
import { decodeAudioSample } from './decode.ts';
import { encodeWav16 } from './file-codec.ts';

describe('decodeAudioSample', () => {
  test('accepts Uint8Array WAV bytes without requiring Node Buffer helpers', async () => {
    const encoded = encodeWav16({
      sampleRate: 8000,
      left: new Float32Array([1, -1]),
      right: new Float32Array([-0.5, 0.5]),
    });

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
