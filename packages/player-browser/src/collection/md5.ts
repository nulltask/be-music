/**
 * Dependency-free MD5 (RFC 1321). Web Crypto has no MD5, but LR2 and the sites built around it (LR2IR and its
 * archives) identify a chart by the MD5 of its file, so the replay recorder stamps it next to the SHA-256.
 * MD5 is used here only as a file identifier, never for security.
 */

/** Per-round left-rotation amounts. */
const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4,
  11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/** `floor(abs(sin(i + 1)) * 2^32)` for i = 0..63. */
const SINES = Uint32Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000));

const HEX_BYTES = Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, '0'));
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

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
  const words = new Uint32Array(padded.buffer);
  if (!LITTLE_ENDIAN) {
    // MD5 reads little-endian words. Swap them in place when the typed array uses big-endian order.
    for (let index = 0; index < words.length; index += 1) words[index] = view.getUint32(index * 4, true);
  }
  for (let offset = 0; offset < words.length; offset += 16) {
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
      const sum = (a + f + SINES[index]! + words[offset + g]!) >>> 0;
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

  return wordHex(a0) + wordHex(b0) + wordHex(c0) + wordHex(d0);
}

/** Hex digits for a word's four bytes, in little-endian order. */
function wordHex(word: number): string {
  return (
    HEX_BYTES[word & 0xff]! +
    HEX_BYTES[(word >>> 8) & 0xff]! +
    HEX_BYTES[(word >>> 16) & 0xff]! +
    HEX_BYTES[word >>> 24]!
  );
}
