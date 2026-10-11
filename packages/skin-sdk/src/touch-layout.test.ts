import { describe, expect, it } from 'vite-plus/test';
import { resolveGameplayLayout } from './layout.ts';
import { PLAYFIELD } from './playfield.ts';
import { wideStage } from './stage.ts';
import {
  TOUCH_PLAYFIELD,
  resolveGameplayLaneGeometry,
  resolveTouchLaneLayout,
  supportsTouchLayout,
} from './touch-layout.ts';
import { resolveSkinlessLaneLayout } from './lane-geometry.ts';

const SP5 = ['16', '11', '12', '13', '14', '15'];
const SP7 = [...SP5, '18', '19'];
const DP10 = [...SP5, '21', '22', '23', '24', '25', '26'];
const DP14 = [...SP7, '21', '22', '23', '24', '25', '28', '29', '26'];
const PMS9 = ['11', '12', '13', '14', '15', '22', '23', '24', '25'];

const widths = (lanes: ReadonlyArray<{ w: number }>) => lanes.map((lane) => Math.round(lane.w * 100) / 100);

describe('supportsTouchLayout', () => {
  it('covers the IIDX and PMS modes, not the keyboard modes', () => {
    for (const variant of ['5', '7', '9', '10', '14', undefined] as const)
      expect(supportsTouchLayout(variant)).toBe(true);
    expect(supportsTouchLayout('24')).toBe(false);
    expect(supportsTouchLayout('48')).toBe(false);
  });
});

describe('resolveTouchLaneLayout', () => {
  it('gives 7K equal keys at the width cap and a wider scratch, centred in the touch span', () => {
    const { lanes, left, right } = resolveTouchLaneLayout(SP7, undefined, '7');
    expect(widths(lanes)).toEqual([100.8, 72, 72, 72, 72, 72, 72, 72]);
    expect(lanes[0]!.x).toBe(left);
    expect(right - left).toBeCloseTo(604.8);
    expect((left + right) / 2).toBeCloseTo((TOUCH_PLAYFIELD.left + TOUCH_PLAYFIELD.right) / 2);
  });

  it('keeps lanes edge to edge in display order', () => {
    const { lanes } = resolveTouchLaneLayout(SP7, undefined, '7');
    const byX = [...lanes].sort((a, b) => a.x - b.x);
    for (let index = 1; index < byX.length; index += 1) {
      expect(byX[index]!.x).toBeCloseTo(byX[index - 1]!.x + byX[index - 1]!.w);
    }
  });

  it('caps 5K keys rather than stretching them', () => {
    expect(widths(resolveTouchLaneLayout(SP5, undefined, '5').lanes)).toEqual([100.8, 72, 72, 72, 72, 72]);
  });

  it('lays 9K out as nine equal keys with no scratch', () => {
    const { lanes, left, right } = resolveTouchLaneLayout(PMS9, undefined, '9');
    expect(new Set(widths(lanes))).toEqual(new Set([72]));
    expect(right - left).toBeCloseTo(648);
  });

  it('shares the span out in double play, keeping a gap between the banks', () => {
    const dp10 = resolveTouchLaneLayout(DP10, undefined, '10');
    expect(dp10.lanes[1]!.w).toBeCloseTo((714 - 24) / 12.8);
    expect(dp10.right - dp10.left).toBeCloseTo(714);
    const dp14 = resolveTouchLaneLayout(DP14, undefined, '14');
    expect(dp14.lanes[1]!.w).toBeCloseTo((714 - 24) / 16.8);
    const scratch2P = dp14.lanes[DP14.indexOf('26')]!;
    expect(scratch2P.x + scratch2P.w).toBeCloseTo(dp14.right);
    const key1 = dp14.lanes[DP14.indexOf('21')]!;
    const key7 = dp14.lanes[DP14.indexOf('19')]!;
    expect(key1.x - (key7.x + key7.w)).toBeCloseTo(TOUCH_PLAYFIELD.sideGap);
  });

  it('never leaves the touch span', () => {
    for (const [channels, variant] of [
      [SP5, '5'],
      [SP7, '7'],
      [PMS9, '9'],
      [DP10, '10'],
      [DP14, '14'],
    ] as const) {
      const { left, right } = resolveTouchLaneLayout(channels, undefined, variant);
      expect(left).toBeGreaterThanOrEqual(TOUCH_PLAYFIELD.left - 1e-9);
      expect(right).toBeLessThanOrEqual(TOUCH_PLAYFIELD.right + 1e-9);
    }
  });
});

describe('resolveGameplayLaneGeometry', () => {
  it('is the standard layout by default', () => {
    const standard = resolveSkinlessLaneLayout(SP7, 8, '7');
    expect(resolveGameplayLaneGeometry(SP7, 8, '7')).toEqual({
      mode: 'standard',
      ...standard,
      top: PLAYFIELD.y,
      judgementY: PLAYFIELD.judgementY,
    });
  });

  it('uses the touch layout with its low judgement line when asked', () => {
    const geometry = resolveGameplayLaneGeometry(SP7, 8, '7', 'touch');
    expect(geometry.mode).toBe('touch');
    expect(geometry.judgementY).toBe(TOUCH_PLAYFIELD.judgementY);
    expect(geometry.lanes).toEqual(resolveTouchLaneLayout(SP7, 8, '7').lanes);
  });

  it('keeps the keyboard modes standard even when touch is asked for', () => {
    const channels = Array.from({ length: 24 }, (_, index) => `1${'123456789ABCDEFGHIJKLMNO'[index]}`);
    const geometry = resolveGameplayLaneGeometry(channels, 24, '24', 'touch');
    expect(geometry.mode).toBe('standard');
    expect(geometry.lanes).toEqual(resolveSkinlessLaneLayout(channels, 24, '24').lanes);
  });
});

describe('resolveGameplayLayout in touch mode', () => {
  it('reports the mode, the touch playfield, and no BGA', () => {
    const layout = resolveGameplayLayout({ laneChannels: SP7, playVariant: '7', layoutMode: 'touch' }, wideStage);
    expect(layout.mode).toBe('touch');
    expect(layout.bga).toBeUndefined();
    expect(layout.playfield.judgementY).toBe(TOUCH_PLAYFIELD.judgementY);
    expect(layout.lanes[1]!.w).toBe(72);
    expect(layout.playfield.right).toBeLessThanOrEqual(TOUCH_PLAYFIELD.right);
  });

  it('stays standard (with its BGA) when no mode is given', () => {
    const layout = resolveGameplayLayout({ laneChannels: SP7, playVariant: '7' }, wideStage);
    expect(layout.mode).toBe('standard');
    expect(layout.playfield.judgementY).toBe(PLAYFIELD.judgementY);
    expect(layout.bga).toBeDefined();
  });
});
