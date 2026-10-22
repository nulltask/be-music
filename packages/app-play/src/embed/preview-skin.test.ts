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
  it('fills the height above the video controls beside narrow lanes', () => {
    expect(resolvePreviewBGARect(184)).toEqual({ x: 208, y: 16, w: 397, h: 397 });
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
