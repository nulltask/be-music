import { keyBoundBGAResourceKey } from '../../../chart/key-bound-bga.ts';
import { Sprite, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it, vi } from 'vite-plus/test';
import type { BeatorajaSkin } from '@be-music/skin-beatoraja';
import { BeatorajaBGALayer } from './bga.ts';

function fakeTexture(): Texture {
  return new Texture({ source: new TextureSource({ resource: new Uint8Array(4), width: 1, height: 1 }) });
}

function skin(): BeatorajaSkin {
  return {
    type: 0,
    w: 1280,
    h: 720,
    bga: { id: 'bga' },
    destination: [
      {
        id: 'bga',
        timer: 0,
        loop: -1,
        offset: 0,
        dst: [{ time: 0, x: 100, y: 120, w: 320, h: 240, a: 255, r: 255, g: 255, b: 255 }],
      },
    ],
  };
}

it.each([false, true])('places a BGA sub-region at its authored origin (video=%s)', (video) => {
  const texture = new Texture({
    source: new TextureSource({ resource: new Uint8Array(128 * 64 * 4), width: 128, height: 64 }),
  });
  const layer = new BeatorajaBGALayer({
    skin: skin(),
    textures: new Map([['crop', texture]]),
    subRegionOrigins: new Map([['crop', { x: 32, y: 48 }]]),
    videoElements: video ? new Map([['crop', fakeVideo() as unknown as HTMLVideoElement]]) : undefined,
    cues: { base: [{ seconds: 0, bmpKey: 'crop' }], layer: [], poor: [] },
  });
  layer.update(0, { activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 }, false);
  const sprite = layer.container.children.find((child) => child.label === 'bga/base') as Sprite;
  expect([sprite.x, sprite.y, sprite.width, sprite.height]).toEqual([140, 405, 160, 60]);
  layer.dispose();
  texture.destroy(true);
});

it('applies opacity independently to base, both overlays and POOR and restores it after a seek', () => {
  const texture = fakeTexture();
  const cues = [{ seconds: 0, bmpKey: 'image' }];
  const opacity = (value: number) => [{ seconds: 2, opacity: value, tint: 0x4080c0 }];
  const layer = new BeatorajaBGALayer({
    skin: skin(),
    poorBGAMode: 1,
    textures: new Map([['image', texture]]),
    cues: {
      base: cues,
      layer: cues,
      layer2: cues,
      poor: cues,
      opacity: { base: opacity(0.5), layer: opacity(0.25), layer2: opacity(0.125), poor: opacity(0.75) },
    },
  });
  const context = { activeOps: new Set<number>(), getTimerStart: () => 0, nowMs: 0 };
  layer.update(3, context, true);
  const alpha = (label: string) =>
    (layer.container.children.find((child) => child.label === `bga/${label}`) as Sprite).alpha;
  expect(['base', 'layer', 'layer2', 'poor'].map(alpha)).toEqual([0.5, 0.25, 0.125, 0.75]);
  const tint = (label: string) =>
    (layer.container.children.find((child) => child.label === `bga/${label}`) as Sprite).tint;
  expect(['base', 'layer', 'layer2', 'poor'].map(tint)).toEqual([0x4080c0, 0x4080c0, 0x4080c0, 0x4080c0]);
  layer.update(1, context, true);
  expect(['base', 'layer', 'layer2', 'poor'].map(alpha)).toEqual([1, 1, 1, 1]);
  expect(['base', 'layer', 'layer2', 'poor'].map(tint)).toEqual([0xffffff, 0xffffff, 0xffffff, 0xffffff]);
  layer.dispose();
  texture.destroy(true);
});

it('uses each NONSTOP stage opacity with its own crossfade instead of the flattened opacity', () => {
  const texture = fakeTexture();
  const timeline = { base: [{ seconds: 0, bmpKey: 'image' }], layer: [], poor: [] };
  const opacity = (value: number) => ({ base: [{ seconds: 0, opacity: value }], layer: [], layer2: [], poor: [] });
  const layer = new BeatorajaBGALayer({
    skin: skin(),
    textures: new Map([['image', texture]]),
    cues: { ...timeline, opacity: opacity(0.1) },
    nonstop: {
      stages: [
        {
          windowStart: 0,
          windowEnd: 2,
          bmpKeys: ['image'],
          bgaOpacity: opacity(0.5),
          bgaFadeOut: { start: 2, end: 4 },
        },
        { windowStart: 2, windowEnd: 4, bmpKeys: [], bgaOpacity: opacity(0.25), bgaFadeIn: { start: 0, end: 2 } },
      ],
      timelines: [timeline, timeline],
    },
  });
  layer.update(1, { activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 }, false);
  expect(layer.container.children.filter((child) => child.label === 'bga/base').map((child) => child.alpha)).toEqual([
    0.5, 0.125,
  ]);
  layer.dispose();
  texture.destroy(true);
});

describe('BeatorajaBGALayer', () => {
  it('hides missing BGA cues without swapping a rendered sprite back to Texture.EMPTY', () => {
    const validTexture = fakeTexture();
    const layer = new BeatorajaBGALayer({
      skin: skin(),
      textures: new Map([['01', validTexture]]),
      cues: {
        base: [
          { seconds: 0, bmpKey: '01' },
          { seconds: 1, bmpKey: '02' },
        ],
        layer: [],
        poor: [],
      },
    });
    const sprite = layer.container.children[1] as Sprite;

    layer.update(0, { activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 }, false);
    expect(sprite.visible).toBe(true);
    expect(sprite.texture).toBe(validTexture);

    layer.update(1.1, { activeOps: new Set(), getTimerStart: () => 0, nowMs: 1100 }, false);
    expect(sprite.visible).toBe(false);
    expect(sprite.texture).toBe(validTexture);
    expect(sprite.texture).not.toBe(Texture.EMPTY);

    layer.dispose();
  });

  it('centers a small image top-aligned on the 256x256 canvas over a black fill', () => {
    const layer = new BeatorajaBGALayer({
      skin: skin(),
      textures: new Map([['01', fakeTexture()]]),
      cues: { base: [{ seconds: 0, bmpKey: '01' }], layer: [], poor: [] },
    });
    const [canvas, sprite] = layer.container.children as Sprite[];

    layer.update(0, { activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 }, false);
    // The 320x240 destination scales the canvas by 1.25 x 0.9375; a 1x1 image sits at canvas x 127, y 0.
    expect(canvas!.visible).toBe(true);
    expect([canvas!.x, canvas!.width, canvas!.height]).toEqual([100, 320, 240]);
    expect([sprite!.x, sprite!.y, sprite!.width, sprite!.height]).toEqual([258.75, canvas!.y, 1.25, 0.9375]);

    layer.dispose();
  });

  it('cross-fades a stitched NONSTOP chart from one stage to the next at the seam', () => {
    const red = fakeTexture();
    const blue = fakeTexture();
    const layer = new BeatorajaBGALayer({
      skin: skin(),
      textures: new Map([
        ['01', red],
        ['02', blue],
      ]),
      // The stitched chart's latest cue is the second stage's.
      cues: {
        base: [
          { seconds: 0, bmpKey: '01' },
          { seconds: 18, bmpKey: '02' },
        ],
        layer: [],
        poor: [],
      },
      nonstop: {
        stages: [
          { windowStart: 0, windowEnd: 20, bmpKeys: ['01'], bgaFadeOut: { start: 20, end: 23 } },
          { windowStart: 20, windowEnd: Number.POSITIVE_INFINITY, bmpKeys: ['02'], bgaFadeIn: { start: 17, end: 20 } },
        ],
        timelines: [
          { base: [{ seconds: 0, bmpKey: '01' }], layer: [], poor: [] },
          { base: [{ seconds: 18, bmpKey: '02' }], layer: [], poor: [] },
        ],
      },
    });
    const context = { activeOps: new Set<number>(), getTimerStart: () => 0, nowMs: 0 };
    const shown = () =>
      (layer.container.children as Sprite[])
        .filter((sprite) => sprite.label === 'bga/base' && sprite.visible)
        .map((sprite) => ({ texture: sprite.texture, alpha: sprite.alpha }));

    layer.update(10, context, false);
    expect(shown()).toEqual([{ texture: red, alpha: 1 }]);

    // Before the seam the next stage fades in over the first, after it the first fades out under the next.
    layer.update(18.5, context, false);
    const fadingIn = shown();
    expect(fadingIn.map((entry) => entry.texture)).toEqual([red, blue]);
    expect(fadingIn[0]!.alpha).toBe(1);
    expect(fadingIn[1]!.alpha).toBeCloseTo(0.5);
    layer.update(21.5, context, false);
    const fadingOut = shown();
    expect(fadingOut.map((entry) => entry.texture)).toEqual([red, blue]);
    expect(fadingOut[0]!.alpha).toBeCloseTo(0.5);
    expect(fadingOut[1]!.alpha).toBe(1);

    layer.update(24, context, false);
    expect(shown()).toEqual([{ texture: blue, alpha: 1 }]);

    layer.dispose();
  });

  it('draws the layer over the base, and the POOR image in place of both during a miss', () => {
    const base = fakeTexture();
    const layerImage = fakeTexture();
    const poor = fakeTexture();
    const layer = new BeatorajaBGALayer({
      skin: skin(),
      textures: new Map([
        ['01', base],
        ['03', poor],
      ]),
      layerTextures: new Map([['02', layerImage]]),
      cues: {
        base: [{ seconds: 0, bmpKey: '01' }],
        layer: [{ seconds: 0, bmpKey: '02' }],
        poor: [{ seconds: 0, bmpKey: '03' }],
      },
    });
    const context = { activeOps: new Set<number>(), getTimerStart: () => 0, nowMs: 0 };
    const shown = () =>
      (layer.container.children as Sprite[])
        .filter((sprite) => sprite.label !== 'bga/canvas' && sprite.visible)
        .map((sprite) => [sprite.label, sprite.texture]);

    layer.update(1, context, false);
    expect(shown()).toEqual([
      ['bga/background', Texture.WHITE],
      ['bga/base', base],
      ['bga/layer', layerImage],
    ]);

    layer.update(1, context, true);
    expect(shown()).toEqual([
      ['bga/background', Texture.WHITE],
      ['bga/base', poor],
    ]);

    layer.dispose();
  });
});

function fakeVideo() {
  const video = {
    currentTime: 0,
    duration: 120,
    playbackRate: 1,
    paused: true,
    seeking: false,
    ended: false,
    play: vi.fn(async () => {
      video.paused = false;
    }),
    pause: vi.fn(() => {
      video.paused = true;
    }),
  };
  return video;
}

it('seeks videos relative to the cue and corrects drift, including repeated cues for the same video', () => {
  const video = fakeVideo();
  const layer = new BeatorajaBGALayer({
    skin: skin(),
    textures: new Map([['01', fakeTexture()]]),
    videoElements: new Map([['01', video as unknown as HTMLVideoElement]]),
    cues: {
      base: [
        { seconds: 2, bmpKey: '01' },
        { seconds: 10, bmpKey: '01' },
      ],
      layer: [],
      poor: [],
    },
  });
  const context = { activeOps: new Set<number>(), getTimerStart: () => 0, nowMs: 0 };
  layer.update(7, context, false, { tempo: 1.5 });
  expect(video.currentTime).toBe(5);
  expect(video.playbackRate).toBe(1.5);
  expect(video.play).toHaveBeenCalledOnce();
  video.currentTime = 5.05;
  layer.update(7.1, context, false);
  expect(video.currentTime).toBe(5.05);
  layer.update(10.1, context, false);
  expect(video.currentTime).toBeCloseTo(0.1);
  layer.update(25, context, false);
  expect(video.currentTime).toBe(15);
  layer.update(5, context, false);
  expect(video.currentTime).toBe(3);
  layer.dispose();
});

it('holds videos through the intro and seeks a paused video without playing it', () => {
  const video = fakeVideo();
  const layer = new BeatorajaBGALayer({
    skin: skin(),
    textures: new Map([['01', fakeTexture()]]),
    videoElements: new Map([['01', video as unknown as HTMLVideoElement]]),
    cues: { base: [{ seconds: 0, bmpKey: '01' }], layer: [], poor: [] },
  });
  const context = { activeOps: new Set<number>(), getTimerStart: () => 0, nowMs: 0 };
  layer.update(0, context, false, { started: false });
  expect(video.play).not.toHaveBeenCalled();
  layer.update(20, context, false, { paused: true });
  expect(video.currentTime).toBe(20);
  expect(video.play).not.toHaveBeenCalled();
  layer.update(10, context, false, { paused: true });
  expect(video.currentTime).toBe(10);
  layer.update(10, context, false);
  expect(video.play).toHaveBeenCalledOnce();
  layer.dispose();
});

it('synchronizes both videos of a NONSTOP crossfade to their own cues', () => {
  const first = fakeVideo();
  const second = fakeVideo();
  const layer = new BeatorajaBGALayer({
    skin: skin(),
    textures: new Map([
      ['01', fakeTexture()],
      ['02', fakeTexture()],
    ]),
    videoElements: new Map([
      ['01', first as unknown as HTMLVideoElement],
      ['02', second as unknown as HTMLVideoElement],
    ]),
    cues: { base: [], layer: [], poor: [] },
    nonstop: {
      stages: [
        { windowStart: 0, windowEnd: 20, bmpKeys: ['01'], bgaFadeOut: { start: 20, end: 23 } },
        { windowStart: 20, windowEnd: Infinity, bmpKeys: ['02'], bgaFadeIn: { start: 17, end: 20 } },
      ],
      timelines: [
        { base: [{ seconds: 0, bmpKey: '01' }], layer: [], poor: [] },
        { base: [{ seconds: 18, bmpKey: '02' }], layer: [], poor: [] },
      ],
    },
  });
  layer.update(21, { activeOps: new Set(), getTimerStart: () => 0, nowMs: 0 }, false);
  expect(first.currentTime).toBe(21);
  expect(second.currentTime).toBe(3);
  expect(first.play).toHaveBeenCalledOnce();
  expect(second.play).toHaveBeenCalledOnce();
  layer.dispose();
});

it.each([0, 1, 2] as const)('draws POOR BGA mode %s using its replacement/overlay/hidden policy', (mode) => {
  const base = fakeTexture(),
    overlay = fakeTexture(),
    poor = fakeTexture();
  const layer = new BeatorajaBGALayer({
    skin: skin(),
    poorBGAMode: mode,
    textures: new Map([
      ['b', base],
      ['p', poor],
    ]),
    layerTextures: new Map([['l', overlay]]),
    cues: {
      base: [{ seconds: 0, bmpKey: 'b' }],
      layer: [{ seconds: 0, bmpKey: 'l' }],
      poor: [{ seconds: 0, bmpKey: 'p' }],
    },
  });
  const context = { activeOps: new Set<number>(), getTimerStart: () => 0, nowMs: 0 };
  layer.update(1, context, true);
  const textures = (layer.container.children as Sprite[])
    .filter((sprite) => sprite.visible && sprite.label !== 'bga/canvas')
    .map((sprite) => sprite.texture);
  expect(textures).toEqual([
    Texture.WHITE,
    ...(mode === 0 ? [poor] : mode === 1 ? [base, overlay, poor] : [base, overlay]),
  ]);
  expect(layer.container.children[0]).toMatchObject({ label: 'bga/background', tint: 0, visible: true });
  layer.update(2, context, false);
  expect(
    (layer.container.children as Sprite[]).filter((sprite) => sprite.visible && sprite.label === 'bga/poor'),
  ).toHaveLength(0);
  layer.dispose();
});

it('draws and clears the second overlay independently, including during POOR modes', () => {
  const base = fakeTexture(),
    first = fakeTexture(),
    second = fakeTexture(),
    poor = fakeTexture();
  const context = { activeOps: new Set<number>(), getTimerStart: () => 0, nowMs: 0 };
  for (const mode of [0, 1, 2] as const) {
    const layer = new BeatorajaBGALayer({
      skin: skin(),
      textures: new Map([
        ['base', base],
        ['poor', poor],
      ]),
      layerTextures: new Map([
        ['first', first],
        ['second', second],
      ]),
      poorBGAMode: mode,
      cues: {
        base: [{ seconds: 0, bmpKey: 'base' }],
        layer: [{ seconds: 0, bmpKey: 'first' }],
        layer2: [
          { seconds: 1, bmpKey: 'second' },
          { seconds: 3, bmpKey: undefined },
        ],
        poor: [{ seconds: 0, bmpKey: 'poor' }],
      },
    });
    const visible = () => layer.container.children.filter((child) => child.visible).map((child) => child.label);
    layer.update(2, context, false);
    expect(visible()).toContain('bga/layer');
    expect(visible()).toContain('bga/layer2');
    layer.update(4, context, false);
    expect(visible()).toContain('bga/layer');
    expect(visible()).not.toContain('bga/layer2');
    layer.update(2, context, true);
    if (mode === 0) expect(visible()).not.toContain('bga/layer2');
    else expect(visible()).toContain('bga/layer2');
    if (mode === 1) expect(visible()).toContain('bga/poor');
    layer.dispose();
  }
  for (const texture of [base, first, second, poor]) texture.destroy(true);
});

it('uses independent playheads when both overlays reference the same video BMP', () => {
  const first = fakeVideo(),
    second = fakeVideo();
  const texture1 = fakeTexture(),
    texture2 = fakeTexture();
  const secondKey = String.fromCharCode(0) + 'layer2:01';
  const layer = new BeatorajaBGALayer({
    skin: skin(),
    textures: new Map(),
    layerTextures: new Map([
      ['01', texture1],
      [secondKey, texture2],
    ]),
    videoElements: new Map([
      ['01', first as unknown as HTMLVideoElement],
      [secondKey, second as unknown as HTMLVideoElement],
    ]),
    cues: {
      base: [],
      layer: [{ seconds: 1, bmpKey: '01' }],
      layer2: [
        { seconds: 3, bmpKey: '01' },
        { seconds: 5, bmpKey: undefined },
      ],
      poor: [],
    },
  });
  const context = { activeOps: new Set<number>(), getTimerStart: () => 0, nowMs: 0 };
  layer.update(4, context, false);
  expect(first.currentTime).toBe(3);
  expect(second.currentTime).toBe(1);
  expect(layer.container.children.find((sprite) => sprite.label === 'bga/layer2')).toMatchObject({
    texture: texture2,
    visible: true,
  });
  layer.update(6, context, false);
  expect(first.paused).toBe(false);
  expect(second.paused).toBe(true);
  layer.update(4, context, false, { paused: true });
  expect(first.paused).toBe(true);
  expect(second.paused).toBe(true);
  expect(first.currentTime).toBe(3);
  expect(second.currentTime).toBe(1);
  layer.resume();
  expect(first.paused).toBe(false);
  expect(second.paused).toBe(false);
  layer.dispose();
  expect(first.paused).toBe(true);
  expect(second.paused).toBe(true);
  texture1.destroy(true);
  texture2.destroy(true);
});

it('draws input-bound SWBGA after replacement POOR and clears its sprite after release', () => {
  const texture = fakeTexture();
  const key = keyBoundBGAResourceKey('61', '00');
  const layer = new BeatorajaBGALayer({
    skin: skin(),
    poorBGAMode: 0,
    textures: new Map([['poor', texture]]),
    layerTextures: new Map([[key, texture]]),
    cues: { base: [], layer: [], poor: [{ seconds: 0, bmpKey: 'poor' }] },
  });
  const context = { activeOps: new Set<number>(), getTimerStart: () => 0, nowMs: 0 };
  layer.update(3, context, true, {
    keyBoundBGA: {
      definitionId: '61',
      channel: '11',
      bmpKey: '00',
      startedSeconds: 2,
      frameStartSeconds: 2,
      argb: { a: 255, r: 255, g: 255, b: 255 },
    },
  });
  const overlay = layer.container.children.at(-1) as Sprite;
  expect(overlay.visible).toBe(true);
  expect(overlay.texture).toBe(texture);
  expect(layer.container.children.some((child) => child.label === 'bga/base' && child.visible)).toBe(true);
  layer.update(3.1, context, true);
  expect(overlay.visible).toBe(false);
  layer.dispose();
  texture.destroy(true);
});

it('scales SWBGA movie time and playback by its NONSTOP FIT rate', () => {
  const texture = fakeTexture();
  const video = fakeVideo();
  const key = keyBoundBGAResourceKey('stage:1:61', '00');
  const layer = new BeatorajaBGALayer({
    skin: skin(),
    textures: new Map(),
    layerTextures: new Map([[key, texture]]),
    videoElements: new Map([[key, video as unknown as HTMLVideoElement]]),
    cues: { base: [], layer: [], poor: [] },
  });
  const context = { activeOps: new Set<number>(), getTimerStart: () => 0, nowMs: 0 };
  const playback = {
    tempo: 1.5,
    keyBoundBGA: {
      definitionId: 'stage:1:61',
      channel: '11',
      bmpKey: '00',
      startedSeconds: 2,
      frameStartSeconds: 2,
      playbackRate: 2,
      argb: { a: 0, r: 0, g: 0, b: 0 },
    },
  };
  layer.update(3, context, false, playback);
  expect(video.currentTime).toBe(2);
  expect(video.playbackRate).toBe(3);
  video.currentTime = 0;
  layer.update(3.5, context, false, playback);
  expect(video.currentTime).toBe(3);
  layer.update(3.6, context, false);
  expect(video.pause).toHaveBeenCalled();
  layer.dispose();
  texture.destroy(true);
});
