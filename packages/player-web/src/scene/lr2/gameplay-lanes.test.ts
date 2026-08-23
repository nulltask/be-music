import { describe, expect, it } from 'vitest';
import {
  isScratchLaneForVariant,
  resolveFallbackLaneLayout,
  shouldPreserveFallbackSideWidth,
} from '../gameplay-lanes.ts';

describe('isScratchLaneForVariant', () => {
  it('treats IIDX scratch channels as scratch lanes', () => {
    expect(isScratchLaneForVariant('16', '7')).toBe(true);
    expect(isScratchLaneForVariant('26', '14')).toBe(true);
  });

  it('keeps channel 16 as a normal lane in 9-key charts', () => {
    expect(isScratchLaneForVariant('16', '9')).toBe(false);
  });
});

describe('resolveFallbackLaneLayout', () => {
  it('makes scratch lanes wider than normal key lanes while fitting the requested width', () => {
    const lanes = resolveFallbackLaneLayout({
      channels: ['16', '11', '12', '13', '14', '15', '18', '19'],
      playVariant: '7',
      x: 33,
      w: 194,
    });

    expect(lanes).toHaveLength(8);
    expect(lanes[0]?.isScratch).toBe(true);
    expect(lanes[0]!.w).toBeGreaterThan(lanes[1]!.w);
    expect(lanes[1]!.x - (lanes[0]!.x + lanes[0]!.w)).toBeCloseTo(2);
    expect(lanes.at(-1)!.x + lanes.at(-1)!.w).toBeCloseTo(33 + 194);
  });

  it('uses equal widths when channels are 9-key lanes', () => {
    const lanes = resolveFallbackLaneLayout({
      channels: ['11', '12', '13', '14', '15', '16', '17', '18', '19'],
      playVariant: '9',
      x: 0,
      w: 200,
    });

    expect(lanes.some((lane) => lane.isScratch)).toBe(false);
    expect(lanes[5]!.w).toBeCloseTo(lanes[0]!.w);
  });

  it('lays the 24 keyboard-mode lanes out left to right at equal width, with no scratch', () => {
    const channels = [...'123456789ABCDEFGHIJKLMNO'].map((lane) => `1${lane}`);
    const lanes = resolveFallbackLaneLayout({ channels, playVariant: '24', x: 33, w: 194 });

    expect(lanes).toHaveLength(24);
    expect(lanes.some((lane) => lane.isScratch)).toBe(false);
    expect(lanes.every((lane) => lane.side === '1P')).toBe(true);
    expect(lanes.every((lane) => lane.w > 0)).toBe(true);
    // Equal widths, strictly increasing x, no overlap, and the bank ends exactly on the requested right edge.
    for (let index = 1; index < lanes.length; index += 1) {
      expect(lanes[index]!.w).toBeCloseTo(lanes[0]!.w);
      expect(lanes[index]!.x).toBeGreaterThanOrEqual(lanes[index - 1]!.x + lanes[index - 1]!.w);
    }
    expect(lanes[0]!.x).toBeCloseTo(33);
    expect(lanes.at(-1)!.x + lanes.at(-1)!.w).toBeCloseTo(33 + 194);
  });

  it('splits the 48 keyboard-mode lanes into 1P / 2P banks with a side gap', () => {
    const lanes = [...'12'].flatMap((side) => [...'123456789ABCDEFGHIJKLMNO'].map((lane) => `${side}${lane}`));
    const rects = resolveFallbackLaneLayout({
      channels: lanes,
      playVariant: '48',
      x: 33,
      w: 194,
      preserveSideWidth: true,
    });

    expect(rects).toHaveLength(48);
    expect(rects.filter((rect) => rect.side === '1P')).toHaveLength(24);
    expect(rects.filter((rect) => rect.side === '2P')).toHaveLength(24);
    // The 2P bank starts strictly right of the 1P bank's trailing edge — the side gap.
    const lastOfP1 = rects[23]!;
    const firstOfP2 = rects[24]!;
    expect(firstOfP2.x).toBeGreaterThan(lastOfP1.x + lastOfP1.w);
    // Per-side width is preserved, so a 48-lane chart extends the playfield instead of squashing each lane.
    const spRects = resolveFallbackLaneLayout({
      channels: lanes.slice(0, 24),
      playVariant: '24',
      x: 33,
      w: 194,
    });
    expect(rects[0]!.w).toBeCloseTo(spRects[0]!.w);
  });

  it('falls back to the requested lane count without scratch weighting', () => {
    const lanes = resolveFallbackLaneLayout({ laneCount: 4, x: 0, w: 100, gap: 0 });

    expect(lanes).toHaveLength(4);
    expect(lanes.every((lane) => lane.w === 25)).toBe(true);
  });

  it('preserves one-side lane widths for double-play fallback layouts', () => {
    const spLanes = resolveFallbackLaneLayout({
      channels: ['16', '11', '12', '13', '14', '15', '18', '19'],
      playVariant: '7',
      x: 33,
      w: 194,
    });
    const dpLanes = resolveFallbackLaneLayout({
      channels: ['16', '11', '12', '13', '14', '15', '18', '19', '26', '21', '22', '23', '24', '25', '28', '29'],
      playVariant: '14',
      x: 33,
      w: 194,
      preserveSideWidth: true,
    });

    expect(dpLanes).toHaveLength(16);
    expect(dpLanes[0]!.w).toBeCloseTo(spLanes[0]!.w);
    expect(dpLanes[1]!.w).toBeCloseTo(spLanes[1]!.w);
    expect(dpLanes.at(-1)!.x + dpLanes.at(-1)!.w).toBeGreaterThan(33 + 194);
  });

  it('places the 2P scratch lane to the right of the 2P key lanes', () => {
    const lanes = resolveFallbackLaneLayout({
      channels: ['16', '11', '12', '13', '14', '15', '18', '19', '26', '21', '22', '23', '24', '25', '28', '29'],
      playVariant: '14',
      x: 33,
      w: 194,
      preserveSideWidth: true,
    });

    const oneScratch = lanes.find((lane) => lane.channel === '16')!;
    const oneKeyLeft = lanes.find((lane) => lane.channel === '11')!;
    const twoScratch = lanes.find((lane) => lane.channel === '26')!;
    const twoKeys = lanes.filter((lane) => lane.channel?.startsWith('2') && lane.channel !== '26');

    expect(oneScratch.x).toBeLessThan(oneKeyLeft.x);
    expect(twoScratch.x).toBeGreaterThan(Math.max(...twoKeys.map((lane) => lane.x)));
    expect(twoScratch.x + twoScratch.w).toBeCloseTo(Math.max(...lanes.map((lane) => lane.x + lane.w)));
  });

  it('inserts a visible gap between 1P and 2P fallback lanes', () => {
    const lanes = resolveFallbackLaneLayout({
      channels: ['16', '11', '12', '13', '14', '15', '18', '19', '26', '21', '22', '23', '24', '25', '28', '29'],
      playVariant: '14',
      x: 33,
      w: 194,
      preserveSideWidth: true,
    });

    const oneRight = Math.max(...lanes.filter((lane) => lane.side === '1P').map((lane) => lane.x + lane.w));
    const twoLeft = Math.min(...lanes.filter((lane) => lane.side === '2P').map((lane) => lane.x));

    expect(twoLeft - oneRight).toBeCloseTo(14);
  });

  it('uses the requested DP side gap when provided', () => {
    const lanes = resolveFallbackLaneLayout({
      channels: ['16', '11', '12', '13', '14', '15', '18', '19', '26', '21', '22', '23', '24', '25', '28', '29'],
      playVariant: '14',
      x: 33,
      w: 194,
      preserveSideWidth: true,
      sideGap: 24,
    });

    const oneRight = Math.max(...lanes.filter((lane) => lane.side === '1P').map((lane) => lane.x + lane.w));
    const twoLeft = Math.min(...lanes.filter((lane) => lane.side === '2P').map((lane) => lane.x));

    expect(twoLeft - oneRight).toBeCloseTo(24);
  });
});

describe('shouldPreserveFallbackSideWidth', () => {
  it('preserves side width for DP variants or detected 2P lanes', () => {
    expect(shouldPreserveFallbackSideWidth(undefined, '14')).toBe(true);
    expect(shouldPreserveFallbackSideWidth(['11', '12', '21'], '7')).toBe(true);
    expect(shouldPreserveFallbackSideWidth(['11', '12', '13'], '7')).toBe(false);
    expect(shouldPreserveFallbackSideWidth(['11', '12', '21'], '9')).toBe(false);
  });
});
