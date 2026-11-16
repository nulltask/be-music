import { describe, expect, test } from 'vite-plus/test';
import { resolveLRXBGABlend, resolveLRXBGAPivot, resolveLRXBGAQuad } from './lrx-bga-draw.ts';

describe('LRX BGA drawing', () => {
  test('rotates about the keypad point of the destination', () => {
    expect(resolveLRXBGAPivot(0, 0, 0, 100, 50)).toEqual([50, 25]);
    expect(resolveLRXBGAPivot(5, 0, 0, 100, 50)).toEqual([50, 25]);
    expect(resolveLRXBGAPivot(7, 10, 20, 100, 50)).toEqual([10, 20]);
    expect(resolveLRXBGAPivot(3, 10, 20, 100, 50)).toEqual([110, 70]);
    expect(resolveLRXBGAPivot(8, 0, 0, 100, 50)).toEqual([50, 0]);
    expect(resolveLRXBGAPivot(4, 0, 0, 100, 50)).toEqual([0, 25]);
  });

  test("blends as plugout's Direct3D 9 driver sets each bld", () => {
    const alpha = { equation: 'FUNC_ADD', source: 'SRC_ALPHA', destination: 'ONE_MINUS_SRC_ALPHA' };
    expect(resolveLRXBGABlend(0)).toEqual(alpha);
    expect(resolveLRXBGABlend(1)).toEqual({ equation: 'FUNC_ADD', source: 'ONE', destination: 'ONE_MINUS_SRC_COLOR' });
    expect(resolveLRXBGABlend(2)).toEqual({
      equation: 'FUNC_REVERSE_SUBTRACT',
      source: 'SRC_ALPHA',
      destination: 'ONE_MINUS_SRC_COLOR',
    });
    expect(resolveLRXBGABlend(3)).toEqual({ equation: 'FUNC_ADD', source: 'SRC_ALPHA', destination: 'SRC_COLOR' });
    expect(resolveLRXBGABlend(4)).toEqual({
      equation: 'FUNC_ADD',
      source: 'DST_COLOR',
      destination: 'ONE_MINUS_SRC_ALPHA',
    });
    expect(resolveLRXBGABlend(5)).toEqual(alpha);
    expect(resolveLRXBGABlend(-1)).toEqual(alpha);
  });

  test('turns the destination corners about the pivot', () => {
    expect(resolveLRXBGAQuad(0, 0, 100, 50, [0, 0], 0)).toEqual([
      [0, 0],
      [100, 0],
      [0, 50],
      [100, 50],
    ]);
    const turned = resolveLRXBGAQuad(0, 0, 100, 50, [50, 25], 90).map(([x, y]) => [Math.round(x), Math.round(y)]);
    expect(turned).toEqual([
      [75, -25],
      [75, 75],
      [25, -25],
      [25, 75],
    ]);
  });
});
