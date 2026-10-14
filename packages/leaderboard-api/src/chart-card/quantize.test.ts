import { describe, expect, test } from 'vite-plus/test';
import { quantize } from './quantize.ts';

const rgba = (...colors: Array<[number, number, number]>) =>
  Uint8Array.from(colors.flatMap(([r, g, b]) => [r, g, b, 255]));

describe('quantize', () => {
  test('keeps few colours exactly, most common first', () => {
    const image = quantize(rgba([10, 20, 30], [255, 255, 255], [10, 20, 30]), 3, 1, 8);
    expect([...image.palette]).toEqual([10, 20, 30, 255, 255, 255]);
    expect([...image.pixels]).toEqual([0, 1, 0]);
  });

  test('averages a group of close colours and maps the rest to the nearest kept colour', () => {
    const image = quantize(rgba([0, 0, 0], [1, 1, 1], [0, 0, 0], [200, 200, 200], [190, 190, 190]), 5, 1, 2);
    expect(image.palette.length).toBe(6);
    // 0 and 1 share a group (top 6 bits); 200 and 190 are two groups, and 190 joins the kept 200.
    expect([...image.palette.subarray(0, 3)]).toEqual([0, 0, 0]);
    expect([...image.pixels]).toEqual([0, 0, 0, 1, 1]);
  });
});
