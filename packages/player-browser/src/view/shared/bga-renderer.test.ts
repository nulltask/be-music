import { Texture, TextureSource } from 'pixi.js';
import { DEFAULT_POOR_BGA_DISPLAY_SECONDS } from '@be-music/player-engine/display';
import { describe, expect, test } from 'vite-plus/test';
import { BGA_VIDEO_DRIFT_SECONDS, resolveBGAVideoResync, renderBGA, type BGARendererContext } from './bga-renderer.ts';

describe('resolveBGAVideoResync', () => {
  test('leaves a video in step with the chart alone', () => {
    expect(resolveBGAVideoResync(10, 10 + BGA_VIDEO_DRIFT_SECONDS / 2, 60)).toBeUndefined();
  });

  test('sets a drifted video back to the chart time since its cue, either way', () => {
    expect(resolveBGAVideoResync(10, 30, 60)).toBe(30);
    expect(resolveBGAVideoResync(30, 10, 60)).toBe(10);
  });

  test('leaves a video the chart has played past alone', () => {
    expect(resolveBGAVideoResync(59.9, 75, 60)).toBeUndefined();
    expect(resolveBGAVideoResync(3, 8, Number.NaN)).toBe(8);
    expect(resolveBGAVideoResync(3, -1, 60)).toBeUndefined();
  });
});

describe('POOR BGA on the pause-aware millisecond clock', () => {
  test('shows a miss at time zero, expires exactly at the duration, and rejects future/cleared stamps', () => {
    let nowMs = 0;
    const frames: Array<{ poorActive: boolean }> = [];
    const texture = new Texture({ source: new TextureSource({ resource: new Uint8Array(4), width: 1, height: 1 }) });
    const play = {
      poorBGAMode: 0 as 0 | 1 | 2,
      hasBGA: true,
      lastPoorAt: 0,
      playClock: () => nowMs,
      audioContextStartTime: 0,
      bgaTimeline: { base: [], layer: [], poor: [{ seconds: 0, bmpKey: 'poor' }] },
      bgaTextures: new Map([['poor', texture]]),
      bgaLayerTextures: new Map(),
    };
    const ctx = {
      play,
      options: {},
      bgaLayerPool: { begin: () => {}, end: () => {} },
      bgaTargetsScratch: [],
      skinBGACrops: new Map(),
      playfieldSkin: { bgaTargets: (out: unknown[]) => out.push({ x: 0, y: 0, w: 1, h: 1 }) },
      skinBinding: { drawsBGA: true, setBGA: (frame: { poorActive: boolean }) => frames.push(frame) },
    } as unknown as BGARendererContext;
    const shown = () => {
      renderBGA(ctx, 20);
      return frames.at(-1)?.poorActive;
    };
    expect(shown()).toBe(true);
    play.poorBGAMode = 2;
    expect(shown()).toBe(false);
    play.poorBGAMode = 1;
    expect(shown()).toBe(true);
    expect(frames.at(-1)).toMatchObject({ poorOverlays: true });
    play.poorBGAMode = 0;
    nowMs = DEFAULT_POOR_BGA_DISPLAY_SECONDS * 1000 - 1;
    expect(shown()).toBe(true);
    nowMs += 1;
    expect(shown()).toBe(false);
    play.lastPoorAt = nowMs + 10;
    expect(shown()).toBe(false);
    play.lastPoorAt = -Number.POSITIVE_INFINITY;
    expect(shown()).toBe(false);
    texture.destroy(true);
  });
});
