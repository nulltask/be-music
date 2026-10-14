/**
 * A palette image and its PNG encoding, small enough for a Worker on the Free plan: the pixels are palette indices, and
 * the PNG stores them without compressing (deflate "stored" blocks), so encoding costs two checksums and a copy rather
 * than a compressor's CPU time. A 1200 x 630 card comes to about 760 KB, well inside every network's limit.
 */

/** An image whose pixels index `palette` (RGB triples, at most 256). */
export interface IndexedImage {
  width: number;
  height: number;
  palette: Uint8Array;
  pixels: Uint8Array;
}

/** Fills a rectangle with a palette index, clipped to the image. */
export function fillRect(
  image: IndexedImage,
  x: number,
  y: number,
  width: number,
  height: number,
  index: number,
): void {
  const left = Math.max(0, Math.round(x));
  const right = Math.min(image.width, Math.round(x + width));
  const top = Math.max(0, Math.round(y));
  const bottom = Math.min(image.height, Math.round(y + height));
  if (right <= left) return;
  for (let row = top; row < bottom; row++) {
    image.pixels.fill(index, row * image.width + left, row * image.width + right);
  }
}

let crcTable: Uint32Array | undefined;

/** CRC-32 (ISO-HDLC) of `bytes`, as PNG chunks use it; `crc` continues an earlier one. */
export function crc32(bytes: Uint8Array, crc = 0): number {
  if (crcTable === undefined) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  const table = crcTable;
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = (table[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return ~c >>> 0;
}

/** Adler-32 of `bytes`, the zlib stream's checksum. */
export function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  // 5552 bytes is the most that can be summed before the sums must be reduced (zlib's NMAX).
  for (let start = 0; start < bytes.length; start += 5552) {
    const end = Math.min(bytes.length, start + 5552);
    for (let i = start; i < end; i++) {
      a += bytes[i] ?? 0;
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** `data` as a zlib stream of stored (uncompressed) deflate blocks. */
export function storedZlib(data: Uint8Array): Uint8Array {
  const blockSize = 65535;
  const blocks = Math.max(1, Math.ceil(data.length / blockSize));
  const out = new Uint8Array(2 + blocks * 5 + data.length + 4);
  const view = new DataView(out.buffer);
  // CMF / FLG: deflate with a 32 KB window, no dictionary, fastest level; (0x78 << 8 | 0x01) % 31 === 0.
  out[0] = 0x78;
  out[1] = 0x01;
  let at = 2;
  for (let block = 0; block < blocks; block++) {
    const start = block * blockSize;
    const length = Math.min(blockSize, data.length - start);
    out[at] = block === blocks - 1 ? 1 : 0;
    view.setUint16(at + 1, length, true);
    view.setUint16(at + 3, ~length & 0xffff, true);
    out.set(data.subarray(start, start + length), at + 5);
    at += 5 + length;
  }
  view.setUint32(at, adler32(data));
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** The image as an 8-bit palette PNG. */
export function encodeIndexedPng(image: IndexedImage): Uint8Array<ArrayBuffer> {
  const { width, height } = image;
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header.set([8, 3, 0, 0, 0], 8);
  // Each row starts with its filter type, 0 (none).
  const raw = new Uint8Array((width + 1) * height);
  for (let row = 0; row < height; row++) {
    raw.set(image.pixels.subarray(row * width, (row + 1) * width), row * (width + 1) + 1);
  }
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('PLTE', image.palette),
    chunk('IDAT', storedZlib(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
