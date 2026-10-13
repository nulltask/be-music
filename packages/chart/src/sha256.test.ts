import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vite-plus/test';
import { sha256Hex, sha256HexOfBytes } from './sha256.ts';

function nodeSha256(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

describe('sha256Hex', () => {
  test('hashes the empty string to the known digest', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  test('hashes "abc" to the FIPS 180-4 example digest', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test.each([
    ['ASCII', 'The quick brown fox jumps over the lazy dog'],
    ['multi-byte UTF-8', '譜面の指紋 — Be-Music 🎹 Ünïcödé'],
    ['a lone surrogate', 'broken \ud800 pair'],
    ['JSON', '{"notes":[{"l":"1P1","t":{"m":"0","p":"1/2"}}],"v":"bmfp1"}'],
  ])('matches node:crypto for %s', (_label, text) => {
    expect(sha256Hex(text)).toBe(nodeSha256(text));
  });

  test.each([1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129])(
    'matches node:crypto at %i bytes around the padding boundaries',
    (length) => {
      const text = 'a'.repeat(length);
      expect(sha256Hex(text)).toBe(nodeSha256(text));
    },
  );

  test('matches node:crypto for a large input', () => {
    const text = Array.from({ length: 50_000 }, (_, index) => `${index}:ノーツ;`).join('');
    expect(sha256Hex(text)).toBe(nodeSha256(text));
  });
});

describe('sha256HexOfBytes', () => {
  test('matches node:crypto for every byte value', () => {
    const bytes = Uint8Array.from({ length: 1000 }, (_, index) => (index * 31) & 0xff);
    expect(sha256HexOfBytes(bytes)).toBe(nodeSha256(bytes));
  });
});
