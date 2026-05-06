import { extname, floatToInt16 } from '@be-music/utils/core';

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

export function encodeWav16(result: StereoRenderResult): Uint8Array {
  const frameCount = Math.min(result.left.length, result.right.length);
  const dataSize = frameCount * 4;
  const buffer = new Uint8Array(44 + dataSize);
  const view = createDataView(buffer);

  writeAscii(buffer, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(buffer, 8, 'WAVE');
  writeAscii(buffer, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, result.sampleRate, true);
  view.setUint32(28, result.sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeAscii(buffer, 36, 'data');
  view.setUint32(40, dataSize, true);

  writeStereoPcm16(view, 44, result.left, result.right, frameCount, true);

  return buffer;
}

export function encodeAiff16(result: StereoRenderResult): Uint8Array {
  const frameCount = Math.min(result.left.length, result.right.length);
  const dataSize = frameCount * 4;
  const ssndSize = 8 + dataSize;
  const formSize = 4 + (8 + 18) + (8 + ssndSize);

  const buffer = new Uint8Array(8 + formSize);
  const view = createDataView(buffer);
  let pointer = 0;

  writeAscii(buffer, pointer, 'FORM');
  pointer += 4;
  view.setUint32(pointer, formSize, false);
  pointer += 4;
  writeAscii(buffer, pointer, 'AIFF');
  pointer += 4;

  writeAscii(buffer, pointer, 'COMM');
  pointer += 4;
  view.setUint32(pointer, 18, false);
  pointer += 4;
  view.setUint16(pointer, 2, false);
  pointer += 2;
  view.setUint32(pointer, frameCount, false);
  pointer += 4;
  view.setUint16(pointer, 16, false);
  pointer += 2;
  writeExtended80(view, pointer, result.sampleRate);
  pointer += 10;

  writeAscii(buffer, pointer, 'SSND');
  pointer += 4;
  view.setUint32(pointer, ssndSize, false);
  pointer += 4;
  view.setUint32(pointer, 0, false);
  pointer += 4;
  view.setUint32(pointer, 0, false);
  pointer += 4;

  writeStereoPcm16(view, pointer, result.left, result.right, frameCount, false);

  return buffer;
}

function createDataView(buffer: Uint8Array): DataView {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function writeAscii(buffer: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    buffer[offset + index] = value.charCodeAt(index) & 0xff;
  }
}

function writeStereoPcm16(
  view: DataView,
  byteOffset: number,
  left: ArrayLike<number>,
  right: ArrayLike<number>,
  frameCount: number,
  littleEndian: boolean,
): void {
  let pointer = byteOffset;
  for (let frame = 0; frame < frameCount; frame += 1) {
    view.setInt16(pointer, floatToInt16(left[frame]!), littleEndian);
    view.setInt16(pointer + 2, floatToInt16(right[frame]!), littleEndian);
    pointer += 4;
  }
}

function writeExtended80(view: DataView, offset: number, value: number): void {
  if (value <= 0) {
    for (let index = 0; index < 10; index += 1) {
      view.setUint8(offset + index, 0);
    }
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

  view.setUint16(offset, exponent & 0x7fff, false);
  view.setUint32(offset + 2, hi >>> 0, false);
  view.setUint32(offset + 6, lo >>> 0, false);
}
