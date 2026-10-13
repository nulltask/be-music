/**
 * Dependency-free MD5 (RFC 1321). Web Crypto has no MD5, but LR2 and the sites built around it (LR2IR and its
 * archives) identify a chart by the MD5 of its file, so the play-log recorder stamps it next to the SHA-256.
 * MD5 is used here only as a file identifier, never for security.
 */

/** Per-round left-rotation amounts. */
const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4,
  11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/** `floor(abs(sin(i + 1)) * 2^32)` for i = 0..63. */
const SINES = Uint32Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000));

const HEX_DIGITS = '0123456789abcdef';

/** MD5 of `bytes`, as 32 lowercase hex digits. */
export function md5HexOfBytes(bytes: Uint8Array): string {
  const byteLength = bytes.length;
  // Message + 0x80 + zero padding + 64-bit little-endian bit length, rounded up to whole 64-byte blocks.
  const paddedLength = Math.ceil((byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[byteLength] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = byteLength * 8;
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const words = new Uint32Array(16);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let index = 0; index < 64; index += 1) {
      let f: number;
      let g: number;
      if (index < 16) {
        f = (b & c) | (~b & d);
        g = index;
      } else if (index < 32) {
        f = (d & b) | (~d & c);
        g = (5 * index + 1) % 16;
      } else if (index < 48) {
        f = b ^ c ^ d;
        g = (3 * index + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * index) % 16;
      }
      const sum = (a + f + SINES[index]! + words[g]!) >>> 0;
      const shift = SHIFTS[index]!;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  let hex = '';
  for (const word of [a0, b0, c0, d0]) {
    // Little-endian byte order.
    for (let byte = 0; byte < 4; byte += 1) {
      const value = (word >>> (byte * 8)) & 0xff;
      hex += HEX_DIGITS[value >>> 4]! + HEX_DIGITS[value & 0x0f]!;
    }
  }
  return hex;
}
