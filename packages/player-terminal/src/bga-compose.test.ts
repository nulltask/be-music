import { describe, expect, test } from 'vite-plus/test';
import {
  composeANSILines,
  createBlackBackgroundANSILines,
  cropANSIFrameToOpaqueBounds,
  fillANSIFrameBackground,
  mergeCompositeFrames,
  mergeCompositeLayers,
} from './bga-compose.ts';
import { type ANSIFrame, createSolidANSIFrame } from './bga-frame.ts';

const RESET = '\u001b[0m';

function createFrame(width: number, height: number, pixels: ReadonlyArray<number[] | null>): ANSIFrame {
  const frame = createSolidANSIFrame(width, height, 0, 0, 0, 0);
  pixels.forEach((pixel, index) => {
    if (pixel) {
      frame.rgb.set(pixel, index * 3);
      frame.opaqueMask[index] = 1;
    }
  });
  return frame;
}

describe('composeANSILines', () => {
  test('draws opaque pixels as background-coloured cells and transparent ones as plain spaces', () => {
    expect(
      composeANSILines(new Uint8Array([10, 20, 30, 10, 20, 30, 0, 0, 0]), new Uint8Array([1, 1, 0]), 3, 1),
    ).toEqual([`\u001b[48;2;10;20;30m  ${RESET} `]);
    expect(composeANSILines(new Uint8Array([1, 2, 3, 4, 5, 6]), new Uint8Array([1, 1]), 2, 1)).toEqual([
      `\u001b[48;2;1;2;3m \u001b[48;2;4;5;6m ${RESET}`,
    ]);
  });

  test('createBlackBackgroundANSILines draws a black block, at least one cell', () => {
    expect(createBlackBackgroundANSILines(2, 2)).toEqual([
      `\u001b[48;2;0;0;0m  ${RESET}`,
      `\u001b[48;2;0;0;0m  ${RESET}`,
    ]);
    expect(createBlackBackgroundANSILines(0, 0)).toEqual([`\u001b[48;2;0;0;0m ${RESET}`]);
  });
});

describe('mergeCompositeFrames', () => {
  test('paints the frames in order, centered, keeping what shows through transparent pixels', () => {
    const red = [255, 0, 0];
    const blue = [0, 0, 255];
    const merged = mergeCompositeFrames(createFrame(2, 2, [red, red, red, red]), createFrame(1, 1, [blue]))!;
    expect([merged.width, merged.height]).toEqual([2, 2]);
    expect([...merged.rgb]).toEqual([...blue, ...red, ...red, ...red]);
    expect([...merged.opaqueMask]).toEqual([1, 1, 1, 1]);
    const layered = mergeCompositeFrames(createFrame(1, 1, [red]), createFrame(1, 1, [null]))!;
    expect([...layered.rgb]).toEqual(red);
  });

  test('returns a single frame as is and nothing without frames', () => {
    const frame = createFrame(1, 1, [[1, 2, 3]]);
    expect(mergeCompositeFrames(undefined, frame)).toBe(frame);
    expect(mergeCompositeFrames(undefined)).toBeUndefined();
  });
});

describe('mergeCompositeLayers', () => {
  test('blends both overlays over the lower tracks without mutating source pixels', () => {
    const base = createFrame(1, 1, [[0, 0, 255]]);
    const red = createFrame(1, 1, [[255, 0, 0]]);
    const green = createFrame(1, 1, [[0, 255, 0]]);
    const result = mergeCompositeLayers([
      { frame: base, opacity: 1 },
      { frame: red, opacity: 128 / 255 },
      { frame: green, opacity: 64 / 255 },
    ])!;
    expect(Array.from(result.rgb)).toEqual([96, 64, 95]);
    expect(Array.from(base.rgb)).toEqual([0, 0, 255]);
    expect(Array.from(red.rgb)).toEqual([255, 0, 0]);
  });

  test('keeps masked holes transparent to lower layers and centers a smaller frame', () => {
    const result = mergeCompositeLayers([
      {
        frame: createFrame(3, 1, [
          [0, 0, 255],
          [0, 0, 255],
          [0, 0, 255],
        ]),
        opacity: 1,
      },
      { frame: createFrame(1, 1, [[255, 0, 0]]), opacity: 128 / 255 },
      { frame: createFrame(1, 1, [null]), opacity: 0.5 },
    ])!;
    expect(Array.from(result.rgb)).toEqual([0, 0, 255, 128, 0, 127, 0, 0, 255]);
  });

  test('dims a single frame over black and supports zero opacity without shrinking the canvas', () => {
    const frame = createFrame(1, 1, [[255, 0, 0]]);
    expect(Array.from(mergeCompositeLayers([{ frame, opacity: 128 / 255 }])!.rgb)).toEqual([128, 0, 0]);
    expect(Array.from(mergeCompositeLayers([{ frame, opacity: 0 }])!.rgb)).toEqual([0, 0, 0]);
    expect(mergeCompositeLayers([{ frame, opacity: 1 }])).toBe(frame);
    expect(mergeCompositeLayers([{ opacity: 0.5 }])).toBeUndefined();
  });
});

describe('fillANSIFrameBackground', () => {
  test('fills the transparent pixels with the colour', () => {
    const filled = fillANSIFrameBackground(createFrame(2, 1, [[1, 2, 3], null]), 9, 9, 9);
    expect([...filled.rgb]).toEqual([1, 2, 3, 9, 9, 9]);
    expect([...filled.opaqueMask]).toEqual([1, 1]);
  });
});

describe('cropANSIFrameToOpaqueBounds', () => {
  test('crops to the opaque pixels', () => {
    const cropped = cropANSIFrameToOpaqueBounds(createFrame(3, 1, [null, [4, 5, 6], null]));
    expect([cropped.width, cropped.height]).toEqual([1, 1]);
    expect([...cropped.rgb]).toEqual([4, 5, 6]);
  });

  test('returns an opaque frame as is and a 1x1 transparent frame when nothing is opaque', () => {
    const opaque = createFrame(1, 1, [[1, 2, 3]]);
    expect(cropANSIFrameToOpaqueBounds(opaque)).toBe(opaque);
    const empty = cropANSIFrameToOpaqueBounds(createFrame(2, 1, [null, null]));
    expect([empty.width, empty.height]).toEqual([1, 1]);
    expect([...empty.opaqueMask]).toEqual([0]);
  });
});
