import {
  TALL_STAGE_HEIGHT,
  TALL_STAGE_WIDTH,
  resolveGameplayLayout,
  tallStage,
  type BeMusicGameplayLayout,
  type BeMusicRect,
} from '@be-music/skin-sdk';
import { describe, expect, it } from 'vite-plus/test';
import {
  PORTRAIT_SELECT_LAYOUT,
  resolvePortraitGameplayHUD,
  resolvePortraitResult,
  resolvePortraitSelectCard,
} from './layout.ts';

const W = TALL_STAGE_WIDTH;
const H = TALL_STAGE_HEIGHT;

function overlaps(a: BeMusicRect, b: BeMusicRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function inside(rect: BeMusicRect, width: number, height: number): boolean {
  return rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= width && rect.y + rect.h <= height;
}

describe('resolvePortraitSelectCard', () => {
  it('fills the width above the song list, its buttons inside it', () => {
    const { card, play, auto } = resolvePortraitSelectCard(W);
    expect(card.x).toBe(16);
    expect(card.x + card.w).toBe(W - 16);
    expect(card.y + card.h).toBeLessThanOrEqual(PORTRAIT_SELECT_LAYOUT.listTop);
    for (const button of [play, auto]) {
      expect(button.y + button.h).toBeLessThanOrEqual(card.y + card.h);
      expect(button.h).toBeGreaterThanOrEqual(44);
    }
    expect(overlaps(play, auto)).toBe(false);
    expect(auto.x + auto.w).toBe(card.x + card.w - 16);
  });

  it('puts the three fact columns side by side above the buttons', () => {
    const { factColumns, factWidth, factRows, play } = resolvePortraitSelectCard(W);
    expect(factColumns[1] - factColumns[0]).toBeGreaterThan(factWidth);
    expect(factColumns[2] + factWidth).toBeLessThanOrEqual(W - 32);
    // A fact is a 10 px label over a 16 px value 16 px under it.
    expect(factRows[1] - factRows[0]).toBeGreaterThanOrEqual(36);
    expect(factRows[1] + 16 + 8).toBeLessThan(play.y);
  });

  it('leaves the list a dozen thumb-sized rows on the tall stage', () => {
    const { listTop, listBottomInset, rowHeight } = PORTRAIT_SELECT_LAYOUT;
    expect(rowHeight).toBeGreaterThanOrEqual(36);
    expect(Math.floor((H - listBottomInset - listTop) / rowHeight)).toBeGreaterThanOrEqual(12);
  });
});

describe('resolvePortraitGameplayHUD', () => {
  const layouts: Array<[string, BeMusicGameplayLayout]> = [
    ['7 KEY touch', resolveGameplayLayout({ laneCount: 8, playVariant: '7', layoutMode: 'touch' }, tallStage)],
    ['5 KEY standard', resolveGameplayLayout({ laneCount: 6, playVariant: '5' }, tallStage)],
    ['9 KEY standard', resolveGameplayLayout({ laneCount: 9, playVariant: '9' }, tallStage)],
  ];

  it.each(layouts)('keeps the %s HUD above the lanes, clear of the BGA and of itself', (_, layout) => {
    expect(layout.orientation).toBe('portrait');
    const hud = resolvePortraitGameplayHUD(layout);
    const rects = [hud.track, ...hud.scores, ...hud.counts, hud.gauge];
    for (const rect of rects) {
      expect(inside(rect, W, H)).toBe(true);
      expect(rect.y + rect.h).toBeLessThanOrEqual(layout.playfield.top);
      expect(rect.y).toBeGreaterThanOrEqual(hud.header.height);
      if (layout.bga) expect(overlaps(rect, layout.bga)).toBe(false);
    }
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) expect(overlaps(rects[i]!, rects[j]!)).toBe(false);
    }
  });

  it('keeps the header text out of the top corners and puts the judgement on the lanes', () => {
    const layout = resolveGameplayLayout({ laneCount: 8, playVariant: '7', layoutMode: 'touch' }, tallStage);
    const hud = resolvePortraitGameplayHUD(layout);
    expect(hud.header).toEqual({ height: 40, left: 52, right: W - 52 });
    expect(hud.judgeY).toBeGreaterThan(layout.playfield.top + 60);
    expect(hud.judgeY).toBeLessThan(layout.playfield.judgementY - 120);
  });

  it('spreads the column across the stage when there is no BGA', () => {
    const layout = resolveGameplayLayout({ laneCount: 8, playVariant: '7' }, tallStage);
    const hud = resolvePortraitGameplayHUD({ ...layout, bga: undefined });
    expect(hud.track).toEqual({ x: 12, y: 46, w: W - 24, h: 56 });
    expect(hud.counts[4].y + hud.counts[4].h).toBeLessThanOrEqual(hud.gauge.y - 14);
  });

  it('follows a portrait stage of another size', () => {
    const stage = { width: 600, height: 1200, resolveBGARect: () => ({ x: 12, y: 50, w: 280, h: 280 }) };
    const layout = resolveGameplayLayout({ laneCount: 8, playVariant: '7' }, stage);
    const hud = resolvePortraitGameplayHUD(layout);
    expect(hud.track.x).toBe(12 + 280 + 12);
    expect(hud.track.x + hud.track.w).toBe(600 - 12);
    expect(hud.gauge.w).toBe(600 - 24);
    expect(hud.gauge.y + hud.gauge.h).toBeLessThanOrEqual(layout.playfield.top);
  });
});

describe('resolvePortraitResult', () => {
  it('stacks the sections down the tall stage without overlap', () => {
    const grid = resolvePortraitResult(W, H);
    const sections = [grid.rank, grid.judges, grid.track];
    for (const rect of [...sections, ...grid.figures]) expect(inside(rect, W, H)).toBe(true);
    expect(grid.rank.y).toBeGreaterThan(grid.verdictY + 12);
    expect(grid.judges.y).toBeGreaterThan(grid.rank.y + grid.rank.h);
    expect(grid.track.y).toBeGreaterThan(grid.judges.y + grid.judges.h);
    expect(grid.track.y + grid.track.h).toBeLessThan(grid.totalY - 10);
    expect(grid.totalY).toBeLessThan(H);
  });

  it('puts the six figures beside the rank, two columns of three', () => {
    const grid = resolvePortraitResult(W, H);
    expect(grid.figures).toHaveLength(6);
    for (const figure of grid.figures) {
      expect(overlaps(figure, grid.rank)).toBe(false);
      expect(figure.y + figure.h).toBeLessThanOrEqual(grid.rank.y + grid.rank.h);
      expect(figure.x + figure.w).toBeLessThanOrEqual(W - 16);
    }
    expect(grid.figures[1]!.x).toBeGreaterThan(grid.figures[0]!.x);
    expect(grid.figures[2]!.y).toBeGreaterThan(grid.figures[0]!.y);
  });

  it('fits the five judgement rows in their panel', () => {
    const grid = resolvePortraitResult(W, H);
    const last = grid.judgeRowsY + 4 * grid.rowPitch;
    expect(grid.judgeRowsY - 8).toBeGreaterThanOrEqual(grid.judges.y);
    expect(last + 8).toBeLessThanOrEqual(grid.judges.y + grid.judges.h);
  });

  it('fits the chart facts and the lamp in their panel, which fits above the total line', () => {
    for (const height of [H, H - 120, H + 100]) {
      const grid = resolvePortraitResult(W, height);
      const lastRow = grid.trackRowsY + 3 * grid.rowPitch;
      expect(grid.trackRowsY).toBeGreaterThanOrEqual(grid.track.y + 70);
      expect(grid.lampY).toBeGreaterThan(lastRow + 16);
      expect(grid.lampY + 12).toBeLessThanOrEqual(grid.track.y + grid.track.h);
      expect(grid.track.y + grid.track.h).toBeLessThan(grid.totalY - 10);
      expect(grid.totalY).toBe(height - 32);
    }
  });
});
