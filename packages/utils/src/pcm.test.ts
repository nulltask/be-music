import { expect, test } from 'vitest';
import { floatToInt16, writeStereoPcm16Be, writeStereoPcm16Le } from './index.ts';

test('writeStereoPcm16Le: writes interleaved little-endian samples', () => {
  const buffer = Buffer.allocUnsafe(8);
  writeStereoPcm16Le(buffer, 0, new Float32Array([1, -1]), new Float32Array([-0.5, 0.5]));

  expect(buffer.readInt16LE(0)).toBe(floatToInt16(1));
  expect(buffer.readInt16LE(2)).toBe(floatToInt16(-0.5));
  expect(buffer.readInt16LE(4)).toBe(floatToInt16(-1));
  expect(buffer.readInt16LE(6)).toBe(floatToInt16(0.5));
});

test('writeStereoPcm16Be: writes interleaved big-endian samples', () => {
  const buffer = Buffer.allocUnsafe(8);
  writeStereoPcm16Be(buffer, 0, new Float32Array([1, -1]), new Float32Array([-0.5, 0.5]));

  expect(buffer.readInt16BE(0)).toBe(floatToInt16(1));
  expect(buffer.readInt16BE(2)).toBe(floatToInt16(-0.5));
  expect(buffer.readInt16BE(4)).toBe(floatToInt16(-1));
  expect(buffer.readInt16BE(6)).toBe(floatToInt16(0.5));
});
