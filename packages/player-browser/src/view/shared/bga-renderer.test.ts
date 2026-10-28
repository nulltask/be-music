import { Sprite, Texture, TextureSource } from 'pixi.js';
import { DEFAULT_POOR_BGA_DISPLAY_SECONDS } from '@be-music/player-engine/display';
import { describe, expect, test, vi } from 'vite-plus/test';
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

describe('two BMS overlays on the built-in/LR2 renderer', () => {
  function setup(mode: 0 | 1 | 2 = 0) {
    const textures = ['base', 'first', 'second', 'poor'].map(
      () =>
        new Texture({
          source: new TextureSource({ resource: new Uint8Array(4), width: 256, height: 256 }),
        }),
    );
    const sprites: Sprite[] = [];
    const play = {
      poorBGAMode: mode,
      hasBGA: true,
      lastPoorAt: -Infinity,
      playClock: () => 0,
      audioContextStartTime: 1,
      tempo: 1,
      paused: false,
      bgaActiveVideos: {},
      bgaVideos: new Map(),
      bgaSubRegionOrigins: new Map(),
      switchingBGAs: new Map(),
      bgaTimeline: {
        base: [{ seconds: 0, bmpKey: 'base' }],
        layer: [
          { seconds: 1, bmpKey: 'first' },
          { seconds: 10, bmpKey: 'first' },
        ],
        layer2: [
          { seconds: 2, bmpKey: 'second' },
          { seconds: 4, bmpKey: undefined },
        ],
        poor: [{ seconds: 0, bmpKey: 'poor' }],
      },
      bgaTextures: new Map([
        ['base', textures[0]!],
        ['poor', textures[3]!],
      ]),
      bgaLayerTextures: new Map([
        ['first', textures[1]!],
        ['second', textures[2]!],
      ]),
    };
    const ctx = {
      play,
      options: {},
      bgaTargetsScratch: [],
      bgaLayerPool: {
        begin: () => {
          sprites.splice(0).forEach((sprite) => sprite.destroy());
        },
        end() {},
        acquireSprite: () => {
          const sprite = new Sprite();
          sprites.push(sprite);
          return sprite;
        },
      },
      playfieldSkin: {
        bgaTargets: (out: unknown[]) => out.push({ x: 0, y: 0, w: 256, h: 256, applyToSprite: () => undefined }),
      },
    } as unknown as BGARendererContext;
    return {
      ctx,
      play,
      textures,
      sprites,
      labels: () => sprites.map((sprite) => sprite.label),
      dispose: () => {
        sprites.forEach((sprite) => sprite.destroy());
        textures.forEach((texture) => texture.destroy(true));
      },
    };
  }

  test('draws both overlays in order, clears only 0A, and restores it on backward seek', () => {
    const state = setup();
    renderBGA(state.ctx, 3);
    expect(state.labels()).toEqual(['bga/base[key=base]', 'bga/layer[key=first]', 'bga/layer2[key=second]']);
    renderBGA(state.ctx, 5);
    expect(state.labels()).toEqual(['bga/base[key=base]', 'bga/layer[key=first]']);
    renderBGA(state.ctx, 3);
    expect(state.labels()).toHaveLength(3);
    state.dispose();
  });

  test.each([0, 1, 2] as const)('POORBGA %s replaces, overlays or disables POOR over both layers', (mode) => {
    const state = setup(mode);
    state.play.lastPoorAt = 0;
    renderBGA(state.ctx, 3);
    expect(state.labels()).toEqual(
      mode === 0
        ? ['bga/poor[key=poor]']
        : [
            'bga/base[key=base]',
            'bga/layer[key=first]',
            'bga/layer2[key=second]',
            ...(mode === 1 ? ['bga/poor[key=poor]'] : []),
          ],
    );
    state.dispose();
  });

  test('keeps independently anchored overlay videos alive through clear and paused seek', () => {
    const state = setup();
    function video() {
      const value = {
        paused: true,
        seeking: false,
        ended: false,
        currentTime: 0,
        duration: 60,
        playbackRate: 1,
        play: vi.fn(async () => {
          value.paused = false;
        }),
        pause: vi.fn(() => {
          value.paused = true;
        }),
      };
      return value;
    }
    const first = video(),
      second = video();
    state.play.bgaVideos.set('first', { video: first, objectURL: 'first' });
    state.play.bgaVideos.set('second', { video: second, objectURL: 'second' });
    renderBGA(state.ctx, 3);
    expect(first.currentTime).toBe(2);
    expect(second.currentTime).toBe(1);
    renderBGA(state.ctx, 5);
    expect(first.paused).toBe(false);
    expect(second.paused).toBe(true);
    renderBGA(state.ctx, 11);
    expect(first.currentTime).toBe(1); // another cue on 07 restarts the same BMP
    first.pause();
    second.pause();
    state.play.paused = true;
    state.play.bgaActiveVideos = {};
    renderBGA(state.ctx, 3);
    expect(first.currentTime).toBe(2);
    expect(second.currentTime).toBe(1);
    expect(first.paused).toBe(true);
    expect(second.paused).toBe(true);
    state.dispose();
  });
});
