import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vite-plus/test';
import { md5HexOfBytes } from './md5.ts';

const encoder = new TextEncoder();

describe('md5HexOfBytes', () => {
  test.each([
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    [
      '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
      '57edf4a22be3c955ac49da2e2107b67a',
    ],
  ])('matches the RFC 1321 test vector for %j', (text, expected) => {
    expect(md5HexOfBytes(encoder.encode(text))).toBe(expected);
  });

  test('matches Node across block-boundary lengths', () => {
    for (const length of [55, 56, 63, 64, 65, 119, 120, 128, 1000]) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 31 + 7) & 0xff);
      expect(md5HexOfBytes(bytes)).toBe(createHash('md5').update(bytes).digest('hex'));
    }
  });
});
