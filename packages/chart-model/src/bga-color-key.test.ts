import { createEmptyJSON } from '@be-music/chart-source';
import { describe, expect, test } from 'vite-plus/test';
import { applyBMSColorKey, resolveBmsExBMPColorKey } from './bga-color-key.ts';

describe('resolveBmsExBMPColorKey', () => {
  test('reads strict decimal tuples and keeps zero as a meaningful no-key instruction', () => {
    const chart = createEmptyJSON('bms');
    chart.bms.exBMP['01'] = ' 000, 127, 128, 129 image name,1.png';
    expect(resolveBmsExBMPColorKey(chart, '01')).toEqual({ a: 0, r: 127, g: 128, b: 129 });
    chart.bms.exBMP['01'] = '0,0,0,0 image.png';
    expect(resolveBmsExBMPColorKey(chart, '01')).toEqual({ a: 0, r: 0, g: 0, b: 0 });
    chart.resources.bmp['01'] = 'override.png';
    expect(resolveBmsExBMPColorKey(chart, '01')).toBeUndefined();
    chart.resources.bmp['01'] = 'image.png'; // NONSTOP promotes an EXBMP filename into the BMP resource map.
    expect(resolveBmsExBMPColorKey(chart, '01')).toEqual({ a: 0, r: 0, g: 0, b: 0 });
  });
  test.each([
    '',
    ',,, image.png',
    '0,1,2,256 image.png',
    '-1,1,2,3 image.png',
    '1.5,1,2,3 image.png',
    '0,0x7f,2,3 image.png',
    '255,1,2,3',
  ])('rejects malformed color fields: %s', (raw) => {
    const chart = createEmptyJSON('bms');
    chart.bms.exBMP['01'] = raw;
    expect(resolveBmsExBMPColorKey(chart, '01')).toBeUndefined();
  });
});

describe('applyBMSColorKey', () => {
  test('uses inclusive RGB ±8 on alpha-less images, preserving unrelated pixels and black', () => {
    const pixels = new Uint8Array([119, 135, 127, 255, 118, 127, 127, 255, 127, 127, 136, 255, 0, 0, 0, 255]);
    applyBMSColorKey(pixels, { a: 0, r: 127, g: 127, b: 127 }, false);
    expect([...pixels]).toEqual([119, 135, 127, 0, 118, 127, 127, 255, 127, 127, 136, 255, 0, 0, 0, 255]);
  });
  test('requires exact source alpha instead of applying opacity or tint', () => {
    const pixels = new Uint8ClampedArray([255, 228, 173, 64, 255, 228, 173, 65, 255, 228, 173, 255]);
    applyBMSColorKey(pixels, { a: 64, r: 255, g: 228, b: 173 }, true);
    expect([...pixels]).toEqual([255, 228, 173, 0, 255, 228, 173, 65, 255, 228, 173, 255]);
  });
  test('distinguishes an opaque alpha channel from an image without alpha', () => {
    const pixels = new Uint8Array([127, 127, 127, 255]);
    applyBMSColorKey(pixels, { a: 0, r: 127, g: 127, b: 127 }, true);
    expect(pixels[3]).toBe(255);
    applyBMSColorKey(pixels, { a: 255, r: 127, g: 127, b: 127 }, false);
    expect(pixels[3]).toBe(255);
    applyBMSColorKey(pixels, { a: 255, r: 127, g: 127, b: 127 }, true);
    expect(pixels[3]).toBe(0);
  });
  test('all-zero disables keying, while near-black keys can match black', () => {
    const pixels = new Uint8Array([0, 0, 0, 255]);
    applyBMSColorKey(pixels, { a: 0, r: 0, g: 0, b: 0 }, false);
    expect(pixels[3]).toBe(255);
    applyBMSColorKey(pixels, { a: 0, r: 8, g: 8, b: 8 }, false);
    expect(pixels[3]).toBe(0);
  });
  test('leaves invalid keys and an incomplete trailing pixel untouched', () => {
    const pixels = new Uint8Array([127, 127, 127, 255, 127]);
    applyBMSColorKey(pixels, { a: NaN, r: 127, g: 127, b: 127 }, false);
    expect([...pixels]).toEqual([127, 127, 127, 255, 127]);
    applyBMSColorKey(pixels, { a: 0, r: 127, g: 127, b: 127 }, false);
    expect([...pixels]).toEqual([127, 127, 127, 0, 127]);
  });
});
