import { expect, test } from 'vite-plus/test';
import { keyBoundBGAResourceKey } from './key-bound-bga.ts';
test('SWBGA resource keys keep BMP00, case-sensitive ids and independent definitions in separate namespaces', () => {
  const keys = [
    keyBoundBGAResourceKey('61', '00'),
    keyBoundBGAResourceKey('62', '00'),
    keyBoundBGAResourceKey('61', '0a'),
    keyBoundBGAResourceKey('61', '0A'),
  ];
  expect(new Set(keys).size).toBe(4);
  expect(keys.every((key) => key.startsWith(String.fromCharCode(0)))).toBe(true);
  expect(keys[0]).not.toBe('00');
});
