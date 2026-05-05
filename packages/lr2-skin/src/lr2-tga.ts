/**
 * Minimal TrueVision TGA decoder for LR2 font sprite sheets.
 *
 * LR2 fonts use TGA images at 24-bit RGB or 32-bit BGRA, type 2 (uncompressed) or type 10 (RLE). Other variants —
 * color-mapped, grayscale, 16-bit BGR(A)5551 — aren't seen in shipped LR2 themes so they're not supported here.
 *
 * Output is `ImageData` so the caller can hand it directly to `createImageBitmap` for Pixi texture upload, or paint it
 * onto an offscreen canvas.
 */

interface TgaHeader {
  idLength: number;
  colorMapType: number;
  imageType: number;
  width: number;
  height: number;
  pixelDepth: number;
  imageDescriptor: number;
}

function readHeader(bytes: Uint8Array): TgaHeader | undefined {
  if (bytes.length < 18) return undefined;
  return {
    idLength: bytes[0]!,
    colorMapType: bytes[1]!,
    imageType: bytes[2]!,
        // bytes 3-7 = ColorMap spec (skipped — we don't support indexed) bytes 8-9 = X origin (LR2 uses 0) bytes 10-11 = Y
    // origin
    width: bytes[12]! | (bytes[13]! << 8),
    height: bytes[14]! | (bytes[15]! << 8),
    pixelDepth: bytes[16]!,
    imageDescriptor: bytes[17]!,
  };
}

/**
 * Returns whether the supplied bytes look like a TGA we can decode. Detects the (somewhat ambiguous) TGA-V2 footer
 * "TRUEVISION-XFILE.\0" or otherwise sanity-checks the header.
 */
export function isTgaImage(bytes: Uint8Array): boolean {
  if (bytes.length >= 26) {
    const tail = bytes.subarray(bytes.length - 18);
    if (
      tail[0] === 0x54 && // T
      tail[1] === 0x52 && // R
      tail[2] === 0x55 && // U
      tail[3] === 0x45 // E
    ) {
      // "TRUEVISION-XFILE.\0" footer present — definitely TGA-V2.
      return true;
    }
  }
  const header = readHeader(bytes);
  if (!header) return false;
  if (header.imageType === 0) return false; // No data
  // Common types we accept
  if ([2, 3, 10, 11].includes(header.imageType)) {
    if ([8, 16, 24, 32].includes(header.pixelDepth)) return true;
  }
  return false;
}

/**
 * Decodes TGA bytes into an `ImageData`-shaped object (raw RGBA pixel buffer + width / height). Returns `undefined` on
 * unsupported / malformed input.
 *
 * Note: the returned `data` is a plain `Uint8ClampedArray`, not a DOM `ImageData` instance — the caller wraps it via
 * `new ImageData(data, width, height)` or passes it to `ctx.putImageData` after constructing a fresh one. This keeps
 * the decoder usable in Node tests where `ImageData` isn't a global.
 */
export function decodeTga(bytes: Uint8Array): { width: number; height: number; data: Uint8ClampedArray } | undefined {
  const header = readHeader(bytes);
  if (!header) return undefined;
  if (header.colorMapType !== 0) return undefined; // No paletted support
  if (header.width <= 0 || header.height <= 0) return undefined;
  // Image data starts after the 18-byte header + ID field + color map (skipped — we rejected colorMapType != 0).
  const pixelDataStart = 18 + header.idLength;
  if (pixelDataStart > bytes.length) return undefined;

  const bytesPerPixel = header.pixelDepth >>> 3;
  if (![1, 2, 3, 4].includes(bytesPerPixel)) return undefined;
  const totalPixels = header.width * header.height;

    // Image type values: 2 = uncompressed TrueColor RGB / RGBA 3 = uncompressed grayscale 10 = RLE TrueColor RGB / RGBA
  // 11 = RLE grayscale
  const isRle = header.imageType === 10 || header.imageType === 11;
  const isGrayscale = header.imageType === 3 || header.imageType === 11;
  if (!isRle && header.imageType !== 2 && header.imageType !== 3) {
    return undefined;
  }

  const pixels = new Uint8ClampedArray(totalPixels * 4);
  if (isRle) {
    if (!decodeRle(bytes.subarray(pixelDataStart), bytesPerPixel, pixels, totalPixels, isGrayscale)) {
      return undefined;
    }
  } else {
    decodeUncompressed(bytes.subarray(pixelDataStart), bytesPerPixel, pixels, totalPixels, isGrayscale);
  }

    // TGA origin: bit 5 of imageDescriptor (`0x20`) flags top-left origin. When clear, the image is stored bottom-up and
  // we flip rows so the resulting canvas-friendly buffer is top-down.
  const topDown = (header.imageDescriptor & 0x20) !== 0;
  if (!topDown) {
    flipRows(pixels, header.width, header.height);
  }
  return { width: header.width, height: header.height, data: pixels };
}

function decodeUncompressed(
  src: Uint8Array,
  bytesPerPixel: number,
  dest: Uint8ClampedArray,
  totalPixels: number,
  isGrayscale: boolean,
): void {
  for (let i = 0; i < totalPixels; i += 1) {
    writePixel(src, i * bytesPerPixel, bytesPerPixel, dest, i * 4, isGrayscale);
  }
}

/**
 * Decodes TGA RLE packets. Each packet starts with a header byte:
 *
 * - `bit 7 = 1` (`0x80..0xFF`) — Run-length packet: repeat the following pixel `(header & 0x7F) + 1` times.
 * - `bit 7 = 0` (`0x00..0x7F`) — Raw packet: `(header & 0x7F) + 1` pixels stored verbatim.
 *
 * Returns `false` on truncation.
 */
function decodeRle(
  src: Uint8Array,
  bytesPerPixel: number,
  dest: Uint8ClampedArray,
  totalPixels: number,
  isGrayscale: boolean,
): boolean {
  let srcIdx = 0;
  let pixelIdx = 0;
  while (pixelIdx < totalPixels) {
    if (srcIdx >= src.length) return false;
    const headerByte = src[srcIdx]!;
    srcIdx += 1;
    const isRun = (headerByte & 0x80) !== 0;
    const count = (headerByte & 0x7f) + 1;
    if (isRun) {
      if (srcIdx + bytesPerPixel > src.length) return false;
      // Read once, replicate.
      const tmp = new Uint8ClampedArray(4);
      writePixel(src, srcIdx, bytesPerPixel, tmp, 0, isGrayscale);
      srcIdx += bytesPerPixel;
      for (let i = 0; i < count && pixelIdx + i < totalPixels; i += 1) {
        const destIdx = (pixelIdx + i) * 4;
        dest[destIdx] = tmp[0]!;
        dest[destIdx + 1] = tmp[1]!;
        dest[destIdx + 2] = tmp[2]!;
        dest[destIdx + 3] = tmp[3]!;
      }
      pixelIdx += count;
    } else {
      if (srcIdx + count * bytesPerPixel > src.length) return false;
      for (let i = 0; i < count && pixelIdx + i < totalPixels; i += 1) {
        writePixel(src, srcIdx + i * bytesPerPixel, bytesPerPixel, dest, (pixelIdx + i) * 4, isGrayscale);
      }
      srcIdx += count * bytesPerPixel;
      pixelIdx += count;
    }
  }
  return true;
}

function writePixel(
  src: Uint8Array,
  srcIdx: number,
  bytesPerPixel: number,
  dest: Uint8ClampedArray,
  destIdx: number,
  isGrayscale: boolean,
): void {
  if (isGrayscale) {
    const value = src[srcIdx] ?? 0;
    dest[destIdx] = value;
    dest[destIdx + 1] = value;
    dest[destIdx + 2] = value;
    dest[destIdx + 3] = bytesPerPixel === 2 ? (src[srcIdx + 1] ?? 255) : 255;
    return;
  }
  if (bytesPerPixel === 2) {
    // 16-bit BGR(A)5551 — high bit = alpha. Most LR2 fonts don't use this, but we still support it for completeness.
    const lo = src[srcIdx] ?? 0;
    const hi = src[srcIdx + 1] ?? 0;
    const bgr = lo | (hi << 8);
    const r = (((bgr >>> 10) & 0x1f) * 255) / 31;
    const g = (((bgr >>> 5) & 0x1f) * 255) / 31;
    const b = ((bgr & 0x1f) * 255) / 31;
    const a = (bgr & 0x8000) !== 0 ? 255 : 0;
    dest[destIdx] = r;
    dest[destIdx + 1] = g;
    dest[destIdx + 2] = b;
    dest[destIdx + 3] = a;
    return;
  }
  // TGA's truecolor pixels are stored BGR (24-bit) or BGRA (32-bit).
  dest[destIdx] = src[srcIdx + 2] ?? 0; // R = TGA byte 2
  dest[destIdx + 1] = src[srcIdx + 1] ?? 0; // G = TGA byte 1
  dest[destIdx + 2] = src[srcIdx] ?? 0; // B = TGA byte 0
  dest[destIdx + 3] = bytesPerPixel === 4 ? (src[srcIdx + 3] ?? 255) : 255;
}

function flipRows(pixels: Uint8ClampedArray, width: number, height: number): void {
  const rowBytes = width * 4;
  const tmp = new Uint8ClampedArray(rowBytes);
  for (let y = 0; y < height >>> 1; y += 1) {
    const top = y * rowBytes;
    const bot = (height - 1 - y) * rowBytes;
    tmp.set(pixels.subarray(top, top + rowBytes));
    pixels.copyWithin(top, bot, bot + rowBytes);
    pixels.set(tmp, bot);
  }
}
