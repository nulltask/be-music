import { describe, expect, test } from 'vite-plus/test';
import {
  decryptAES128CBC,
  decryptAES128Block,
  encryptAES128Block,
  encryptAES128CBC,
  expandAES128Key,
} from './aes128.ts';

function hex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
}

describe('AES-128', () => {
  // FIPS-197 Appendix C.1.
  const key = expandAES128Key(hex('000102030405060708090a0b0c0d0e0f'));
  const plain = hex('00112233445566778899aabbccddeeff');
  const cipher = hex('69c4e0d86a7b0430d8cdb78070b4c55a');

  test('encrypts and decrypts the FIPS-197 example block', () => {
    const block = plain.slice();
    encryptAES128Block(block, key);
    expect(block).toEqual(cipher);
    decryptAES128Block(block, key);
    expect(block).toEqual(plain);
  });

  test('CBC matches the NIST SP 800-38A F.2.1 vectors', () => {
    const cbcKey = expandAES128Key(hex('2b7e151628aed2a6abf7158809cf4f3c'));
    const iv = hex('000102030405060708090a0b0c0d0e0f');
    const message = hex('6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51');
    const expected = hex('7649abac8119b246cee98e9b12e9197d5086cb9b507219ee95db113a917678b2');
    expect(encryptAES128CBC(message, cbcKey, iv)).toEqual(expected);
    expect(decryptAES128CBC(expected, cbcKey, iv)).toEqual(message);
  });

  test('CBC encryption zero-pads a partial block, and decryption keeps the padding', () => {
    const iv = new Uint8Array(16);
    const encrypted = encryptAES128CBC(Uint8Array.of(1, 2, 3), key, iv);
    expect(encrypted).toHaveLength(16);
    expect(decryptAES128CBC(encrypted, key, iv)).toEqual(Uint8Array.of(1, 2, 3, ...new Uint8Array(13)));
  });

  test('rejects a key or ciphertext of the wrong size', () => {
    expect(() => expandAES128Key(new Uint8Array(15))).toThrow(RangeError);
    expect(() => decryptAES128CBC(new Uint8Array(17), key, new Uint8Array(16))).toThrow(RangeError);
  });
});
