import { describe, expect, test } from 'vite-plus/test';
import { resolveLRXBGAComposite, resolveLRXBGAPivot } from './lrx-bga-draw.ts';

describe('LRX BGA drawing', () => {
  test('rotates about the keypad point of the destination', () => {
    expect(resolveLRXBGAPivot(0, 0, 0, 100, 50)).toEqual([50, 25]);
    expect(resolveLRXBGAPivot(5, 0, 0, 100, 50)).toEqual([50, 25]);
    expect(resolveLRXBGAPivot(7, 10, 20, 100, 50)).toEqual([10, 20]);
    expect(resolveLRXBGAPivot(3, 10, 20, 100, 50)).toEqual([110, 70]);
    expect(resolveLRXBGAPivot(8, 0, 0, 100, 50)).toEqual([50, 0]);
    expect(resolveLRXBGAPivot(4, 0, 0, 100, 50)).toEqual([0, 25]);
  });

  test('blends alpha, add, subtract (as a difference) and multiply', () => {
    expect([0, 1, 2, 3, 9].map(resolveLRXBGAComposite)).toEqual([
      'source-over',
      'lighter',
      'difference',
      'multiply',
      'source-over',
    ]);
  });
});
