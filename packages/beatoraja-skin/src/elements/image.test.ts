import { describe, expect, it } from 'vitest';
import { imageFrameAt, imageFrameRect, imageRefFrame, normalizeBeatorajaImages } from './image.ts';

describe('normalizeBeatorajaImages', () => {
  it('fills in default field values for sparsely-authored entries', () => {
    const out = normalizeBeatorajaImages([{ id: 1, src: 0, x: 0, y: 0, w: 8, h: 8 }]);
    expect(out).toEqual([
      {
        id: 1,
        src: 0,
        x: 0,
        y: 0,
        w: 8,
        h: 8,
        divx: 1,
        divy: 1,
        timer: 0,
        cycle: 0,
        ref: 0,
        len: 0,
        act: 0,
        click: 0,
        // disapearLine defaults to -1 (= no clip). Hidden-cover entries set this to a positive
        // value (e.g., 140 in the play7 reference theme).
        disapearLine: -1,
        isDisapearLineLinkLift: false,
        ifCodes: [],
      },
    ]);
  });

  it('parses hiddenCover-style fields (disapearLine + isDisapearLineLinkLift) as numbers / booleans', () => {
    const out = normalizeBeatorajaImages([
      {
        id: 'hidden-cover',
        src: 12,
        x: 0,
        y: 0,
        w: 390,
        h: 580,
        disapearLine: 140,
        isDisapearLineLinkLift: true,
      },
    ]);
    expect(out[0]?.disapearLine).toBe(140);
    expect(out[0]?.isDisapearLineLinkLift).toBe(true);
  });

  it('coerces 1/0 into booleans for `isDisapearLineLinkLift` (JSON skin convention)', () => {
    const truthy = normalizeBeatorajaImages([
      { id: 'a', src: 0, x: 0, y: 0, w: 1, h: 1, disapearLine: 100, isDisapearLineLinkLift: 1 },
    ]);
    const falsy = normalizeBeatorajaImages([
      { id: 'b', src: 0, x: 0, y: 0, w: 1, h: 1, disapearLine: 100, isDisapearLineLinkLift: 0 },
    ]);
    expect(truthy[0]?.isDisapearLineLinkLift).toBe(true);
    expect(falsy[0]?.isDisapearLineLinkLift).toBe(false);
  });

  it('preserves authored animation / ref fields verbatim', () => {
    const out = normalizeBeatorajaImages([
      {
        id: 'bomb1-1',
        src: 10,
        x: 0,
        y: 0,
        w: 1810,
        h: 192,
        divx: 10,
        timer: 51,
        cycle: 160,
      },
    ]);
    expect(out[0]).toMatchObject({ id: 'bomb1-1', divx: 10, divy: 1, timer: 51, cycle: 160 });
  });

  it('preserves symbolic string source ids', () => {
    const out = normalizeBeatorajaImages([{ id: 'background', src: 'bg_src', x: 0, y: 0, w: 1280, h: 720 }]);
    expect(out[0]?.src).toBe('bg_src');
  });

  it('flattens conditional `if`/`values` blocks and attaches ifCodes', () => {
    const out = normalizeBeatorajaImages([
      { if: [920], values: [{ id: 'lane-bg', src: 7, x: 56, y: 0, w: 560, h: 80 }] },
    ]);
    expect(out[0].id).toBe('lane-bg');
    expect(out[0].ifCodes).toEqual([920]);
  });

  it('drops entries without an id', () => {
    expect(normalizeBeatorajaImages([{ src: 0, x: 0, y: 0, w: 1, h: 1 }])).toEqual([]);
  });

  it('coerces non-positive divx / divy back to 1', () => {
    const out = normalizeBeatorajaImages([
      { id: 5, divx: 0, divy: -2 },
      { id: 6, divx: 4.7, divy: 3.2 },
    ]);
    expect(out[0].divx).toBe(1);
    expect(out[0].divy).toBe(1);
    expect(out[1].divx).toBe(4);
    expect(out[1].divy).toBe(3);
  });
});

describe('imageFrameRect', () => {
  it('returns the source rect for the requested cell', () => {
    const image = normalizeBeatorajaImages([{ id: 0, src: 0, x: 0, y: 0, w: 200, h: 220, divy: 11 }])[0];
    expect(imageFrameRect(image, 0)).toEqual({ x: 0, y: 0, w: 200, h: 20 });
    expect(imageFrameRect(image, 5)).toEqual({ x: 0, y: 100, w: 200, h: 20 });
    expect(imageFrameRect(image, 10)).toEqual({ x: 0, y: 200, w: 200, h: 20 });
  });

  it('clamps the frame index to the last cell', () => {
    const image = normalizeBeatorajaImages([{ id: 0, src: 0, x: 0, y: 0, w: 200, h: 220, divy: 11 }])[0];
    expect(imageFrameRect(image, 100)).toEqual({ x: 0, y: 200, w: 200, h: 20 });
  });

  it('handles 2D cell grids', () => {
    const image = normalizeBeatorajaImages([{ id: 0, src: 0, x: 0, y: 0, w: 1810, h: 192, divx: 10 }])[0];
    expect(imageFrameRect(image, 0)).toEqual({ x: 0, y: 0, w: 181, h: 192 });
    expect(imageFrameRect(image, 9)).toEqual({ x: 1629, y: 0, w: 181, h: 192 });
  });
});

describe('imageFrameAt', () => {
  it('cycles through frames over the configured period', () => {
    const image = normalizeBeatorajaImages([
      { id: 0, src: 0, x: 0, y: 0, w: 1810, h: 192, divx: 10, timer: 51, cycle: 160 },
    ])[0];
    expect(imageFrameAt(image, 0)).toBe(0);
    expect(imageFrameAt(image, 80)).toBe(5);
    expect(imageFrameAt(image, 160)).toBe(0); // wraps to start at the period boundary
  });

  it('returns 0 when cycle is unset', () => {
    const image = normalizeBeatorajaImages([{ id: 0, src: 0, x: 0, y: 0, w: 8, h: 8 }])[0];
    expect(imageFrameAt(image, 1000)).toBe(0);
  });
});

describe('imageRefFrame', () => {
  it('clamps to len when len is set', () => {
    const image = normalizeBeatorajaImages([
      { id: 100, src: 3, x: 0, y: 0, w: 200, h: 220, divy: 11, len: 11, ref: 370 },
    ])[0];
    expect(imageRefFrame(image, 5)).toBe(5);
    expect(imageRefFrame(image, 100)).toBe(10); // len-1
    expect(imageRefFrame(image, -1)).toBe(0);
  });

  it('falls back to total cell count when len is omitted', () => {
    const image = normalizeBeatorajaImages([{ id: 0, src: 0, x: 0, y: 0, w: 200, h: 220, divy: 11 }])[0];
    expect(imageRefFrame(image, 100)).toBe(10);
  });
});
