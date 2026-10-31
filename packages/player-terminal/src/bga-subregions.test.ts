import { createEmptyJSON } from '@be-music/chart-source';
import { describe, expect, test, vi } from 'vite-plus/test';
import { createSolidANSIFrame } from './bga-frame.ts';
import { cropBGAFrameSource, cropBGASubRegion, resolveBGAResource } from './bga-subregions.ts';
import { selectFrameFromSource, type VideoFrameSource } from './bga-frame-source.ts';

const region = { sourceBMP: '01', sx: 0, sy: 0, ex: 2, ey: 1, dx: 10, dy: 20 };

describe('BGA sub-region source lookup', () => {
  test('retains long internal ids in mixed NONSTOP bmson resources', () => {
    const chart = createEmptyJSON('bmson');
    chart.bms.base = 62;
    chart.bms.bga['100'] = '101 0 0 2 1 10 20';
    expect(resolveBGAResource(chart, { '101': 'source.png' }, '100')).toMatchObject({
      path: 'source.png',
      regions: [{ sourceBMP: '101' }],
    });
  });
  test('resolves out-of-order chains, preserving explicit resource precedence and base-62 ids', () => {
    const chart = createEmptyJSON('bms');
    chart.bms.base = 62;
    chart.bms.bga = { aa: 'bb 0 0 2 1 10 20', bb: 'cc 0 0 2 1 0 0', cc: 'aa 0 0 2 1 0 0' };
    expect(resolveBGAResource(chart, { cc: 'source.png' }, 'aa')).toEqual({
      path: 'source.png',
      regions: [
        { ...region, sourceBMP: 'cc', dx: 0, dy: 0 },
        { ...region, sourceBMP: 'bb' },
      ],
    });
    expect(resolveBGAResource(chart, { aa: 'explicit.png' }, 'aa')).toEqual({ path: 'explicit.png', regions: [] });
    expect(resolveBGAResource(chart, {}, 'aa')).toBeUndefined();
    expect(resolveBGAResource(chart, {}, 'missing')).toBeUndefined();
    chart.bms.bga.aa = 'invalid';
    expect(resolveBGAResource(chart, {}, 'aa')).toBeUndefined();
  });
});

describe('BGA sub-region pixels', () => {
  test('places pixels at dx/dy and gives base and overlay canvases different backgrounds', () => {
    const source = createSolidANSIFrame(2, 1, 255, 0, 0, 1);
    source.opaqueMask[1] = 0;
    for (const mode of ['base', 'layer', 'bmson-layer'] as const) {
      const result = cropBGASubRegion(source, region, mode);
      expect([result.width, result.height]).toEqual([256, 256]);
      expect(Array.from(result.rgb.subarray((20 * 256 + 10) * 3, (20 * 256 + 10) * 3 + 3))).toEqual([255, 0, 0]);
      expect(result.opaqueMask[20 * 256 + 10]).toBe(1);
      expect(result.opaqueMask[20 * 256 + 11]).toBe(mode === 'base' ? 1 : 0);
      expect(result.opaqueMask[0]).toBe(mode === 'base' ? 1 : 0);
    }
  });

  test('clips negative source coordinates without shifting surviving pixels', () => {
    const source = createSolidANSIFrame(2, 1, 10, 20, 30, 1);
    const result = cropBGASubRegion(source, { ...region, sx: -1, ex: 4, dx: 254, dy: 255 }, 'layer');
    expect(result.opaqueMask[255 * 256 + 254]).toBe(0);
    expect(result.opaqueMask[255 * 256 + 255]).toBe(1);
    expect(result.opaqueMask.reduce((total, value) => total + value, 0)).toBe(1);
  });

  test('clips negative destination offsets and out-of-bounds or huge rectangles', () => {
    const source = createSolidANSIFrame(2, 1, 10, 20, 30, 1);
    const result = cropBGASubRegion(source, { ...region, dx: -1, dy: 0 }, 'layer');
    expect(result.opaqueMask[0]).toBe(1);
    expect(result.opaqueMask[1]).toBe(0);
    const empty = cropBGASubRegion(source, { ...region, sx: 999, ex: 1e12 }, 'layer');
    expect(empty.opaqueMask.some(Boolean)).toBe(false);
  });

  test('transforms late streaming frames, retains duration/startup, and reuses existing frame transformations', () => {
    const source: VideoFrameSource = {
      kind: 'video',
      frames: [{ seconds: 0, frame: createSolidANSIFrame(2, 1, 255, 0, 0, 1) }],
      durationSeconds: 2,
      ensureStreaming: vi.fn(),
    };
    const mapped = cropBGAFrameSource(source, [region], 'layer');
    expect(mapped.kind).toBe('video');
    if (mapped.kind !== 'video') throw new Error('Expected a streaming source');
    const first = mapped.frames[0]!.frame;
    mapped.ensureStreaming?.();
    expect(source.ensureStreaming).toHaveBeenCalledOnce();
    source.frames.push({ seconds: 1, frame: createSolidANSIFrame(2, 1, 0, 255, 0, 1) });
    source.durationSeconds = 3;
    expect(mapped.durationSeconds).toBe(3);
    expect(mapped.frames[0]!.frame).toBe(first);
    const selected = selectFrameFromSource(mapped, 1.5);
    expect(selected.index).toBe(1);
    expect(selected.frame!.rgb[(20 * 256 + 10) * 3 + 1]).toBe(255);
    expect(cropBGAFrameSource(source, [], 'layer')).toBe(source);
  });
});
