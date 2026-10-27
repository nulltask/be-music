/**
 * Dependency-free, synchronous SHA-256 (FIPS 180-4). Fingerprints are hashed with it so that they can be computed
 * synchronously in Node and browsers alike, without Web Crypto's async `subtle.digest`.
 */

const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

const INITIAL_STATE = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

const HEX_DIGITS = '0123456789abcdef';

/** SHA-256 of the UTF-8 bytes of `text`, as 64 lowercase hex digits. */
export function sha256Hex(text: string): string {
  return sha256HexOfBytes(new TextEncoder().encode(text));
}

/** SHA-256 of `bytes`, as 64 lowercase hex digits. */
export function sha256HexOfBytes(bytes: Uint8Array): string {
  const byteLength = bytes.length;
  const state = new Int32Array(INITIAL_STATE);
  const words = new Int32Array(64);
  // Whole blocks are read from `bytes` as they are; only the tail (the last partial block, 0x80, zero padding and the
  // 64-bit big-endian bit length) is copied into one or two padding blocks.
  const wholeLength = byteLength - (byteLength % 64);
  for (let offset = 0; offset < wholeLength; offset += 64) {
    compressBlock(state, words, bytes, offset);
  }
  const tailLength = byteLength - wholeLength;
  const tail = new Uint8Array(tailLength + 9 > 64 ? 128 : 64);
  tail.set(bytes.subarray(wholeLength));
  tail[tailLength] = 0x80;
  const bitLength = byteLength * 8;
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  const end = tail.length;
  tail[end - 8] = high >>> 24;
  tail[end - 7] = (high >>> 16) & 0xff;
  tail[end - 6] = (high >>> 8) & 0xff;
  tail[end - 5] = high & 0xff;
  tail[end - 4] = low >>> 24;
  tail[end - 3] = (low >>> 16) & 0xff;
  tail[end - 2] = (low >>> 8) & 0xff;
  tail[end - 1] = low & 0xff;
  for (let offset = 0; offset < end; offset += 64) {
    compressBlock(state, words, tail, offset);
  }

  let hex = '';
  for (const word of state) {
    for (let shift = 28; shift >= 0; shift -= 4) {
      hex += HEX_DIGITS[(word >>> shift) & 0xf];
    }
  }
  return hex;
}

/** Folds the 64-byte block of `source` at `offset` into `state`, using `words` as the message schedule. */
function compressBlock(state: Int32Array, words: Int32Array, source: Uint8Array, offset: number): void {
  for (let index = 0; index < 16; index += 1) {
    const at = offset + index * 4;
    words[index] = (source[at]! << 24) | (source[at + 1]! << 16) | (source[at + 2]! << 8) | source[at + 3]!;
  }
  for (let index = 16; index < 64; index += 1) {
    const w15 = words[index - 15]!;
    const w2 = words[index - 2]!;
    const s0 = rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >>> 3);
    const s1 = rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >>> 10);
    words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) | 0;
  }

  let a = state[0]!;
  let b = state[1]!;
  let c = state[2]!;
  let d = state[3]!;
  let e = state[4]!;
  let f = state[5]!;
  let g = state[6]!;
  let h = state[7]!;
  for (let index = 0; index < 64; index += 1) {
    const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
    const choice = (e & f) ^ (~e & g);
    const temp1 = (h + sum1 + choice + ROUND_CONSTANTS[index]! + words[index]!) | 0;
    const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
    const majority = (a & b) ^ (a & c) ^ (b & c);
    const temp2 = (sum0 + majority) | 0;
    h = g;
    g = f;
    f = e;
    e = (d + temp1) | 0;
    d = c;
    c = b;
    b = a;
    a = (temp1 + temp2) | 0;
  }
  state[0] = (state[0]! + a) | 0;
  state[1] = (state[1]! + b) | 0;
  state[2] = (state[2]! + c) | 0;
  state[3] = (state[3]! + d) | 0;
  state[4] = (state[4]! + e) | 0;
  state[5] = (state[5]! + f) | 0;
  state[6] = (state[6]! + g) | 0;
  state[7] = (state[7]! + h) | 0;
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** Native Web Crypto SHA-256 of UTF-8 text or bytes, as lowercase hex. */
export async function sha256HexAsync(input: Uint8Array | string): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
