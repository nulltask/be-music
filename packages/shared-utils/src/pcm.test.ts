import { describe, expect, test } from 'vite-plus/test';
import { floatToInt16, writeStereoPcm16BE, writeStereoPcm16LE } from './index.ts';

function expectBufferUnchanged(buffer: Buffer, fill = 0x7f): void {
  expect(buffer.equals(Buffer.alloc(buffer.length, fill))).toBe(true);
}

describe('pcm utilities', () => {
  test('writeStereoPcm16LE: writes interleaved little-endian samples', () => {
    const buffer = Buffer.allocUnsafe(8);
    writeStereoPcm16LE(buffer, 0, new Float32Array([1, -1]), new Float32Array([-0.5, 0.5]));

    expect(buffer.readInt16LE(0)).toBe(floatToInt16(1));
    expect(buffer.readInt16LE(2)).toBe(floatToInt16(-0.5));
    expect(buffer.readInt16LE(4)).toBe(floatToInt16(-1));
    expect(buffer.readInt16LE(6)).toBe(floatToInt16(0.5));
  });

  test('writeStereoPcm16BE: writes interleaved big-endian samples', () => {
    const buffer = Buffer.allocUnsafe(8);
    writeStereoPcm16BE(buffer, 0, new Float32Array([1, -1]), new Float32Array([-0.5, 0.5]));

    expect(buffer.readInt16BE(0)).toBe(floatToInt16(1));
    expect(buffer.readInt16BE(2)).toBe(floatToInt16(-0.5));
    expect(buffer.readInt16BE(4)).toBe(floatToInt16(-1));
    expect(buffer.readInt16BE(6)).toBe(floatToInt16(0.5));
  });

  test('writeStereoPcm16LE: uses the fallback writer for odd byte offsets', () => {
    const buffer = Buffer.alloc(6);
    writeStereoPcm16LE(buffer, 1, new Float32Array([0.5]), new Float32Array([-0.5]));

    expect(buffer.readInt16LE(1)).toBe(floatToInt16(0.5));
    expect(buffer.readInt16LE(3)).toBe(floatToInt16(-0.5));
  });

  test('writeStereoPcm16BE: uses the fallback writer for odd byte offsets', () => {
    const buffer = Buffer.alloc(6);
    writeStereoPcm16BE(buffer, 1, new Float32Array([0.5]), new Float32Array([-0.5]));

    expect(buffer.readInt16BE(1)).toBe(floatToInt16(0.5));
    expect(buffer.readInt16BE(3)).toBe(floatToInt16(-0.5));
  });

  test('writeStereoPcm16LE: clamps source ranges and destination capacity', () => {
    const buffer = Buffer.alloc(4);
    writeStereoPcm16LE(
      buffer,
      0,
      new Float32Array([0.25, 0.5]),
      new Float32Array([-0.25, -0.5]),
      -3,
      Number.POSITIVE_INFINITY,
    );

    expect(buffer.readInt16LE(0)).toBe(floatToInt16(0.25));
    expect(buffer.readInt16LE(2)).toBe(floatToInt16(-0.25));
  });

  test('writeStereoPCM16 helpers: skip writes when no frames can be written', () => {
    const left = new Float32Array([0.5]);
    const right = new Float32Array([-0.5]);

    const beyondSource = Buffer.alloc(8, 0x7f);
    writeStereoPcm16LE(beyondSource, 0, left, right, 2);
    expectBufferUnchanged(beyondSource);

    const zeroFrameCount = Buffer.alloc(8, 0x7f);
    writeStereoPcm16LE(zeroFrameCount, 0, left, right, 0, 0);
    expectBufferUnchanged(zeroFrameCount);

    const noDestination = Buffer.alloc(4, 0x7f);
    writeStereoPcm16BE(noDestination, noDestination.length, left, right);
    expectBufferUnchanged(noDestination);
  });
});
