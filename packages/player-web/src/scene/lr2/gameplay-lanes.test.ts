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
