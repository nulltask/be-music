import { keyBoundBGAResourceKey } from '../../chart/key-bound-bga.ts';
import { Rectangle, Sprite, Texture, TextureSource } from 'pixi.js';
import { DEFAULT_POOR_BGA_DISPLAY_SECONDS } from '@be-music/player-engine/display';
import { createEmptyJSON } from '@be-music/chart-source';
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
      bgaLayerTextures: new Map<string, Texture>([
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

  test('draws engine-driven layer and POOR frames beyond the legacy window and uses their video clocks', () => {
    const state = setup();
    const video = {
      currentTime: 0,
      duration: 10,
      playbackRate: 1,
      paused: false,
      seeking: false,
      play: vi.fn(async () => {}),
      pause: vi.fn(),
    };
    state.play.bgaVideos.set('first', { video, objectURL: 'blob:sequence' });
    Object.assign(state.play, {
      engineFrame: {
        bmsonBGA: { plane: 'layer', key: 'first', startedSeconds: 1, frameStartSeconds: 2.5, playbackRate: 2 },
      },
    });
    renderBGA(state.ctx, 3);
    expect(video.currentTime).toBe(1);
    expect(video.playbackRate).toBe(2);
    expect(state.labels()).toContain('bga/layer[key=first]');
    Object.assign(state.play, {
      engineFrame: { bmsonBGA: { plane: 'poor', key: 'poor', startedSeconds: 1, frameStartSeconds: 2.8 } },
    });
    renderBGA(state.ctx, 3);
    expect(state.labels()).toEqual(['bga/background', 'bga/poor[key=poor]']);
    Object.assign(state.play, {
      engineFrame: { bmsonBGA: { plane: 'poor', startedSeconds: 1, frameStartSeconds: 2.8 } },
      poorBGAFallbackKey: 'poor',
      poorBGAFallbackUntilSeconds: Infinity,
    });
    renderBGA(state.ctx, 3);
    expect(state.labels()).not.toContain('bga/poor[key=poor]');
    Object.assign(state.play, { engineFrame: {} });
    renderBGA(state.ctx, 3);
    expect(state.labels()).toContain('bga/base[key=base]');
    expect(video.pause).toHaveBeenCalled();
    state.dispose();
  });

  test.each([0, 1] as const)('places input-bound SWBGA above POOR mode %s and removes it on release', (mode) => {
    const state = setup(mode);
    const key = keyBoundBGAResourceKey('61', '00');
    state.play.bgaLayerTextures.set(key, state.textures[1]!);
    state.play.lastPoorAt = 0;
    const frame = {
      keyBoundBGA: {
        definitionId: '61',
        channel: '11',
        bmpKey: '00',
        startedSeconds: 2,
        frameStartSeconds: 2,
        argb: { a: 255, r: 255, g: 255, b: 255 },
      },
    };
    Object.assign(state.play, { engineFrame: frame });
    renderBGA(state.ctx, 3);
    expect(state.labels().at(-1)).toBe(`bga/layer2[key=${key}]`);
    expect(state.labels()).toContain('bga/poor[key=poor]');
    Object.assign(state.play, { engineFrame: {} });
    renderBGA(state.ctx, 3);
    expect(state.labels().at(-1)).toBe('bga/poor[key=poor]');
    state.dispose();
  });

  test('uses a FIT SWBGA movie rate for initial seek, live playback and drift correction', () => {
    const state = setup();
    const key = keyBoundBGAResourceKey('stage:1:61', '00');
    const video = {
      currentTime: 0,
      duration: 10,
      playbackRate: 1,
      paused: false,
      seeking: false,
      play: vi.fn(async () => {}),
      pause: vi.fn(),
    };
    Object.assign(state.play, {
      engineFrame: {
        keyBoundBGA: {
          definitionId: 'stage:1:61',
          channel: '11',
          bmpKey: '00',
          startedSeconds: 2,
          frameStartSeconds: 2,
          playbackRate: 2,
          argb: { a: 0, r: 0, g: 0, b: 0 },
        },
      },
    });
    state.play.bgaVideos.set(key, { video, objectURL: 'blob:fit' });
    state.play.bgaLayerTextures.set(key, state.textures[1]!);
    state.play.tempo = 1.5;
    renderBGA(state.ctx, 3);
    expect(video.currentTime).toBe(2);
    expect(video.playbackRate).toBe(3);
    video.currentTime = 0;
    renderBGA(state.ctx, 3.5);
    expect(video.currentTime).toBe(3);
    Object.assign(state.play, { engineFrame: {} });
    renderBGA(state.ctx, 3.6);
    expect(video.pause).toHaveBeenCalled();
    state.dispose();
  });

  test('draws both overlays in order, clears only 0A, and restores it on backward seek', () => {
    const state = setup();
    renderBGA(state.ctx, 3);
    expect(state.labels()).toEqual([
      'bga/background',
      'bga/base[key=base]',
      'bga/layer[key=first]',
      'bga/layer2[key=second]',
    ]);
    renderBGA(state.ctx, 5);
    expect(state.labels()).toEqual(['bga/background', 'bga/base[key=base]', 'bga/layer[key=first]']);
    renderBGA(state.ctx, 3);
    expect(state.labels()).toHaveLength(4);
    expect(state.sprites[0]).toMatchObject({ label: 'bga/background', tint: 0, x: 0, y: 0, width: 256, height: 256 });
    state.dispose();
  });

  test('ignores per-slot EXBMP/ARGB and applies the selected plane controls', () => {
    const state = setup();
    const chart = createEmptyJSON('bms');
    chart.bms.exBMP['first'] = '64,255,128,64 colors.png';
    Object.assign(state.play, { resolvedChart: chart });
    renderBGA(state.ctx, 3);
    const sprite = () => state.sprites.find((entry) => entry.label === 'bga/layer[key=first]')!;
    expect(sprite().tint).toBe(0xffffff);
    expect(sprite().alpha).toBe(1);
    chart.bms.argb['first'] = '128,64,128,192';
    renderBGA(state.ctx, 3);
    expect(sprite().tint).toBe(0xffffff);
    expect(sprite().alpha).toBe(1);
    Object.assign(state.play.bgaTimeline, {
      opacity: { base: [], layer: [{ seconds: 0, opacity: 128 / 255, tint: 0x4080c0 }], layer2: [], poor: [] },
    });
    renderBGA(state.ctx, 3);
    expect(sprite().tint).toBe(0x4080c0);
    expect(sprite().alpha).toBeCloseTo(128 / 255);
    state.dispose();
  });

  test('multiplies each plane opacity by the skin alpha and uses the frozen cue clock', () => {
    const state = setup(1);
    Object.assign(state.play.bgaTimeline, {
      opacity: {
        base: [
          { seconds: 2, opacity: 0.5, tint: 0xff8040 },
          { seconds: 4, opacity: 1, tint: 0xff8040 },
        ],
        layer: [{ seconds: 2, opacity: 0.25, tint: 0x4080ff }],
        layer2: [{ seconds: 2, opacity: 0.125, tint: 0x80ff40 }],
        poor: [{ seconds: 2, opacity: 0.75, tint: 0xff4080 }],
      },
    });
    Object.assign(state.ctx.playfieldSkin, {
      bgaTargets: (out: unknown[]) =>
        out.push({
          x: 0,
          y: 0,
          w: 256,
          h: 256,
          applyToSprite: (sprite: Sprite) => {
            sprite.alpha = 0.6;
            sprite.tint = 0x808080;
          },
        }),
    });
    state.play.lastPoorAt = 0;
    renderBGA(state.ctx, 3);
    const alpha = (name: string) => state.sprites.find((sprite) => sprite.label.startsWith(`bga/${name}[`))!.alpha;
    expect(alpha('base')).toBeCloseTo(0.3);
    expect(alpha('layer')).toBeCloseTo(0.15);
    expect(alpha('layer2')).toBeCloseTo(0.075);
    expect(alpha('poor')).toBeCloseTo(0.45);
    const tint = (name: string) => state.sprites.find((sprite) => sprite.label.startsWith(`bga/${name}[`))!.tint;
    expect(['base', 'layer', 'layer2', 'poor'].map(tint)).toEqual([0x804020, 0x204080, 0x408020, 0x802040]);
    renderBGA(state.ctx, 10, 3);
    expect(alpha('base')).toBeCloseTo(0.3);
    renderBGA(state.ctx, 1.5);
    expect(alpha('base')).toBeCloseTo(0.6);
    expect(tint('base')).toBe(0x808080);
    state.dispose();
  });

  test('passes every NONSTOP stack and its own opacity to a Canvas skin', () => {
    const state = setup();
    const frames: Array<{ stacks?: Array<{ alpha: number; opacity?: { base: number } }> }> = [];
    const timeline = { base: [{ seconds: 0, bmpKey: 'base' }], layer: [], poor: [] };
    const opacity = (value: number) => ({ base: [{ seconds: 0, opacity: value }], layer: [], layer2: [], poor: [] });
    Object.assign(state.play, { nonstopBGATimelines: [timeline, timeline] });
    Object.assign(state.ctx.options, {
      nonstop: {
        stages: [
          {
            windowStart: 0,
            windowEnd: 2,
            bmpKeys: ['base'],
            bgaOpacity: opacity(0.5),
            bgaFadeOut: { start: 2, end: 4 },
          },
          { windowStart: 2, windowEnd: 4, bmpKeys: [], bgaOpacity: opacity(0.25), bgaFadeIn: { start: 0, end: 2 } },
        ],
      },
    });
    Object.assign(state.ctx, {
      skinBinding: { drawsBGA: true, setBGA: (frame: (typeof frames)[number]) => frames.push(frame) },
      skinBGACrops: new Map(),
    });
    renderBGA(state.ctx, 1);
    expect(frames[0]!.stacks!.map((stack) => [stack.alpha, stack.opacity?.base])).toEqual([
      [1, 0.5],
      [0.5, 0.25],
    ]);
    state.dispose();
  });

  test.each(['base', 'layer', 'layer2', 'poor'] as const)(
    'keeps both NONSTOP %s videos synchronized across the whole overlap and seek',
    (track) => {
      const state = setup(1);
      const video = () => {
        const value = {
          paused: true,
          seeking: false,
          currentTime: 0,
          duration: 60,
          play: vi.fn(async () => {
            value.paused = false;
          }),
          pause: vi.fn(() => {
            value.paused = true;
          }),
        };
        return value;
      };
      const outgoing = video(),
        incoming = video();
      state.play.bgaVideos.set('outgoing', { video: outgoing, objectURL: 'outgoing' });
      state.play.bgaVideos.set('incoming', { video: incoming, objectURL: 'incoming' });
      for (const key of ['outgoing', 'incoming']) {
        state.play.bgaTextures.set(key, state.textures[0]!);
        state.play.bgaLayerTextures.set(key, state.textures[0]!);
      }
      const timeline = (key: string, seconds: number) => ({
        base: [],
        layer: [],
        layer2: [],
        poor: [],
        [track]: [{ seconds, bmpKey: key }],
      });
      Object.assign(state.play, { nonstopBGATimelines: [timeline('outgoing', 0), timeline('incoming', 5)] });
      Object.assign(state.ctx.options, {
        nonstop: {
          stages: [
            { windowStart: 0, windowEnd: 8, bmpKeys: ['outgoing'], poorBGAMode: 1, bgaFadeOut: { start: 8, end: 11 } },
            {
              windowStart: 8,
              windowEnd: Infinity,
              bmpKeys: ['incoming'],
              poorBGAMode: 1,
              bgaFadeIn: { start: 5, end: 8 },
            },
          ],
        },
      });
      state.play.lastPoorAt = 0;
      state.play.audioContextStartTime = 0;
      renderBGA(state.ctx, 6);
      expect(outgoing.play).not.toHaveBeenCalled();
      expect(incoming.play).not.toHaveBeenCalled();
      state.play.audioContextStartTime = 1;
      renderBGA(state.ctx, 6);
      expect([outgoing.currentTime, incoming.currentTime]).toEqual([6, 1]);
      expect([outgoing.paused, incoming.paused]).toEqual([false, false]);
      renderBGA(state.ctx, 9);
      expect([outgoing.currentTime, incoming.currentTime]).toEqual([9, 4]);
      expect(outgoing.play).toHaveBeenCalledOnce();
      expect(incoming.play).toHaveBeenCalledOnce();
      renderBGA(state.ctx, 10, 6); // Frozen cue clock still allows already-started movies to advance.
      expect([outgoing.currentTime, incoming.currentTime]).toEqual([10, 5]);
      renderBGA(state.ctx, 12);
      expect(outgoing.paused).toBe(true);
      expect(incoming.currentTime).toBe(7);
      expect(incoming.play).toHaveBeenCalledOnce();
      expect(state.ctx.play.bgaActiveVideos[`${track}:outgoing`]).toBeUndefined();
      renderBGA(state.ctx, 6);
      expect([outgoing.currentTime, incoming.currentTime]).toEqual([6, 1]);
      expect(outgoing.play).toHaveBeenCalledTimes(2);
      outgoing.pause();
      incoming.pause();
      state.play.paused = true;
      state.ctx.play.bgaActiveVideos = {};
      renderBGA(state.ctx, 9);
      expect([outgoing.currentTime, incoming.currentTime]).toEqual([9, 4]);
      expect([outgoing.paused, incoming.paused]).toEqual([true, true]);
      expect(Object.keys(state.ctx.play.bgaActiveVideos)).toHaveLength(2);
      state.dispose();
    },
  );

  test.each([0, 1, 2] as const)('POORBGA %s replaces, overlays or disables POOR over both layers', (mode) => {
    const state = setup(mode);
    state.play.lastPoorAt = 0;
    renderBGA(state.ctx, 3);
    expect(state.labels()).toEqual(
      mode === 0
        ? ['bga/background', 'bga/poor[key=poor]']
        : [
            'bga/background',
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

  test.each([false, true])('refreshes a Canvas skin video crop and its origin (whole source=%s)', (wholeSource) => {
    const state = setup();
    const video = {
      videoWidth: 512,
      videoHeight: 256,
      paused: true,
      seeking: false,
      currentTime: 0,
      duration: 60,
      play: vi.fn(async () => {}),
      pause: vi.fn(),
    };
    const texture = new Texture({
      source: new TextureSource({ resource: video, width: wholeSource ? 64 : 512, height: wholeSource ? 128 : 256 }),
      frame: new Rectangle(wholeSource ? 0 : 256, 0, 64, 128),
    });
    state.play.bgaLayerTextures.set('first', texture);
    state.play.bgaVideos.set('first', { video, objectURL: 'blob:crop' });
    state.play.bgaSubRegionOrigins.set('first', { x: 32, y: 64 });
    const drawImage = vi.fn(),
      clearRect = vi.fn();
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage, clearRect }) };
    const frames: Array<{ layer?: unknown; origins?: unknown }> = [];
    Object.assign(state.ctx, {
      skinBinding: { drawsBGA: true, setBGA: (frame: (typeof frames)[number]) => frames.push(frame) },
      skinBGACrops: new Map(),
    });
    vi.stubGlobal('document', { createElement: () => canvas });
    try {
      renderBGA(state.ctx, 3);
      renderBGA(state.ctx, 3.5);
      expect(frames.map((frame) => frame.layer)).toEqual([canvas, canvas]);
      expect(frames[1]?.origins).toEqual({ layer: { x: 32, y: 64 } });
      expect(drawImage).toHaveBeenCalledTimes(2);
      expect(drawImage).toHaveBeenLastCalledWith(video, wholeSource ? 0 : 256, 0, 64, 128, 0, 0, 64, 128);
      expect(clearRect).toHaveBeenCalledTimes(2);
      expect(state.ctx.skinBGACrops.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      texture.destroy(true);
      state.dispose();
    }
  });

  test('keeps an overlay POOR video independent from the base and pauses it when the miss expires', () => {
    const state = setup(1);
    const video = () => ({
      paused: true,
      seeking: false,
      currentTime: 0,
      duration: 60,
      play: vi.fn(async () => {}),
      pause: vi.fn(),
    });
    const base = video(),
      poor = video();
    const key = String.fromCharCode(0) + 'poor:poor';
    state.play.bgaVideos.set('base', { video: base, objectURL: 'blob:base' });
    state.play.bgaVideos.set(key, { video: poor, objectURL: 'blob:poor' });
    state.play.bgaTextures.set(key, state.textures[3]!);
    state.play.bgaTimeline.poor = [{ seconds: 1, bmpKey: 'poor' }];
    state.play.lastPoorAt = 0;
    renderBGA(state.ctx, 3);
    expect(base.currentTime).toBe(3);
    expect(poor.currentTime).toBe(2);
    expect(state.ctx.play.bgaActiveVideos.poor).toEqual({ key, cueSeconds: 1 });
    poor.paused = false;
    state.play.lastPoorAt = -Infinity;
    renderBGA(state.ctx, 4);
    expect(poor.pause).toHaveBeenCalledOnce();
    expect(state.ctx.play.bgaActiveVideos.poor).toBeUndefined();
    state.dispose();
  });
});
