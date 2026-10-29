import { getANSIFrameAlpha, setANSIFrameAlpha } from './bga-alpha.ts';
import { describe, expect, test } from 'vite-plus/test';
import type { DecodedImage } from './bga-image.ts';
import {
  type ANSIFrame,
  convertImageToSourceFrame,
  createMissingSourceFrame,
  createSolidANSIFrame,
  resizeANSIFrame,
  resizeANSIFrameWithAspectMode,
} from './bga-frame.ts';

function createFrame(width: number, height: number, pixels: ReadonlyArray<[number, number, number] | null>): ANSIFrame {
  const frame = createSolidANSIFrame(width, height, 0, 0, 0, 0);
  pixels.forEach((pixel, index) => {
    if (!pixel) {
      return;
    }
    frame.rgb.set(pixel, index * 3);
    frame.opaqueMask[index] = 1;
  });
  return frame;
}

function createImage(format: DecodedImage['format'], width: number, rgba: number[]): DecodedImage {
  return { width, height: rgba.length / 4 / width, data: new Uint8Array(rgba), format };
}

const RED: [number, number, number] = [255, 0, 0];
const BLUE: [number, number, number] = [0, 0, 255];

describe('createSolidANSIFrame', () => {
  test('fills every pixel with the colour when opaque', () => {
    const frame = createSolidANSIFrame(2, 1, 10, 20, 30, 1);
    expect(frame.width).toBe(2);
    expect(frame.height).toBe(1);
    expect([...frame.rgb]).toEqual([10, 20, 30, 10, 20, 30]);
    expect([...frame.opaqueMask]).toEqual([1, 1]);
  });

  test('leaves a transparent frame empty and keeps at least one pixel', () => {
    const frame = createSolidANSIFrame(0, 1, 10, 20, 30, 0);
    expect(frame.width).toBe(1);
    expect([...frame.rgb]).toEqual([0, 0, 0]);
    expect([...frame.opaqueMask]).toEqual([0]);
  });
});

describe('createMissingSourceFrame', () => {
  test('is an opaque black canvas for the base track and a transparent one for layers', () => {
    const base = createMissingSourceFrame('base');
    expect(base.width).toBe(256);
    expect(base.height).toBe(256);
    expect(base.opaqueMask.every((value) => value === 1)).toBe(true);
    expect(base.rgb.every((value) => value === 0)).toBe(true);
    expect(createMissingSourceFrame('layer').opaqueMask.every((value) => value === 0)).toBe(true);
  });
});

describe('convertImageToSourceFrame', () => {
  test('keys out transparent PNG pixels and black BMP pixels on a layer', () => {
    const png = convertImageToSourceFrame(createImage('png', 2, [255, 0, 0, 255, 0, 0, 255, 0]), 'layer');
    expect([...png.opaqueMask]).toEqual([1, 0]);
    expect([...png.rgb]).toEqual([255, 0, 0, 0, 0, 0]);
    const bmp = convertImageToSourceFrame(createImage('bmp', 2, [0, 0, 0, 255, 9, 9, 9, 255]), 'layer');
    expect([...bmp.opaqueMask]).toEqual([0, 1]);
  });

  test('keeps every pixel on the base track and black BMP pixels on a bmson layer', () => {
    const image = createImage('bmp', 2, [0, 0, 0, 255, 9, 9, 9, 255]);
    expect([...convertImageToSourceFrame(image, 'base').opaqueMask]).toEqual([1, 1]);
    expect([...convertImageToSourceFrame(image, 'bmson-layer').opaqueMask]).toEqual([1, 1]);
  });

  test('trims the black borders of a video frame', () => {
    const frame = convertImageToSourceFrame(
      createImage('video', 3, [0, 0, 0, 255, 200, 100, 50, 255, 0, 0, 0, 255]),
      'base',
    );
    expect(frame.width).toBe(1);
    expect(frame.height).toBe(1);
    expect([...frame.rgb]).toEqual([200, 100, 50]);
  });

  test('retains native video coordinates for authored BGA sub-regions', () => {
    const frame = convertImageToSourceFrame(
      createImage('video', 3, [0, 0, 0, 255, 200, 100, 50, 255, 0, 0, 0, 255]),
      'base',
      true,
    );
    expect(frame.width).toBe(3);
    expect(Array.from(frame.rgb)).toEqual([0, 0, 0, 200, 100, 50, 0, 0, 0]);
  });
});

describe('resizeANSIFrame', () => {
  test('fits the frame into the cells, doubling its width for the terminal pixel aspect', () => {
    const resized = resizeANSIFrame(createFrame(2, 1, [RED, BLUE]), 4, 2, 'nearest');
    expect(resized.width).toBe(4);
    expect(resized.height).toBe(2);
    expect([...resized.opaqueMask]).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
    expect([...resized.rgb.subarray(0, 12)]).toEqual([...RED, ...RED, ...BLUE, ...BLUE]);
  });
});

describe('resizeANSIFrameWithAspectMode', () => {
  test('returns the frame itself when it already fits at a 1:1 aspect', () => {
    const frame = createFrame(2, 1, [RED, BLUE]);
    expect(resizeANSIFrameWithAspectMode(frame, 2, 1, 1, 1, 'contain', 'nearest')).toBe(frame);
  });

  test('covers the canvas, cropping the overflow evenly', () => {
    const resized = resizeANSIFrameWithAspectMode(createFrame(2, 1, [RED, BLUE]), 2, 2, 1, 1, 'cover', 'nearest');
    expect(resized.width).toBe(2);
    expect(resized.height).toBe(2);
    expect([...resized.opaqueMask]).toEqual([1, 1, 1, 1]);
    expect([...resized.rgb]).toEqual([...RED, ...BLUE, ...RED, ...BLUE]);
  });
});

test.each(['base', 'layer', 'bmson-layer', 'exbmp'] as const)(
  'preserves PNG source coverage including alpha 1 on %s',
  (mode) => {
    const values = [0, 1, 16, 127, 128, 254, 255];
    const image = createImage(
      'png',
      values.length,
      values.flatMap((alpha) => [255, 0, 0, alpha]),
    );
    const original = image.data.slice();
    const frame = convertImageToSourceFrame(image, mode);
    expect(values.map((_, index) => getANSIFrameAlpha(frame, index))).toEqual(values);
    expect([...frame.opaqueMask]).toEqual([0, 1, 1, 1, 1, 1, 1]);
    expect(image.data).toEqual(original);
  },
);

test('honors encoded BMP alpha while retaining BMS black keying and alpha-less BMP compatibility', () => {
  const image = { ...createImage('bmp', 2, [255, 0, 0, 128, 0, 0, 0, 128]), hasAlphaChannel: true };
  const base = convertImageToSourceFrame(image, 'base');
  const layer = convertImageToSourceFrame(image, 'layer');
  expect([0, 1].map((pixel) => getANSIFrameAlpha(base, pixel))).toEqual([128, 128]);
  expect([0, 1].map((pixel) => getANSIFrameAlpha(layer, pixel))).toEqual([128, 0]);
  expect(getANSIFrameAlpha(convertImageToSourceFrame({ ...image, hasAlphaChannel: false }, 'base'), 0)).toBe(255);
});

test.each(['nearest', 'lanczos'] as const)(
  'keeps fractional coverage through resize and hides transparent RGB (%s)',
  (algorithm) => {
    const source = createSolidANSIFrame(2, 1, 0, 0, 0, 0);
    source.rgb.set([255, 0, 0, 0, 0, 255]);
    setANSIFrameAlpha(source, 0, 128);
    const original = structuredClone(source);
    const resized = resizeANSIFrameWithAspectMode(source, 8, 4, 1, 1, 'cover', algorithm);
    expect(resized.alpha).toBeDefined();
    for (let pixel = 0; pixel < resized.opaqueMask.length; pixel++)
      if (resized.opaqueMask[pixel]) {
        expect(resized.rgb[pixel * 3]).toBe(255);
        expect(resized.rgb[pixel * 3 + 2]).toBe(0);
      }
    expect(source).toEqual(original);
    expect(resizeANSIFrameWithAspectMode(source, 8, 4, 1, 1, 'cover', algorithm)).toBe(resized);
  },
);
