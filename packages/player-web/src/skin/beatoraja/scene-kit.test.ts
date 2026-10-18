import {
  BEATORAJA_OP,
  type BeatorajaSkinConfig,
  type BeatorajaSkinFileEntry,
  type BeatorajaSkinHeader,
} from '@be-music/beatoraja-skin';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  createBeatorajaSceneKitCaches,
  createBeatorajaSkinLoadContext,
  defaultBeatorajaSkinConfig,
  loadBeatorajaSceneKit,
  releaseBeatorajaSceneKitAssets,
  resolveBeatorajaSkinConfig,
} from './scene-kit.ts';
import type { BeatorajaFontCache } from './fonts.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const HEADER: BeatorajaSkinHeader = {
  type: 5,
  name: 'Bench',
  w: 1280,
  h: 720,
  property: [
    {
      name: 'Lane Cover',
      def: 'On',
      item: [
        { name: 'Off', op: 900 },
        { name: 'On', op: 901 },
      ],
    },
  ],
  filepath: [{ name: 'Parts', path: 'parts/*.png', def: 'b' }],
};

const JSON_SKIN = JSON.stringify({
  ...HEADER,
  source: [{ id: 0, path: 'parts/*.png' }],
  image: [{ id: 'part', src: 0, x: 0, y: 0, w: 8, h: 8 }],
});

/** A Lua skin that returns only its header without options, and its sources with them. */
const LUA_SKIN = [
  'local main_state = require("main_state")',
  'local header = { type = 6, name = "Lua", w = 1280, h = 720,',
  '  property = { { name = "Mode", def = "B", item = { { name = "A", op = 910 }, { name = "B", op = 911 } } } } }',
  'if not skin_config then return header end',
  'local s = {}; for k, v in pairs(header) do s[k] = v end',
  'local loaded = main_state.option(911) and "loaded" or "default"',
  's.source = { { id = 0, path = loaded .. ".png" } }',
  'return s',
].join('\n');

function themeFiles(entries: ReadonlyArray<readonly [string, string]>): Map<string, BeatorajaSkinFileEntry> {
  return new Map(entries.map(([path, text]) => [path, enc(text)]));
}

const FILES = themeFiles([
  ['skin/select.json', JSON_SKIN],
  ['skin/parts/a.png', 'a'],
  ['skin/parts/b.png', 'b'],
  ['skin/decide.luaskin', LUA_SKIN],
]);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('defaultBeatorajaSkinConfig', () => {
  it('starts from the header defaults, matching the default file against the theme files', () => {
    expect(defaultBeatorajaSkinConfig(HEADER, FILES, 'skin/select.json')).toEqual({
      offset: 0,
      option: { 'Lane Cover': 901 },
      file: { Parts: 'skin/parts/b.png' },
      customOffset: {},
    });
  });

  it('picks no file a wildcard does not match', () => {
    expect(defaultBeatorajaSkinConfig(HEADER, new Map(), 'skin/select.json').file).toEqual({});
  });
});

describe('resolveBeatorajaSkinConfig', () => {
  it('seeds an entry once and keeps it by entry path', () => {
    const caches = createBeatorajaSceneKitCaches();
    const first = resolveBeatorajaSkinConfig(caches, 'skin/select.json', HEADER, FILES);
    expect(caches.skinConfigs.get('skin/select.json')).toBe(first);
    expect(resolveBeatorajaSkinConfig(caches, 'skin/select.json', HEADER, FILES)).toBe(first);
    expect(resolveBeatorajaSkinConfig(caches, 'skin/other.json', HEADER, FILES)).not.toBe(first);
  });

  it('returns the options the host kept', () => {
    const caches = createBeatorajaSceneKitCaches();
    const picked = { offset: 3, option: { 'Lane Cover': 900 } };
    caches.skinConfigs.set('skin/select.json', picked);
    expect(resolveBeatorajaSkinConfig(caches, 'skin/select.json', HEADER, FILES)).toBe(picked);
  });
});

describe('createBeatorajaSkinLoadContext', () => {
  it("lights the chart's difficulty ops and the options' ops", () => {
    const context = createBeatorajaSkinLoadContext({ difficulty: 4, skinConfig: { option: { Mode: 911, Off: 0 } } });
    expect(context.option?.(BEATORAJA_OP.LEVEL_ANOTHER)).toBe(true);
    expect(context.option?.(BEATORAJA_OP.DIFFICULTY_ANOTHER)).toBe(true);
    expect(context.option?.(BEATORAJA_OP.DIFFICULTY_UNDEFINED)).toBe(false);
    expect(context.option?.(911)).toBe(true);
    expect(context.option?.(0)).toBe(false);
  });

  it('lights DIFFICULTY_UNDEFINED for a chart without a difficulty', () => {
    const context = createBeatorajaSkinLoadContext({ skinConfig: {} });
    expect(context.option?.(BEATORAJA_OP.DIFFICULTY_UNDEFINED)).toBe(true);
  });

  it('routes the Lua sounds to the skin audio, and leaves them out without one', () => {
    const skinAudio = { play: vi.fn(() => true), loop: vi.fn(() => false), stop: vi.fn(() => true) };
    const context = createBeatorajaSkinLoadContext({ skinConfig: {}, skinAudio });
    expect(context.audioPlay?.('a.wav', 0.5)).toBe(true);
    expect(context.audioLoop?.('b.wav', 1)).toBe(false);
    expect(context.audioStop?.('b.wav')).toBe(true);
    expect(skinAudio.play).toHaveBeenCalledWith('a.wav', 0.5);
    expect(skinAudio.loop).toHaveBeenCalledWith('b.wav', 1);
    expect(skinAudio.stop).toHaveBeenCalledWith('b.wav');

    const silent = createBeatorajaSkinLoadContext({ skinConfig: {} });
    expect(silent.audioPlay).toBeUndefined();
    expect(silent.audioLoop).toBeUndefined();
    expect(silent.audioStop).toBeUndefined();
  });
});

describe('loadBeatorajaSceneKit', () => {
  // The Node test environment has no `createImageBitmap`, so each resolved source fails to decode and is logged.
  const quietDecodes = (): void => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  };

  it('loads the skin with the seeded options and keeps them, its textures and its fonts by entry path', async () => {
    quietDecodes();
    const caches = createBeatorajaSceneKitCaches();
    const result = await loadBeatorajaSceneKit({ files: FILES, entryPath: 'skin/select.json', caches });
    if (!result.ok) throw new Error(result.message);
    expect(result.header.name).toBe('Bench');
    expect(result.kit.skin.name).toBe('Bench');
    expect(result.kit.files).toBe(FILES);
    expect(result.kit.skinConfig).toBe(caches.skinConfigs.get('skin/select.json'));
    expect(caches.textures.get('skin/select.json')).toBe(result.kit.textures);
    expect(caches.fonts.get('skin/select.json')).toBe(result.kit.fonts);
  });

  it('reuses the kept textures and fonts on the next load of the entry', async () => {
    quietDecodes();
    const caches = createBeatorajaSceneKitCaches();
    const first = await loadBeatorajaSceneKit({ files: FILES, entryPath: 'skin/select.json', caches });
    const onSources = vi.fn();
    const onFonts = vi.fn();
    const second = await loadBeatorajaSceneKit({
      files: FILES,
      entryPath: 'skin/select.json',
      caches,
      onSources,
      onFonts,
    });
    if (!first.ok || !second.ok) throw new Error('expected both loads to succeed');
    expect(second.kit.textures).toBe(first.kit.textures);
    expect(second.kit.fonts).toBe(first.kit.fonts);
    expect(onSources).not.toHaveBeenCalled();
    expect(onFonts).not.toHaveBeenCalled();
  });

  it('decodes the textures again on a reload and keeps the fonts', async () => {
    quietDecodes();
    const caches = createBeatorajaSceneKitCaches();
    const first = await loadBeatorajaSceneKit({ files: FILES, entryPath: 'skin/select.json', caches });
    if (!first.ok) throw new Error(first.message);
    const onSources = vi.fn();
    const reloaded = await loadBeatorajaSceneKit({
      files: FILES,
      entryPath: 'skin/select.json',
      caches,
      skinConfig: first.kit.skinConfig,
      reloadTextures: true,
      onSources,
    });
    if (!reloaded.ok) throw new Error(reloaded.message);
    expect(reloaded.kit.textures).not.toBe(first.kit.textures);
    expect(caches.textures.get('skin/select.json')).toBe(reloaded.kit.textures);
    expect(reloaded.kit.fonts).toBe(first.kit.fonts);
    expect(onSources).toHaveBeenCalledOnce();
  });

  it('reports the resolved sources and the declared fonts when it loads them', async () => {
    quietDecodes();
    const onSources = vi.fn();
    const onFonts = vi.fn<(fonts: BeatorajaFontCache, declared: number) => void>();
    await loadBeatorajaSceneKit({
      files: FILES,
      entryPath: 'skin/select.json',
      caches: createBeatorajaSceneKitCaches(),
      onSources,
      onFonts,
    });
    expect(onSources).toHaveBeenCalledOnce();
    expect(onSources.mock.calls[0]?.[0].assets.map((asset: { path: string }) => asset.path)).toEqual([
      'skin/parts/b.png',
    ]);
    expect(onFonts).toHaveBeenCalledOnce();
    expect(onFonts.mock.calls[0]?.[1]).toBe(0);
  });

  it("takes the header's default file for a wildcard on the first load, and the player's pick after", async () => {
    quietDecodes();
    const caches = createBeatorajaSceneKitCaches();
    const onSources = vi.fn();
    // The first load of a select entry: `parts/*.png` matches `a.png` first, but the header's default is `b`.
    const first = await loadBeatorajaSceneKit({ files: FILES, entryPath: 'skin/select.json', caches, onSources });
    if (!first.ok) throw new Error(first.message);
    expect(first.kit.skinConfig.file).toEqual({ Parts: 'skin/parts/b.png' });
    expect(onSources.mock.calls[0]?.[0].assets.map((asset: { path: string }) => asset.path)).toEqual([
      'skin/parts/b.png',
    ]);
    await loadBeatorajaSceneKit({
      files: FILES,
      entryPath: 'skin/select.json',
      caches,
      skinConfig: { ...first.kit.skinConfig, file: { Parts: 'skin/parts/a.png' } },
      reloadTextures: true,
      onSources,
    });
    expect(onSources.mock.calls[1]?.[0].assets.map((asset: { path: string }) => asset.path)).toEqual([
      'skin/parts/a.png',
    ]);
  });

  it('loads a Lua skin twice: the header pass seeds the options the skin is then built with', async () => {
    const caches = createBeatorajaSceneKitCaches();
    const runtimeContext = vi.fn((skinConfig: BeatorajaSkinConfig) => createBeatorajaSkinLoadContext({ skinConfig }));
    const result = await loadBeatorajaSceneKit({
      files: FILES,
      entryPath: 'skin/decide.luaskin',
      caches,
      runtimeContext,
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.header.name).toBe('Lua');
    expect(result.kit.skinConfig.option).toEqual({ Mode: 911 });
    expect(runtimeContext).toHaveBeenCalledExactlyOnceWith(result.kit.skinConfig);
    // The skin read the seeded option through the load-time `main_state`.
    expect(result.kit.skin.source?.[0]?.path).toBe('loaded.png');
  });

  it('loads the skin once with the options it is given, leaving the kept ones alone', async () => {
    const caches = createBeatorajaSceneKitCaches();
    const skinConfig = { option: { Mode: 910 } };
    const result = await loadBeatorajaSceneKit({ files: FILES, entryPath: 'skin/decide.luaskin', caches, skinConfig });
    if (!result.ok) throw new Error(result.message);
    expect(result.kit.skinConfig).toBe(skinConfig);
    expect(result.kit.skin.source?.[0]?.path).toBe('default.png');
    expect(caches.skinConfigs.size).toBe(0);
  });

  it('says which pass failed', async () => {
    const caches = createBeatorajaSceneKitCaches();
    const missing = await loadBeatorajaSceneKit({ files: FILES, entryPath: 'skin/missing.json', caches });
    expect(missing).toEqual({ ok: false, stage: 'header', message: 'entry file not found: skin/missing.json' });

    const broken = themeFiles([['skin/broken.json', '{ not json']]);
    const skin = await loadBeatorajaSceneKit({
      files: broken,
      entryPath: 'skin/broken.json',
      caches,
      skinConfig: {},
    });
    expect(skin.ok).toBe(false);
    if (skin.ok) throw new Error('expected the skin pass to fail');
    expect(skin.stage).toBe('skin');
    expect(caches.textures.size).toBe(0);
    expect(caches.fonts.size).toBe(0);
  });
});

describe('releaseBeatorajaSceneKitAssets', () => {
  it('forgets the textures, disposes the fonts and keeps the options', () => {
    const caches = createBeatorajaSceneKitCaches();
    const dispose = vi.fn();
    caches.textures.set('skin/select.json', {
      get: () => undefined,
      values: () => [].values(),
      pathOf: () => undefined,
    });
    caches.fonts.set('skin/select.json', {
      family: () => undefined,
      kind: () => undefined,
      values: () => [],
      dispose,
    });
    caches.skinConfigs.set('skin/select.json', {});
    releaseBeatorajaSceneKitAssets(caches);
    expect(caches.textures.size).toBe(0);
    expect(caches.fonts.size).toBe(0);
    expect(dispose).toHaveBeenCalledOnce();
    expect(caches.skinConfigs.size).toBe(1);
  });
});
