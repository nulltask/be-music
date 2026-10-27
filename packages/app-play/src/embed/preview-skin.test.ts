import { describe, expect, it } from 'vite-plus/test';
import { resolveGameplayLayout, validateBeMusicSkin } from '@be-music/player-skin-sdk';
import { createPreviewSkin, createPreviewStage, resolvePreviewBGARect } from './preview-skin.ts';

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

describe('createPreviewStage', () => {
  const SP7 = ['16', '11', '12', '13', '14', '15', '18', '19'];

  it.each([
    [640, 480],
    [1138, 480],
    [1039, 480],
  ])('keeps the lanes in the left half and the BGA right of them on a %ix%i stage', (width, height) => {
    const stage = createPreviewStage({ width, height });
    const layout = resolveGameplayLayout({ laneChannels: SP7, playVariant: '7' }, stage);
    expect(layout.stage).toEqual({ width, height });
    expect(layout.playfield.right).toBeLessThanOrEqual(width / 2);
    expect(layout.playfield.judgementY).toBe(height - 60);
    expect(layout.bga!.x).toBeGreaterThanOrEqual(layout.playfield.right);
    expect(layout.bga!.x + layout.bga!.w).toBeLessThanOrEqual(width - 16);
    expect(layout.bga!.w).toBeGreaterThan(0);
  });

  it('stacks the BGA above the lanes on a tall stage of any height', () => {
    for (const height of [640, 1039]) {
      const layout = resolveGameplayLayout(
        { laneChannels: SP7, playVariant: '7' },
        createPreviewStage({ width: 480, height }),
      );
      expect(layout.orientation).toBe('portrait');
      expect(layout.bga!.y + layout.bga!.h).toBeLessThanOrEqual(layout.playfield.top);
      expect(layout.playfield.top).toBeLessThan(layout.playfield.judgementY);
      expect(layout.playfield.judgementY).toBeLessThan(height);
    }
  });

  it('resizes to any size', () => {
    expect(createPreviewStage({ width: 854, height: 480 }).resize?.({ width: 640, height: 480 })).toMatchObject({
      width: 640,
      height: 480,
    });
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

  it('stacks the BGA above the lanes on a tall screen', () => {
    const stage = createPreviewSkin(chrome).portraitStage!;
    const layout = resolveGameplayLayout(
      { laneChannels: ['16', '11', '12', '13', '14', '15', '18', '19'], playVariant: '7' },
      stage,
    );
    expect(layout.orientation).toBe('portrait');
    expect(layout.bga!.y + layout.bga!.h).toBeLessThanOrEqual(layout.playfield.top);
    expect(layout.playfield.top).toBeLessThan(layout.playfield.judgementY);
  });
});
