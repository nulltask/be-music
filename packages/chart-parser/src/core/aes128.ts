/**
 * AES-128 (FIPS-197) block cipher with CBC chaining, for reading the encrypted chart containers some players ship.
 * Synchronous on purpose: the chart parsers are synchronous, and WebCrypto's AES-CBC is async and insists on PKCS#7
 * padding, which these containers do not use (they zero-pad to the block size).
 */

const BLOCK_BYTES = 16;
const ROUNDS = 10;

const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);

function multiply(left: number, right: number): number {
  let product = 0;
  let a = left;
  let b = right;
  while (b > 0) {
    if (b & 1) product ^= a;
    a = a & 0x80 ? ((a << 1) ^ 0x11b) & 0xff : a << 1;
    b >>= 1;
  }
  return product;
}

// The S-box from its definition: the multiplicative inverse in GF(2^8) followed by the affine transform.
{
  const inverse = new Uint8Array(256);
  for (let value = 1; value < 256; value++) {
    for (let candidate = 1; candidate < 256; candidate++) {
      if (multiply(value, candidate) === 1) {
        inverse[value] = candidate;
        break;
      }
    }
  }
  for (let value = 0; value < 256; value++) {
    let x = inverse[value]!;
    let s = x;
    for (let shift = 0; shift < 4; shift++) {
      x = ((x << 1) | (x >> 7)) & 0xff;
      s ^= x;
    }
    s ^= 0x63;
    SBOX[value] = s;
    INV_SBOX[s] = value;
  }
}

/** The expanded round keys (176 bytes) of a 16-byte AES-128 key. */
export function expandAES128Key(key: Uint8Array): Uint8Array {
  if (key.length !== BLOCK_BYTES) throw new RangeError(`AES-128 key must be ${BLOCK_BYTES} bytes`);
  const roundKeys = new Uint8Array(BLOCK_BYTES * (ROUNDS + 1));
  roundKeys.set(key);
  let rcon = 1;
  for (let offset = BLOCK_BYTES; offset < roundKeys.length; offset += 4) {
    let t0 = roundKeys[offset - 4]!;
    let t1 = roundKeys[offset - 3]!;
    let t2 = roundKeys[offset - 2]!;
    let t3 = roundKeys[offset - 1]!;
    if (offset % BLOCK_BYTES === 0) {
      const first = t0;
      t0 = SBOX[t1]! ^ rcon;
      t1 = SBOX[t2]!;
      t2 = SBOX[t3]!;
      t3 = SBOX[first]!;
      rcon = multiply(rcon, 2);
    }
    roundKeys[offset] = roundKeys[offset - BLOCK_BYTES]! ^ t0;
    roundKeys[offset + 1] = roundKeys[offset - BLOCK_BYTES + 1]! ^ t1;
    roundKeys[offset + 2] = roundKeys[offset - BLOCK_BYTES + 2]! ^ t2;
    roundKeys[offset + 3] = roundKeys[offset - BLOCK_BYTES + 3]! ^ t3;
  }
  return roundKeys;
}

function addRoundKey(state: Uint8Array, roundKeys: Uint8Array, round: number): void {
  const base = round * BLOCK_BYTES;
  for (let index = 0; index < BLOCK_BYTES; index++) state[index]! ^= roundKeys[base + index]!;
}

// The state is column-major: byte `row + 4 * column`.
function shiftRows(state: Uint8Array, inverse: boolean): void {
  const copy = state.slice();
  for (let row = 1; row < 4; row++) {
    for (let column = 0; column < 4; column++) {
      const from = inverse ? (column - row + 4) % 4 : (column + row) % 4;
      state[row + 4 * column] = copy[row + 4 * from]!;
    }
  }
}

function productTable(factor: number): Uint8Array {
  const table = new Uint8Array(256);
  for (let value = 0; value < 256; value++) table[value] = multiply(value, factor);
  return table;
}

const IDENTITY = productTable(1);
const FORWARD_MIX = [productTable(2), productTable(3), IDENTITY, IDENTITY] as const;
const INVERSE_MIX = [productTable(14), productTable(11), productTable(13), productTable(9)] as const;

function mixColumns(state: Uint8Array, inverse: boolean): void {
  const [m0, m1, m2, m3] = inverse ? INVERSE_MIX : FORWARD_MIX;
  for (let column = 0; column < 4; column++) {
    const base = 4 * column;
    const a0 = state[base]!;
    const a1 = state[base + 1]!;
    const a2 = state[base + 2]!;
    const a3 = state[base + 3]!;
    state[base] = m0[a0]! ^ m1[a1]! ^ m2[a2]! ^ m3[a3]!;
    state[base + 1] = m3[a0]! ^ m0[a1]! ^ m1[a2]! ^ m2[a3]!;
    state[base + 2] = m2[a0]! ^ m3[a1]! ^ m0[a2]! ^ m1[a3]!;
    state[base + 3] = m1[a0]! ^ m2[a1]! ^ m3[a2]! ^ m0[a3]!;
  }
}

function substitute(state: Uint8Array, box: Uint8Array): void {
  for (let index = 0; index < BLOCK_BYTES; index++) state[index] = box[state[index]!]!;
}

/** Encrypts one 16-byte block in place. */
export function encryptAES128Block(state: Uint8Array, roundKeys: Uint8Array): void {
  addRoundKey(state, roundKeys, 0);
  for (let round = 1; round < ROUNDS; round++) {
    substitute(state, SBOX);
    shiftRows(state, false);
    mixColumns(state, false);
    addRoundKey(state, roundKeys, round);
  }
  substitute(state, SBOX);
  shiftRows(state, false);
  addRoundKey(state, roundKeys, ROUNDS);
}

/** Decrypts one 16-byte block in place. */
export function decryptAES128Block(state: Uint8Array, roundKeys: Uint8Array): void {
  addRoundKey(state, roundKeys, ROUNDS);
  for (let round = ROUNDS - 1; round > 0; round--) {
    shiftRows(state, true);
    substitute(state, INV_SBOX);
    addRoundKey(state, roundKeys, round);
    mixColumns(state, true);
  }
  shiftRows(state, true);
  substitute(state, INV_SBOX);
  addRoundKey(state, roundKeys, 0);
}

/**
 * AES-128-CBC decryption without padding removal. `data` must be a whole number of blocks; the caller trims whatever
 * padding its format uses.
 */
export function decryptAES128CBC(data: Uint8Array, roundKeys: Uint8Array, iv: Uint8Array): Uint8Array {
  if (data.length % BLOCK_BYTES !== 0) throw new RangeError('AES-CBC ciphertext is not a whole number of blocks');
  const plain = new Uint8Array(data.length);
  const state = new Uint8Array(BLOCK_BYTES);
  let previous = iv;
  for (let offset = 0; offset < data.length; offset += BLOCK_BYTES) {
    const block = data.subarray(offset, offset + BLOCK_BYTES);
    state.set(block);
    decryptAES128Block(state, roundKeys);
    for (let index = 0; index < BLOCK_BYTES; index++) plain[offset + index] = state[index]! ^ previous[index]!;
    previous = block;
  }
  return plain;
}

/** AES-128-CBC encryption of `data` zero-padded to the block size (the counterpart of {@link decryptAES128CBC}). */
export function encryptAES128CBC(data: Uint8Array, roundKeys: Uint8Array, iv: Uint8Array): Uint8Array {
  const length = Math.ceil(data.length / BLOCK_BYTES) * BLOCK_BYTES;
  const cipher = new Uint8Array(length);
  cipher.set(data);
  let previous = iv;
  for (let offset = 0; offset < length; offset += BLOCK_BYTES) {
    const block = cipher.subarray(offset, offset + BLOCK_BYTES);
    for (let index = 0; index < BLOCK_BYTES; index++) block[index]! ^= previous[index]!;
    encryptAES128Block(block, roundKeys);
    previous = block;
  }
  return cipher;
}
