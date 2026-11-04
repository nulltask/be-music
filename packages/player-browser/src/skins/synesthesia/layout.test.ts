import { describe, expect, it } from 'vite-plus/test';
import {
  TALL_STAGE_BGA,
  cabinetStage,
  resolveCabinetLayout,
  resolveGameplayLayout,
  tallStage,
  wideStage,
} from '@be-music/player-skin-sdk';
import { STAGE_SIDE_COLUMN } from '@be-music/player-skin-sdk';
import {
  formatSelectBreadcrumb,
  GROOVE,
  resolveGrooveRect,
  resolveMilestoneSpot,
  resolvePortraitHUDColumn,
} from './layout.ts';

const SP7 = ['16', '11', '12', '13', '14', '15', '18', '19'];

describe('resolveGrooveRect', () => {
  it.each([
    ['SP', SP7, '7', false],
    ['DP', [...SP7, '21', '22', '23', '24', '25', '28', '29', '26'], '14', false],
    ['two-player', SP7, '7', true],
  ] as const)('uses the actual cabinet gauge for %s', (_name, laneChannels, playVariant, twoPlayer) => {
    const layout = resolveGameplayLayout({ laneChannels: [...laneChannels], playVariant, twoPlayer }, cabinetStage);
    expect(resolveGrooveRect(layout)).toEqual(resolveCabinetLayout(layout).gauge);
  });

  it('uses the actual inset cells for landscape touch play', () => {
    const layout = resolveGameplayLayout({ laneChannels: SP7, playVariant: '7', layoutMode: 'touch' }, wideStage);
    expect(resolveGrooveRect(layout)).toEqual({ ...GROOVE, y: GROOVE.y + 2, h: GROOVE.h - 4 });
  });

  it('runs the portrait gauge across the stage between the monitor and the lanes', () => {
    const layout = resolveGameplayLayout({ laneChannels: SP7, playVariant: '7', layoutMode: 'touch' }, tallStage);
    const groove = resolveGrooveRect(layout);
    expect(groove.x + groove.w / 2).toBeCloseTo(tallStage.width / 2);
    expect(groove.y).toBeGreaterThan(layout.bga!.y + layout.bga!.h);
    expect(groove.y + groove.h).toBeLessThan(layout.playfield.top);
  });
});

describe('resolvePortraitHUDColumn', () => {
  it('stacks plate, score and tally beside the monitor without overlap', () => {
    const { plate, score, tally } = resolvePortraitHUDColumn(tallStage, TALL_STAGE_BGA);
    expect(plate.x).toBeGreaterThan(TALL_STAGE_BGA.x + TALL_STAGE_BGA.w);
    expect(plate.x + plate.w).toBe(tallStage.width - 12);
    expect(plate.y).toBe(TALL_STAGE_BGA.y);
    expect(score.y).toBeGreaterThan(plate.y + plate.h);
    expect(tally.y).toBeGreaterThan(score.y + score.h);
    expect(tally.y + tally.h).toBe(TALL_STAGE_BGA.y + TALL_STAGE_BGA.h);
    expect(score.x).toBe(plate.x);
    expect(tally.x).toBe(plate.x);
    expect(tally.w).toBe(plate.w);
    expect(score.h).toBeGreaterThanOrEqual(60);
  });
});

describe('resolveMilestoneSpot', () => {
  it('plays on the monitor when there is one', () => {
    expect(
      resolveMilestoneSpot(resolveGameplayLayout({ laneChannels: SP7, playVariant: '7' }, wideStage)),
    ).toBeUndefined();
    expect(
      resolveMilestoneSpot(
        resolveGameplayLayout({ laneChannels: SP7, playVariant: '7', layoutMode: 'touch' }, tallStage),
      ),
    ).toBeUndefined();
  });

  it('uses the side column under the tally in the landscape touch layout, clear of the lanes and the bottom HUD', () => {
    const layout = resolveGameplayLayout({ laneChannels: SP7, playVariant: '7', layoutMode: 'touch' }, wideStage);
    const spot = resolveMilestoneSpot(layout)!;
    expect(spot.x - spot.w / 2).toBe(STAGE_SIDE_COLUMN.x);
    expect(spot.x - spot.w / 2).toBeGreaterThan(layout.playfield.right);
    expect(spot.y).toBeGreaterThan(236);
    expect(spot.y + 40).toBeLessThan(361);
  });
});

describe('formatSelectBreadcrumb', () => {
  it('shows the library root', () => {
    expect(formatSelectBreadcrumb([], undefined, '')).toBe('Library');
  });
  it('keeps each ancestor in order', () => {
    expect(formatSelectBreadcrumb(['BMS', 'Artist', 'Album'], 'Album', '')).toBe('Library › BMS › Artist › Album');
  });
  it('keeps search scoped to its folder hierarchy', () => {
    expect(formatSelectBreadcrumb(['日本語', '譜面'], '譜面', 'title')).toBe('Library › 日本語 › 譜面 › Search: title');
  });
  it('supports older hosts that only provide the current folder', () => {
    expect(formatSelectBreadcrumb(undefined, 'fixtures', '')).toBe('Library › fixtures');
  });
});
