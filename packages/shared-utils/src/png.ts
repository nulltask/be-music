import { convertIndexedToRgb, decode as decodePngFast } from 'fast-png';
import { unzlibSync } from 'fflate';

/** Owned RGBA8 pixels with encoded alpha/tRNS distinguished from decoder-inserted opaque alpha. */
export interface DecodedPNGImage {
  width: number;
  height: number;
  data: Uint8Array;
  hasAlphaChannel: boolean;
}

/** Decode native PNG pixels before any Canvas premultiplication, including palettes, 16-bit and packed gray/tRNS. */
export function decodePNGToRGBA8(buffer: Uint8Array): DecodedPNGImage {
  if (buffer[28] === 1 && [1, 2, 4].includes(buffer[24]!) && [0, 3].includes(buffer[25]!))
    return decodeLowBitAdam7(buffer);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let decoderBuffer = buffer;
  let nativeTransparency: number[] | undefined;
  if (buffer[25] === 0 || buffer[25] === 2) {
    for (let offset = 8; offset + 12 <= buffer.length;) {
      const length = view.getUint32(offset);
      if (offset + 12 + length > buffer.length) break;
      if (
        String.fromCharCode(...buffer.subarray(offset + 4, offset + 8)) === 'tRNS' &&
        length === (buffer[25] === 0 ? 2 : 6)
      ) {
        nativeTransparency = [];
        for (let index = 0; index < length; index += 2) nativeTransparency.push(view.getUint16(offset + 8 + index));
        // fast-png checks tRNS sample count against pixel count, rejecting valid one/two-pixel RGB images.
        // Decode the color samples without that chunk and apply the original native key ourselves below.
        decoderBuffer = new Uint8Array(buffer.length - length - 12);
        decoderBuffer.set(buffer.subarray(0, offset));
        decoderBuffer.set(buffer.subarray(offset + length + 12), offset);
        break;
      }
      offset += length + 12;
    }
  }
  const decoded = decodePngFast(decoderBuffer);
  let samples = decoded.data;
  if (!decoded.palette && decoded.depth < 8) {
    // Low-bit grayscale rows are packed; compare original samples before converting them to RGBA8.
    const unpacked = new Uint8Array(decoded.width * decoded.height);
    const stride = Math.ceil((decoded.width * decoded.depth) / 8);
    for (let y = 0; y < decoded.height; y++)
      for (let x = 0; x < decoded.width; x++) {
        const bit = x * decoded.depth;
        unpacked[y * decoded.width + x] =
          (samples[y * stride + Math.floor(bit / 8)]! >>> (8 - decoded.depth - (bit % 8))) & (2 ** decoded.depth - 1);
      }
    samples = unpacked;
  }
  const rgba = decoded.palette
    ? convertToRGBA8(convertIndexedToRgb(decoded), decoded.width, decoded.height, decoded.palette[0]!.length, 8)
    : convertToRGBA8(samples, decoded.width, decoded.height, decoded.channels, decoded.depth);
  const transparency = nativeTransparency ?? decoded.transparency;
  if (!decoded.palette && transparency?.length) {
    // RGB/grayscale tRNS carries native sample values, not an extra decoded alpha channel.
    for (let pixel = 0; pixel < decoded.width * decoded.height; pixel++) {
      if (transparency.every((sample, channel) => samples[pixel * decoded.channels + channel] === sample))
        rgba[pixel * 4 + 3] = 0;
    }
  }
  return {
    width: decoded.width,
    height: decoded.height,
    data: rgba,
    hasAlphaChannel: pngHasAlphaChannel(buffer),
  };
}

function pngHasAlphaChannel(buffer: Uint8Array): boolean {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (buffer[25] === 4 || buffer[25] === 6) return true;
  // A palette decoder can expand opaque RGB into RGBA too. Only encoded alpha/tRNS counts as source alpha.
  for (let offset = 8; offset + 12 <= buffer.length;) {
    const length = view.getUint32(offset);
    if (offset + 12 + length > buffer.length) return false;
    if (String.fromCharCode(...buffer.subarray(offset + 4, offset + 8)) === 'tRNS') return true;
    offset += length + 12;
  }
  return false;
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

// PNG filters operate on packed bytes; each Adam7 pass starts its own row history.
function decodeLowBitAdam7(buffer: Uint8Array): DecodedPNGImage {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (
    buffer.length < 33 ||
    view.getUint32(0) !== 0x89504e47 ||
    view.getUint32(4) !== 0x0d0a1a0a ||
    view.getUint32(8) !== 13 ||
    view.getUint32(12) !== 0x49484452 ||
    buffer[26] !== 0 ||
    buffer[27] !== 0
  )
    throw new Error('Invalid PNG header');
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const depth = buffer[24]!;
  const indexed = buffer[25] === 3;
  if (!width || !height || !Number.isSafeInteger(width * height * 4)) throw new Error('Invalid PNG dimensions');
  let palette: Uint8Array | undefined;
  let transparency: Uint8Array | undefined;
  const chunks: Uint8Array[] = [];
  let compressedLength = 0;
  let ended = false;
  for (let offset = 33; offset + 12 <= buffer.length;) {
    const length = view.getUint32(offset);
    if (offset + length + 12 > buffer.length) throw new Error('Truncated PNG chunk');
    const type = view.getUint32(offset + 4);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 0x504c5445) palette = data;
    if (type === 0x74524e53) transparency = data;
    if (type === 0x49444154) {
      chunks.push(data);
      compressedLength += length;
    }
    if (type === 0x49454e44) {
      ended = true;
      break;
    }
    offset += length + 12;
  }
  if (!ended || !chunks.length || (indexed && (!palette?.length || palette.length % 3)))
    throw new Error('Incomplete PNG image');
  const compressed = new Uint8Array(compressedLength);
  let cursor = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, cursor);
    cursor += chunk.length;
  }
  const passes = [
    [0, 0, 8, 8],
    [4, 0, 8, 8],
    [0, 4, 4, 8],
    [2, 0, 4, 4],
    [0, 2, 2, 4],
    [1, 0, 2, 2],
    [0, 1, 1, 2],
  ] as const;
  let expectedLength = 0;
  for (const [x, y, dx, dy] of passes) {
    const columns = Math.max(0, Math.ceil((width - x) / dx));
    const rows = Math.max(0, Math.ceil((height - y) / dy));
    if (columns && rows) expectedLength += rows * (1 + Math.ceil((columns * depth) / 8));
  }
  const packed = unzlibSync(compressed);
  if (packed.length !== expectedLength) throw new Error('Invalid PNG scanline length');
  const data = new Uint8Array(width * height * 4);
  const mask = (1 << depth) - 1;
  const transparentGray = transparency?.length === 2 ? transparency[0]! * 256 + transparency[1]! : -1;
  cursor = 0;
  for (const [startX, startY, dx, dy] of passes) {
    const columns = Math.max(0, Math.ceil((width - startX) / dx));
    const rows = Math.max(0, Math.ceil((height - startY) / dy));
    if (!columns || !rows) continue;
    const stride = Math.ceil((columns * depth) / 8);
    let previous = new Uint8Array(stride);
    for (let y = 0; y < rows; y++) {
      const filter = packed[cursor++]!;
      if (filter > 4) throw new Error('Invalid PNG filter');
      const row = packed.slice(cursor, cursor + stride);
      cursor += stride;
      for (let byte = 0; byte < stride; byte++) {
        const left = byte ? row[byte - 1]! : 0;
        const up = previous[byte]!;
        const corner = byte ? previous[byte - 1]! : 0;
        let predictor = 0;
        if (filter === 1) predictor = left;
        if (filter === 2) predictor = up;
        if (filter === 3) predictor = Math.floor((left + up) / 2);
        if (filter === 4) {
          const p = left + up - corner;
          const a = Math.abs(p - left),
            b = Math.abs(p - up),
            c = Math.abs(p - corner);
          predictor = a <= b && a <= c ? left : b <= c ? up : corner;
        }
        row[byte] = (row[byte]! + predictor) & 255;
      }
      for (let x = 0; x < columns; x++) {
        const bit = x * depth;
        const sample = (row[Math.floor(bit / 8)]! >>> (8 - depth - (bit % 8))) & mask;
        const target = ((startY + y * dy) * width + startX + x * dx) * 4;
        if (indexed) {
          if (sample * 3 + 2 >= palette!.length) throw new Error('Invalid PNG palette index');
          data.set(palette!.subarray(sample * 3, sample * 3 + 3), target);
          data[target + 3] = transparency?.[sample] ?? 255;
        } else {
          const gray = Math.round((sample * 255) / mask);
          data.set([gray, gray, gray, sample === transparentGray ? 0 : 255], target);
        }
      }
      previous = row;
    }
  }
  return { width, height, data, hasAlphaChannel: transparency !== undefined };
}
