import { expect, test } from 'vite-plus/test';
import { sha256Hex } from './hash.ts';
test('hashes text and UTF-8 bytes identically', async () => {
  const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  expect(await sha256Hex('abc')).toBe(expected);
  expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(expected);
});
