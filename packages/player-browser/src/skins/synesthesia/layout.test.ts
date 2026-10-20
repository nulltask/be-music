import { describe, expect, it } from 'vite-plus/test';
import { TALL_STAGE_BGA, resolveGameplayLayout, tallStage, wideStage } from '@be-music/player-skin-sdk';
import { STAGE_SIDE_COLUMN } from '@be-music/player-skin-sdk';
import { GROOVE, resolveGrooveRect, resolveMilestoneSpot, resolvePortraitHUDColumn } from './layout.ts';

const SP7 = ['16', '11', '12', '13', '14', '15', '18', '19'];

describe('resolveGrooveRect', () => {
  it('keeps the landscape gauge where it was', () => {
    expect(resolveGrooveRect(resolveGameplayLayout({ laneChannels: SP7, playVariant: '7' }, wideStage))).toBe(GROOVE);
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
