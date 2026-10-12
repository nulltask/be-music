import { describe, expect, it } from 'vite-plus/test';
import { STAGE_BGA_BAND, STAGE_SIDE_COLUMN, STAGE_WIDTH, resolveStageBgaRect } from './stage.ts';

describe('resolveStageBgaRect', () => {
  it('gives single play the full band, centred between the lanes and the side column', () => {
    const rect = resolveStageBgaRect(227);
    expect(rect.w).toBe(STAGE_BGA_BAND.bottom - STAGE_BGA_BAND.top);
    expect(rect.h).toBe(rect.w);
    expect(rect.y).toBe(STAGE_BGA_BAND.top);
    expect(rect.x).toBeGreaterThan(227 + 24);
    expect(rect.x + rect.w).toBeLessThan(STAGE_SIDE_COLUMN.x);
    const leftGap = rect.x - (227 + 32);
    const rightGap = STAGE_SIDE_COLUMN.x - 20 - (rect.x + rect.w);
    expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(1);
  });

  it('shrinks beside a double-play field instead of covering its lanes', () => {
    const rect = resolveStageBgaRect(421);
    expect(rect.w).toBeGreaterThan(200);
    expect(rect.w).toBeLessThan(STAGE_BGA_BAND.bottom - STAGE_BGA_BAND.top);
    expect(rect.x).toBeGreaterThanOrEqual(421 + 32);
    expect(rect.x + rect.w).toBeLessThanOrEqual(STAGE_SIDE_COLUMN.x - 20);
    // Still centred vertically in the band.
    expect(Math.abs(rect.y + rect.h / 2 - (STAGE_BGA_BAND.top + STAGE_BGA_BAND.bottom) / 2)).toBeLessThanOrEqual(1);
  });

  it('hides the BGA when a page-wide keyboard field leaves no usable room', () => {
    const rect = resolveStageBgaRect(628);
    expect(rect.w).toBe(0);
    expect(rect.h).toBe(0);
  });

  it('stays on the 16:9 canvas', () => {
    expect(STAGE_WIDTH).toBe(854);
    expect(STAGE_SIDE_COLUMN.x + STAGE_SIDE_COLUMN.w).toBeLessThanOrEqual(STAGE_WIDTH - 16);
  });
});
