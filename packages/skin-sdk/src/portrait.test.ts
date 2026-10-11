import { describe, expect, it } from 'vite-plus/test';
import { resolveGameplayLayout } from './layout.ts';
import {
  PORTRAIT_PLAYFIELD,
  TALL_STAGE_BGA,
  TALL_STAGE_HEIGHT,
  TALL_STAGE_WIDTH,
  resolveBeMusicSelectLayout,
  resolveBeMusicStage,
  resolvePortraitLaneLayout,
  resolveStageOrientation,
  supportsPortraitLayout,
  tallStage,
} from './portrait.ts';
import { wideStage } from './stage.ts';
import { resolveGameplayLaneGeometry } from './touch-layout.ts';

const SP5 = ['16', '11', '12', '13', '14', '15'];
const SP7 = [...SP5, '18', '19'];
const DP14 = [...SP7, '21', '22', '23', '24', '25', '28', '29', '26'];
const PMS9 = ['11', '12', '13', '14', '15', '22', '23', '24', '25'];
const PHONE = { width: 390, height: 844 };
const LANDSCAPE_PHONE = { width: 844, height: 390 };

const round = (value: number) => Math.round(value * 100) / 100;

describe('resolveStageOrientation', () => {
  it('reads taller than wide as portrait, anything else as landscape', () => {
    expect(resolveStageOrientation(PHONE)).toBe('portrait');
    expect(resolveStageOrientation(LANDSCAPE_PHONE)).toBe('landscape');
    expect(resolveStageOrientation({ width: 600, height: 600 })).toBe('landscape');
    expect(resolveStageOrientation(tallStage)).toBe('portrait');
  });
});

describe('supportsPortraitLayout', () => {
  it('takes single play up to 9 lanes and leaves double play and the keyboard modes landscape', () => {
    for (const variant of ['5', '7', '9'] as const) expect(supportsPortraitLayout(undefined, variant)).toBe(true);
    for (const variant of ['10', '14', '24', '48'] as const)
      expect(supportsPortraitLayout(undefined, variant)).toBe(false);
  });

  it('decides by lane count without a play variant', () => {
    expect(supportsPortraitLayout(SP7)).toBe(true);
    expect(supportsPortraitLayout(PMS9)).toBe(true);
    expect(supportsPortraitLayout(DP14)).toBe(false);
    expect(supportsPortraitLayout(undefined)).toBe(true);
  });
});

describe('resolveBeMusicStage', () => {
  const skin = { stage: wideStage, portraitStage: tallStage };

  it('picks the portrait stage on a portrait screen', () => {
    expect(resolveBeMusicStage(skin, PHONE)).toBe(tallStage);
    expect(resolveBeMusicStage(skin, { width: 820, height: 1180 })).toBe(tallStage);
  });

  it('keeps the landscape stage on a landscape screen', () => {
    expect(resolveBeMusicStage(skin, LANDSCAPE_PHONE)).toBe(wideStage);
  });

  it('keeps the landscape stage for a skin without a portrait one', () => {
    expect(resolveBeMusicStage({ stage: wideStage }, PHONE)).toBe(wideStage);
    expect(resolveBeMusicStage({}, PHONE)).toBe(wideStage);
  });

  it('keeps charts too wide for a portrait playfield on the landscape stage', () => {
    expect(resolveBeMusicStage(skin, PHONE, { laneChannels: SP7, playVariant: '7' })).toBe(tallStage);
    expect(resolveBeMusicStage(skin, PHONE, { laneChannels: DP14, playVariant: '14' })).toBe(wideStage);
    expect(resolveBeMusicStage(skin, PHONE, { playVariant: '48' })).toBe(wideStage);
  });
});

describe('resolveBeMusicSelectLayout', () => {
  const layout = { listX: 322, listTop: 56, listBottomInset: 28, rowHeight: 28 };
  const portraitLayout = { listX: 12, listTop: 360, listBottomInset: 60, rowHeight: 40 };

  it('uses the portrait layout on a portrait stage', () => {
    expect(resolveBeMusicSelectLayout({ layout, portraitLayout }, tallStage)).toBe(portraitLayout);
    expect(resolveBeMusicSelectLayout({ layout, portraitLayout }, wideStage)).toBe(layout);
  });

  it('falls back to the landscape layout', () => {
    expect(resolveBeMusicSelectLayout({ layout }, tallStage)).toBe(layout);
  });
});

describe('resolvePortraitLaneLayout', () => {
  it('fills the stage between its margins with equal touch keys and a wider scratch', () => {
    const { lanes, left, right, top, judgementY } = resolvePortraitLaneLayout(SP7, 8, '7', 'touch', tallStage);
    const key = (TALL_STAGE_WIDTH - 2 * PORTRAIT_PLAYFIELD.margin) / (7 + PORTRAIT_PLAYFIELD.scratchWeight);
    expect(lanes.map((lane) => round(lane.w))).toEqual([
      round(key * PORTRAIT_PLAYFIELD.scratchWeight),
      ...Array.from({ length: 7 }, () => round(key)),
    ]);
    expect(left).toBeCloseTo(PORTRAIT_PLAYFIELD.margin);
    expect(right).toBeCloseTo(TALL_STAGE_WIDTH - PORTRAIT_PLAYFIELD.margin);
    expect(top).toBe(PORTRAIT_PLAYFIELD.top);
    expect(judgementY).toBe(PORTRAIT_PLAYFIELD.judgementY.touch);
  });

  it('gives 5K wider keys than 7K across the same span', () => {
    const five = resolvePortraitLaneLayout(SP5, 6, '5', 'touch', tallStage);
    const seven = resolvePortraitLaneLayout(SP7, 8, '7', 'touch', tallStage);
    expect(five.lanes[1]!.w).toBeGreaterThan(seven.lanes[1]!.w);
    expect(five.right - five.left).toBeCloseTo(seven.right - seven.left);
  });

  it('caps the keys of a short lane set and centres the narrower field', () => {
    const { lanes, left, right } = resolvePortraitLaneLayout(['11', '12', '13'], 3, undefined, 'touch', tallStage);
    expect(lanes.map((lane) => lane.w)).toEqual([96, 96, 96]);
    expect((left + right) / 2).toBeCloseTo(TALL_STAGE_WIDTH / 2);
  });

  it('gives 9K nine equal touch lanes in display order', () => {
    const { lanes } = resolvePortraitLaneLayout(PMS9, 9, '9', 'touch', tallStage);
    expect(new Set(lanes.map((lane) => round(lane.w))).size).toBe(1);
    for (let index = 1; index < lanes.length; index += 1) {
      expect(lanes[index]!.x).toBeCloseTo(lanes[index - 1]!.x + lanes[index - 1]!.w);
    }
  });

  it('keeps the cabinet key widths in the standard layout, centred, with a lower judgement line', () => {
    const { lanes, left, right, judgementY } = resolvePortraitLaneLayout(SP7, 8, '7', 'standard', tallStage);
    expect(right - left).toBeCloseTo(PORTRAIT_PLAYFIELD.standardWidth);
    expect((left + right) / 2).toBeCloseTo(TALL_STAGE_WIDTH / 2);
    // Scratch, then white / black keys as on the cabinet (41 : 24 : 19).
    expect(lanes[0]!.w / lanes[1]!.w).toBeCloseTo(41 / 24);
    expect(lanes[2]!.w / lanes[1]!.w).toBeCloseTo(19 / 24);
    expect(judgementY).toBe(PORTRAIT_PLAYFIELD.judgementY.standard);
  });

  it('scales with the portrait stage it is given', () => {
    const big = resolvePortraitLaneLayout(SP7, 8, '7', 'touch', { width: 960, height: 1708 });
    const base = resolvePortraitLaneLayout(SP7, 8, '7', 'touch', tallStage);
    expect(big.right).toBeCloseTo(base.right * 2);
    expect(big.judgementY).toBeCloseTo(base.judgementY * 2);
  });
});

describe('resolveGameplayLaneGeometry on a portrait stage', () => {
  it('lays the portrait playfield out in either mode', () => {
    const geometry = resolveGameplayLaneGeometry(SP7, 8, '7', 'touch', tallStage);
    expect(geometry.orientation).toBe('portrait');
    expect(geometry.mode).toBe('touch');
    expect(geometry.lanes).toEqual(resolvePortraitLaneLayout(SP7, 8, '7', 'touch', tallStage).lanes);
    expect(resolveGameplayLaneGeometry(SP7, 8, '7', 'standard', tallStage).judgementY).toBe(
      PORTRAIT_PLAYFIELD.judgementY.standard,
    );
  });

  it('keeps the landscape geometry on a landscape stage', () => {
    expect(resolveGameplayLaneGeometry(SP7, 8, '7', 'touch', wideStage)).toEqual(
      resolveGameplayLaneGeometry(SP7, 8, '7', 'touch'),
    );
  });
});

describe('resolveGameplayLayout on the tall stage', () => {
  it('reports the orientation and keeps the BGA above the lanes in both modes', () => {
    for (const layoutMode of ['standard', 'touch'] as const) {
      const layout = resolveGameplayLayout({ laneChannels: SP7, playVariant: '7', layoutMode }, tallStage);
      expect(layout.orientation).toBe('portrait');
      expect(layout.stage).toEqual({ width: TALL_STAGE_WIDTH, height: TALL_STAGE_HEIGHT });
      expect(layout.bga).toEqual(TALL_STAGE_BGA);
      expect(layout.bga!.y + layout.bga!.h).toBeLessThan(layout.playfield.top);
    }
  });

  it('reports landscape on the wide stage', () => {
    expect(resolveGameplayLayout({ laneChannels: SP7, playVariant: '7' }, wideStage).orientation).toBe('landscape');
  });
});
