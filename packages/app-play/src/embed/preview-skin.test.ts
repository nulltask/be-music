import { describe, expect, it } from 'vite-plus/test';
import { validateBeMusicSkin } from '@be-music/player-skin-sdk';
import { createPreviewSkin, resolvePreviewBGARect } from './preview-skin.ts';

const chrome = {
  state: () => ({ volume: 1, muted: false, fullscreen: false }),
  subscribe: () => () => {},
  setVolume: () => {},
  toggleFullscreen: () => {},
};

describe('resolvePreviewBGARect', () => {
  it('puts the BGA square in the right pane, against the top edge', () => {
    expect(resolvePreviewBGARect(300)).toEqual({ x: 529, y: 16, w: 232, h: 232 });
  });

  it('stays clear of lanes reaching past the middle', () => {
    const rect = resolvePreviewBGARect(600);
    expect(rect.x).toBeGreaterThanOrEqual(624);
    expect(rect.x + rect.w).toBeLessThanOrEqual(854 - 16);
  });
});

describe('createPreviewSkin', () => {
  it('declares a DOM playfield that draws everything the player would draw over it', () => {
    const skin = createPreviewSkin(chrome);
    expect(validateBeMusicSkin(skin)).toEqual([]);
    expect(skin.gameplay).toMatchObject({
      drawsOnDOM: true,
      drawsBGA: true,
      drawsMines: true,
      drawsLaneCover: true,
      drawsMeasureLines: true,
    });
    expect(skin.stage?.playfield?.standard?.maxRight).toBeLessThanOrEqual(427);
  });
});
