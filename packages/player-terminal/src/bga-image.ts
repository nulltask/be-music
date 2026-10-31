import { extname } from 'node:path';
import { decode as decodeBmpFast } from 'fast-bmp';
import { decodePNGToRGBA8 } from '@be-music/shared-utils/png';
import jpeg from 'jpeg-js';

export type ImageFormat = 'bmp' | 'png' | 'jpeg' | 'video';

export interface DecodedImage {
  width: number;
  height: number;
  data: Uint8Array;
  format: ImageFormat;
  /** Whether the encoded image carries alpha, independently of inserted opaque RGBA bytes. */
  hasAlphaChannel?: boolean;
}

export function decodeImageBuffer(buffer: Buffer, pathHint: string): DecodedImage {
  if (isPNGBuffer(buffer)) {
    return decodePNG(buffer);
  }
  if (isJPEGBuffer(buffer)) {
    return decodeJPEG(buffer);
  }
  if (isBMPBuffer(buffer)) {
    return decodeBMP(buffer);
  }

  const extension = extname(pathHint).toLowerCase();
  if (extension === '.png') {
    return decodePNG(buffer);
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return decodeJPEG(buffer);
  }
  if (extension === '.bmp') {
    return decodeBMP(buffer);
  }

  try {
    return decodePNG(buffer);
  } catch {
    try {
      return decodeJPEG(buffer);
    } catch {
      return decodeBMP(buffer);
    }
  }
}

function decodePNG(buffer: Buffer): DecodedImage {
  return { ...decodePNGToRGBA8(buffer), format: 'png' };
}

function decodeJPEG(buffer: Buffer): DecodedImage {
  const decoded = jpeg.decode(buffer, {
    useTArray: true,
    formatAsRGBA: true,
  });
  return {
    width: decoded.width,
    height: decoded.height,
    data: decoded.data,
    format: 'jpeg',
    hasAlphaChannel: false,
  };
}

function decodeBMP(buffer: Buffer): DecodedImage {
  const bitsPerPixel = readBMPBitsPerPixel(buffer);
  if (bitsPerPixel <= 8) {
    return decodeIndexedBMP(buffer, bitsPerPixel);
  }

  const decoded = decodeBmpFast(buffer);
  const channels = decoded.channels > 0 ? decoded.channels : 4;
  const depth = Math.max(1, Math.floor(decoded.bitsPerPixel / channels));
  const rgba = convertToRGBA8(toSampleArray(decoded.data), decoded.width, decoded.height, channels, depth);
  const declaresAlpha =
    bitsPerPixel === 32 && buffer.readUInt32LE(14) >= 56 && buffer.length >= 70 && buffer.readUInt32LE(66) !== 0;
  return {
    width: decoded.width,
    height: decoded.height,
    data: rgba,
    format: 'bmp',
    // Tools often write an alpha mask with every alpha byte zero; such a file is opaque, as browsers decode it.
    hasAlphaChannel: declaresAlpha && hasNonZeroAlpha(rgba),
  };
}

function hasNonZeroAlpha(rgba: Uint8Array): boolean {
  for (let offset = 3; offset < rgba.length; offset += 4) {
    if (rgba[offset] !== 0) return true;
  }
  return false;
}

function readBMPBitsPerPixel(buffer: Buffer): number {
  if (buffer.length < 30) {
    throw new Error('invalid bmp header');
  }
  const dibHeaderSize = buffer.readUInt32LE(14);
  if (dibHeaderSize === 12) {
    if (buffer.length < 26) {
      throw new Error('invalid bmp core header');
    }
    return buffer.readUInt16LE(24);
  }
  return buffer.readUInt16LE(28);
}

function decodeIndexedBMP(buffer: Buffer, bitsPerPixel: number): DecodedImage {
  if (bitsPerPixel !== 1 && bitsPerPixel !== 4 && bitsPerPixel !== 8) {
    throw new Error(`unsupported indexed bmp bit depth: ${bitsPerPixel}`);
  }

  const pixelDataOffset = buffer.readUInt32LE(10);
  const dibHeaderSize = buffer.readUInt32LE(14);
  const width = dibHeaderSize === 12 ? buffer.readUInt16LE(18) : buffer.readInt32LE(18);
  const rawHeight = dibHeaderSize === 12 ? buffer.readUInt16LE(20) : buffer.readInt32LE(22);
  const height = Math.abs(rawHeight);
  const topDown = dibHeaderSize === 12 ? false : rawHeight < 0;
  if (width <= 0 || height <= 0) {
    throw new Error('invalid bmp dimensions');
  }

  const colorsUsed = dibHeaderSize >= 40 ? buffer.readUInt32LE(46) : 0;
  const paletteEntryCount = colorsUsed > 0 ? colorsUsed : 1 << bitsPerPixel;
  const paletteOffset = 14 + dibHeaderSize;
  const paletteEntrySize = dibHeaderSize === 12 ? 3 : 4;
  const palette: Array<[r: number, g: number, b: number, a: number]> = [];
  for (let index = 0; index < paletteEntryCount; index += 1) {
    const offset = paletteOffset + index * paletteEntrySize;
    if (offset + paletteEntrySize - 1 >= buffer.length) {
      break;
    }
    const b = buffer[offset] ?? 0;
    const g = buffer[offset + 1] ?? 0;
    const r = buffer[offset + 2] ?? 0;
    const a = paletteEntrySize >= 4 ? (buffer[offset + 3] ?? 255) : 255;
    palette.push([r, g, b, a]);
  }
  if (palette.length === 0) {
    throw new Error('bmp palette not found');
  }

  const rowStride = Math.floor((bitsPerPixel * width + 31) / 32) * 4;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = topDown ? y : height - 1 - y;
    const rowOffset = pixelDataOffset + sourceY * rowStride;
    for (let x = 0; x < width; x += 1) {
      const paletteIndex = readIndexedBMPPaletteIndex(buffer, rowOffset, x, bitsPerPixel);
      const color = palette[paletteIndex] ?? [0, 0, 0, 255];
      const targetOffset = (y * width + x) * 4;
      rgba[targetOffset] = color[0];
      rgba[targetOffset + 1] = color[1];
      rgba[targetOffset + 2] = color[2];
      rgba[targetOffset + 3] = color[3];
    }
  }

  return {
    width,
    height,
    data: rgba,
    format: 'bmp',
    hasAlphaChannel: false,
  };
}

function readIndexedBMPPaletteIndex(buffer: Buffer, rowOffset: number, x: number, bitsPerPixel: number): number {
  if (bitsPerPixel === 8) {
    return buffer[rowOffset + x] ?? 0;
  }

  const byteOffset = rowOffset + Math.floor((x * bitsPerPixel) / 8);
  const byte = buffer[byteOffset] ?? 0;
  if (bitsPerPixel === 4) {
    return x % 2 === 0 ? (byte >> 4) & 0x0f : byte & 0x0f;
  }

  // bitsPerPixel === 1
  const bit = 7 - (x % 8);
  return (byte >> bit) & 0x01;
}

function toSampleArray(data: unknown): ArrayLike<number> {
  if (ArrayBuffer.isView(data)) {
    if ('length' in data) {
      return data as unknown as ArrayLike<number>;
    }
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof data === 'object' && data && 'byteLength' in data) {
    return new Uint8Array(data as ArrayBufferLike);
  }
  if (typeof data === 'object' && data && 'length' in data) {
    return data as ArrayLike<number>;
  }
  return new Uint8Array(0);
}

function convertToRGBA8(
  data: ArrayLike<number>,
  width: number,
  height: number,
  channels: number,
  depth: number,
): Uint8Array {
  const safeWidth = Math.max(0, Math.floor(width));
  const safeHeight = Math.max(0, Math.floor(height));
  const safeChannels = Math.max(1, Math.floor(channels));
  const safeDepth = Math.max(1, Math.floor(depth));
  const sampleMax = Math.max(1, safeDepth >= 16 ? 65535 : 2 ** safeDepth - 1);
  const pixelCount = safeWidth * safeHeight;
  const rgba = new Uint8Array(pixelCount * 4);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const sourceOffset = pixelIndex * safeChannels;
    const targetOffset = pixelIndex * 4;

    if (safeChannels === 1) {
      const gray = toByte(data[sourceOffset] ?? 0, sampleMax);
      rgba[targetOffset] = gray;
      rgba[targetOffset + 1] = gray;
      rgba[targetOffset + 2] = gray;
      rgba[targetOffset + 3] = 255;
      continue;
    }

    if (safeChannels === 2) {
      const gray = toByte(data[sourceOffset] ?? 0, sampleMax);
      rgba[targetOffset] = gray;
      rgba[targetOffset + 1] = gray;
      rgba[targetOffset + 2] = gray;
      rgba[targetOffset + 3] = toByte(data[sourceOffset + 1] ?? sampleMax, sampleMax);
      continue;
    }

    rgba[targetOffset] = toByte(data[sourceOffset] ?? 0, sampleMax);
    rgba[targetOffset + 1] = toByte(data[sourceOffset + 1] ?? 0, sampleMax);
    rgba[targetOffset + 2] = toByte(data[sourceOffset + 2] ?? 0, sampleMax);
    rgba[targetOffset + 3] = safeChannels >= 4 ? toByte(data[sourceOffset + 3] ?? sampleMax, sampleMax) : 255;
  }
  return rgba;
}

function toByte(sample: number, sampleMax: number): number {
  const normalized = Number.isFinite(sample) ? Math.max(0, Math.min(sampleMax, sample)) : 0;
  if (sampleMax === 255) {
    return normalized;
  }
  return Math.round((normalized * 255) / sampleMax);
}

function isPNGBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

function isJPEGBuffer(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8;
}

function isBMPBuffer(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d;
}
