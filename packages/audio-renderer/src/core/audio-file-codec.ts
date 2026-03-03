import { extname } from 'node:path';
import { clampSignedUnit } from '@be-music/utils';

export type AudioFileFormat = 'wav' | 'aiff';

export interface StereoRenderResult {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
}

export function detectAudioFormat(path: string): AudioFileFormat {
  const extension = extname(path).toLowerCase();
  if (extension === '.aiff' || extension === '.aif') {
    return 'aiff';
  }
  return 'wav';
}

export function encodeWav16(result: StereoRenderResult): Buffer {
  const frameCount = Math.min(result.left.length, result.right.length);
  const dataSize = frameCount * 4;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 4, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 4, 'ascii');
  buffer.write('fmt ', 12, 4, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(result.sampleRate, 24);
  buffer.writeUInt32LE(result.sampleRate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 4, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  let pointer = 44;
  for (let index = 0; index < frameCount; index += 1) {
    buffer.writeInt16LE(floatToInt16(result.left[index]), pointer);
    buffer.writeInt16LE(floatToInt16(result.right[index]), pointer + 2);
    pointer += 4;
  }

  return buffer;
}

export function encodeAiff16(result: StereoRenderResult): Buffer {
  const frameCount = Math.min(result.left.length, result.right.length);
  const dataSize = frameCount * 4;
  const ssndSize = 8 + dataSize;
  const formSize = 4 + (8 + 18) + (8 + ssndSize);

  const buffer = Buffer.alloc(8 + formSize);
  let pointer = 0;

  buffer.write('FORM', pointer, 4, 'ascii');
  pointer += 4;
  buffer.writeUInt32BE(formSize, pointer);
  pointer += 4;
  buffer.write('AIFF', pointer, 4, 'ascii');
  pointer += 4;

  buffer.write('COMM', pointer, 4, 'ascii');
  pointer += 4;
  buffer.writeUInt32BE(18, pointer);
  pointer += 4;
  buffer.writeUInt16BE(2, pointer);
  pointer += 2;
  buffer.writeUInt32BE(frameCount, pointer);
  pointer += 4;
  buffer.writeUInt16BE(16, pointer);
  pointer += 2;
  writeExtended80(buffer, pointer, result.sampleRate);
  pointer += 10;

  buffer.write('SSND', pointer, 4, 'ascii');
  pointer += 4;
  buffer.writeUInt32BE(ssndSize, pointer);
  pointer += 4;
  buffer.writeUInt32BE(0, pointer);
  pointer += 4;
  buffer.writeUInt32BE(0, pointer);
  pointer += 4;

  for (let index = 0; index < frameCount; index += 1) {
    buffer.writeInt16BE(floatToInt16(result.left[index]), pointer);
    buffer.writeInt16BE(floatToInt16(result.right[index]), pointer + 2);
    pointer += 4;
  }

  return buffer;
}

function writeExtended80(buffer: Buffer, offset: number, value: number): void {
  if (value <= 0) {
    buffer.fill(0, offset, offset + 10);
    return;
  }

  let exponent = 16383;
  let normalized = value;

  while (normalized >= 1) {
    normalized /= 2;
    exponent += 1;
  }

  while (normalized < 0.5) {
    normalized *= 2;
    exponent -= 1;
  }

  normalized *= 2;
  exponent -= 1;

  const mantissa = normalized * 2 ** 63;
  const hi = Math.floor(mantissa / 2 ** 32);
  const lo = Math.floor(mantissa - hi * 2 ** 32);

  buffer.writeUInt16BE(exponent & 0x7fff, offset);
  buffer.writeUInt32BE(hi >>> 0, offset + 2);
  buffer.writeUInt32BE(lo >>> 0, offset + 6);
}

function floatToInt16(sample: number): number {
  const clamped = clampSignedUnit(sample);
  if (clamped >= 0) {
    return Math.round(clamped * 32767);
  }
  return Math.round(clamped * 32768);
}
