import { createEmptyJson } from '@be-music/json';
import { BEATORAJA_SKIN_TYPE, type BeatorajaSkinConfig, type BeatorajaSkinEntry } from '@be-music/beatoraja-skin';
import { discoverBeatorajaSelectBgmPath, discoverBeatorajaSystemSoundPaths } from '@be-music/beatoraja-skin/scene';
import type { AudioOwner } from '@be-music/player-web/audio';
import type { PlayScene, SelectScene } from '@be-music/player-web/host';
import {
  findBeatorajaThemeBgm,
  loadBeatorajaSceneKit,
  loadBeatorajaThemeFromFiles,
  releaseBeatorajaSceneKitAssets,
  type BeatorajaThemeBundle,
  type LoadBeatorajaSceneKitResult,
} from '@be-music/player-web/skin';
import { systemSoundSetFromBeatoraja, type LibraryChart } from '@be-music/scene-model';
import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import type { LoadingOverlayElements } from '../../loading-overlay.ts';
import { BeatorajaThemeService, type BeatorajaThemeServiceOptions } from './beatoraja.ts';

vi.mock('@be-music/player-web/skin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@be-music/player-web/skin')>();
  return {
    ...actual,
    loadBeatorajaThemeFromFiles: vi.fn(),
    loadBeatorajaSceneKit: vi.fn(),
    findBeatorajaThemeBgm: vi.fn(),
    releaseBeatorajaSceneKitAssets: vi.fn(actual.releaseBeatorajaSceneKitAssets),
  };
});

const loadTheme = vi.mocked(loadBeatorajaThemeFromFiles);
const loadKit = vi.mocked(loadBeatorajaSceneKit);
const findBgm = vi.mocked(findBeatorajaThemeBgm);
const release = vi.mocked(releaseBeatorajaSceneKitAssets);

function entry(type: number, entryPath: string): BeatorajaSkinEntry {
  return { entryPath, header: { type, name: entryPath } } as unknown as BeatorajaSkinEntry;
}

const SELECT = entry(BEATORAJA_SKIN_TYPE.MUSIC_SELECT, 'skin/select.luaskin');
const DECIDE = entry(BEATORAJA_SKIN_TYPE.DECIDE, 'skin/decide.luaskin');
const DECIDE_B = entry(BEATORAJA_SKIN_TYPE.DECIDE, 'skin/decide-b.luaskin');
const RESULT = entry(BEATORAJA_SKIN_TYPE.RESULT, 'skin/result.luaskin');
const COURSE_RESULT = entry(BEATORAJA_SKIN_TYPE.COURSE_RESULT, 'skin/course-result.luaskin');
const PLAY_7 = entry(BEATORAJA_SKIN_TYPE.PLAY_7KEYS, 'skin/play7.luaskin');
const PLAY_7_B = entry(BEATORAJA_SKIN_TYPE.PLAY_7KEYS, 'skin/play7-b.luaskin');

/** A theme bundle with `entries`, its discovery's picks in `picks`, and the files at `paths`. */
function bundle(
  entries: BeatorajaSkinEntry[],
  picks: { selectSkin?: BeatorajaSkinEntry; decideSkin?: BeatorajaSkinEntry; resultSkin?: BeatorajaSkinEntry } & {
    courseResultSkin?: BeatorajaSkinEntry;
    playSkins?: Record<string, BeatorajaSkinEntry>;
  } = {},
  paths: string[] = [],
): BeatorajaThemeBundle {
  return {
    files: new Map(paths.map((path) => [path, { path }])),
    theme: { entries, playSkins: {}, ...picks },
    warnings: [],
  } as unknown as BeatorajaThemeBundle;
}

const FULL = (): BeatorajaThemeBundle =>
  bundle([SELECT, DECIDE, DECIDE_B, RESULT, COURSE_RESULT, PLAY_7, PLAY_7_B], {
    selectSkin: SELECT,
    decideSkin: DECIDE,
    resultSkin: RESULT,
    courseResultSkin: COURSE_RESULT,
    playSkins: { '7': PLAY_7 },
  });

/** A 7 KEY chart: a note on key 1 and one on key 6. */
function chart(): LibraryChart {
  const json = createEmptyJson('bms');
  json.events.push(
    { measure: 1, channel: '11', position: [0, 1], value: '01' },
    { measure: 1, channel: '18', position: [0, 1], value: '01' },
  );
  return {
    id: 'a',
    sourceId: 'src',
    sourceLabel: 'src',
    sourceKind: 'files',
    chartPath: 'a.bms',
    directoryLabel: 'src',
    fileLabel: 'a.bms',
    title: 'A',
    totalNotes: 2,
    chart: json,
  };
}

/** A load that worked: a kit named after the entry, with the options it was loaded with. */
function loaded(entryPath: string, skinConfig?: BeatorajaSkinConfig): LoadBeatorajaSceneKitResult {
  return {
    ok: true,
    kit: { entryPath, skinConfig } as never,
    header: { type: 0, name: entryPath } as never,
  };
}

interface Harness {
  service: BeatorajaThemeService;
  options: BeatorajaThemeServiceOptions;
  calls: string[];
  owners: AudioOwner[];
  select: { current: SelectScene | undefined };
  play: { current: PlayScene | undefined };
}

function harness(): Harness {
  const calls: string[] = [];
  const owners: AudioOwner[] = [];
  const select: Harness['select'] = { current: undefined };
  const play: Harness['play'] = { current: undefined };
  const options: BeatorajaThemeServiceOptions = {
    elements: {} as LoadingOverlayElements,
    audio: {
      setTheme: vi.fn(() => void calls.push('setTheme')),
      stopOwned: vi.fn((owner: AudioOwner) => {
        owners.push(owner);
        calls.push('stopOwned');
      }),
      skinSounds: {
        owned: vi.fn((owner: AudioOwner) => {
          owners.push(owner);
          return { play: vi.fn(), loop: vi.fn(), stop: vi.fn() };
        }),
      } as never,
    },
    setStatus: vi.fn(),
    selectView: () => select.current,
    gameplayView: () => play.current,
    rebuildBeatorajaSkinPickers: vi.fn(() => void calls.push('rebuildBeatorajaSkinPickers')),
    rebuildSkinFamilyPicker: vi.fn(() => void calls.push('rebuildSkinFamilyPicker')),
    refreshBeatorajaPlaySkinOptions: vi.fn(),
    refreshBeatorajaSelectSkinOptions: vi.fn(),
  };
  return { service: new BeatorajaThemeService(options), options, calls, owners, select, play };
}

/** Loads `theme` as the drop's beatoraja theme. */
async function drop(service: BeatorajaThemeService, theme: BeatorajaThemeBundle): Promise<void> {
  loadTheme.mockResolvedValueOnce(theme);
  await service.loadBeatorajaTheme([]);
}

/** The entry path of each kit load so far. */
function loadedEntries(): string[] {
  return loadKit.mock.calls.map(([options]) => options.entryPath);
}

beforeEach(() => {
  vi.clearAllMocks();
  loadKit.mockImplementation(async (options) => loaded(options.entryPath, options.skinConfig));
  findBgm.mockResolvedValue({});
});

describe('BeatorajaThemeService.loadBeatorajaTheme', () => {
  test('a new theme lets the previous one go, hands its files to the audio service and rebuilds the pickers', async () => {
    const { service, options, calls } = harness();
    service.beatorajaSkinOverridesByType.set(BEATORAJA_SKIN_TYPE.DECIDE, DECIDE_B.entryPath);
    const clear = new Uint8Array([1]);
    findBgm.mockImplementation(async () => {
      calls.push('findBeatorajaThemeBgm');
      return { clear };
    });
    const theme = FULL();
    await drop(service, theme);

    expect(service.beatorajaTheme).toBe(theme);
    expect(release).toHaveBeenCalledWith(service.beatorajaKitCaches);
    expect(options.audio.setTheme).toHaveBeenCalledWith({ files: theme.files });
    expect(service.beatorajaSkinOverridesByType.size).toBe(0);
    expect(service.beatorajaThemeBgm).toEqual({ clear });
    // The previous theme's skin sounds stop before the new one's files are set, and the pickers are rebuilt (overrides
    // gone) before the theme's BGM is scanned.
    expect(calls).toEqual([
      'stopOwned',
      'setTheme',
      'rebuildBeatorajaSkinPickers',
      'rebuildSkinFamilyPicker',
      'findBeatorajaThemeBgm',
    ]);
  });

  test('a new theme stops the skin sounds the previous theme started as its skins loaded', async () => {
    const { service, owners } = harness();
    await drop(service, FULL());
    await service.loadBeatorajaDecideKit(chart());
    const runtimeContext = loadKit.mock.calls[0]![0].runtimeContext!;
    runtimeContext({ offset: 0, option: {}, file: {}, customOffset: {} } as unknown as BeatorajaSkinConfig);
    await drop(service, FULL());
    // [stopOwned of the first drop, owned by the decide skin's load, stopOwned of the second drop]: one owner.
    expect(owners).toHaveLength(3);
    expect(new Set(owners).size).toBe(1);
  });

  test('a theme that fails to load leaves the one loaded before', async () => {
    const { service, options } = harness();
    const theme = FULL();
    await drop(service, theme);
    vi.clearAllMocks();
    loadTheme.mockRejectedValueOnce(new Error('broken'));
    await service.loadBeatorajaTheme([]);
    expect(service.beatorajaTheme).toBe(theme);
    expect(release).not.toHaveBeenCalled();
    expect(options.audio.setTheme).not.toHaveBeenCalled();
  });

  test('the select sounds are the theme cues and select BGM found in its files', async () => {
    const { service } = harness();
    const theme = bundle([SELECT], { selectSkin: SELECT }, ['bgm/select.wav', 'sound/folder_open.wav']);
    await drop(service, theme);
    expect(service.selectSoundSet()).toEqual(
      systemSoundSetFromBeatoraja({
        paths: discoverBeatorajaSystemSoundPaths(theme.files),
        selectBgmPath: discoverBeatorajaSelectBgmPath(theme.files)!,
      }),
    );
    expect(service.selectSoundSet().selectBgm).toEqual({ path: 'bgm/select.wav' });
  });
});

describe('BeatorajaThemeService kits', () => {
  test('every entry of every theme loads into the one set of kit caches', async () => {
    const { service, select, play } = harness();
    const caches = service.beatorajaKitCaches;
    await drop(service, FULL());
    await service.loadBeatorajaSelectKit();
    await service.loadBeatorajaDecideKit(chart());
    await service.loadBeatorajaResultKit(chart(), false);
    await service.loadBeatorajaPlayKit(chart());
    select.current = { identity: { family: 'beatoraja' }, updateKit: vi.fn() } as unknown as SelectScene;
    await service.applyBeatorajaSelectSkinConfig(SELECT.entryPath, {} as BeatorajaSkinConfig);
    play.current = { identity: { family: 'beatoraja' }, updateKit: vi.fn() } as unknown as PlayScene;
    service.activeBeatorajaPlay = { entryPath: PLAY_7.entryPath, header: PLAY_7.header, variant: '7' };
    await service.applyBeatorajaPlaySkinConfig(PLAY_7.entryPath, {} as BeatorajaSkinConfig);
    await drop(service, FULL());
    await service.loadBeatorajaSelectKit();

    expect(loadKit).toHaveBeenCalledTimes(7);
    for (const [options] of loadKit.mock.calls) expect(options.caches).toBe(caches);
    expect(service.beatorajaKitCaches).toBe(caches);
    expect(release).toHaveBeenCalledTimes(2);
    for (const [released] of release.mock.calls) expect(released).toBe(caches);
  });

  test("the Debug Menu's pick wins over the discovery's, and a pick the theme no longer has is dropped", async () => {
    const { service } = harness();
    await drop(service, FULL());
    await service.loadBeatorajaDecideKit(chart());
    service.beatorajaSkinOverridesByType.set(BEATORAJA_SKIN_TYPE.DECIDE, DECIDE_B.entryPath);
    await service.loadBeatorajaDecideKit(chart());
    service.beatorajaSkinOverridesByType.set(BEATORAJA_SKIN_TYPE.DECIDE, 'skin/gone.luaskin');
    await service.loadBeatorajaDecideKit(chart());
    expect(loadedEntries()).toEqual([DECIDE.entryPath, DECIDE_B.entryPath, DECIDE.entryPath]);
    expect(service.beatorajaSkinOverridesByType.has(BEATORAJA_SKIN_TYPE.DECIDE)).toBe(false);
  });

  test('a decide skin loads with the chart and comes back as a beatoraja kit; none without one', async () => {
    const { service } = harness();
    expect(await service.loadBeatorajaDecideKit(chart())).toBeUndefined();
    await drop(service, bundle([SELECT], { selectSkin: SELECT }));
    expect(await service.loadBeatorajaDecideKit(chart())).toBeUndefined();
    await drop(service, FULL());
    const kit = await service.loadBeatorajaDecideKit(chart());
    expect(kit).toEqual({ family: 'beatoraja', kit: { entryPath: DECIDE.entryPath } });
    expect(loadKit.mock.calls[0]![0].runtimeContext).toBeTypeOf('function');
    loadKit.mockResolvedValueOnce({ ok: false, stage: 'skin', message: 'broken' });
    expect(await service.loadBeatorajaDecideKit(chart())).toBeUndefined();
  });

  test("a course run's result takes the COURSE_RESULT skin, falling back to the result skin", async () => {
    const { service } = harness();
    expect(await service.loadBeatorajaResultKit(chart(), true)).toBeUndefined();
    await drop(service, FULL());
    expect(await service.loadBeatorajaResultKit(chart(), true)).toEqual({
      family: 'beatoraja',
      kit: { entryPath: COURSE_RESULT.entryPath },
    });
    await service.loadBeatorajaResultKit(chart(), false);
    await drop(service, bundle([RESULT], { resultSkin: RESULT }));
    await service.loadBeatorajaResultKit(chart(), true);
    expect(loadedEntries()).toEqual([COURSE_RESULT.entryPath, RESULT.entryPath, RESULT.entryPath]);
    loadKit.mockResolvedValueOnce({ ok: false, stage: 'skin', message: 'broken' });
    expect(await service.loadBeatorajaResultKit(chart(), false)).toBeUndefined();
  });

  test('the select entry is loaded once per theme and entry, and taken again on each return', async () => {
    const { service, options } = harness();
    await drop(service, FULL());
    const first = await service.loadBeatorajaSelectKit();
    expect(await service.loadBeatorajaSelectKit()).toBe(first);
    expect(service.beatorajaSelectKit?.entryPath).toBe(SELECT.entryPath);
    await drop(service, FULL());
    expect(await service.loadBeatorajaSelectKit()).not.toBe(first);
    expect(loadKit).toHaveBeenCalledTimes(2);
    await drop(service, bundle([DECIDE], { decideSkin: DECIDE }));
    expect(await service.loadBeatorajaSelectKit()).toBeUndefined();
    expect(options.setStatus).toHaveBeenLastCalledWith('Beatoraja select unavailable: no select skin');
  });

  test("the play entry is the theme's skin for the chart's key mode, by the Debug Menu's pick", async () => {
    const { service, options } = harness();
    await drop(service, FULL());
    expect(await service.loadBeatorajaPlayKit(chart())).toEqual({
      kit: { family: 'beatoraja', kit: { entryPath: PLAY_7.entryPath } },
      entryPath: PLAY_7.entryPath,
      header: { type: 0, name: PLAY_7.entryPath },
      variant: '7',
    });
    service.beatorajaSkinOverridesByType.set(BEATORAJA_SKIN_TYPE.PLAY_7KEYS, PLAY_7_B.entryPath);
    expect((await service.loadBeatorajaPlayKit(chart()))?.entryPath).toBe(PLAY_7_B.entryPath);
    await drop(service, bundle([SELECT], { selectSkin: SELECT }));
    expect(await service.loadBeatorajaPlayKit(chart())).toBeUndefined();
    expect(options.setStatus).toHaveBeenLastCalledWith('Beatoraja gameplay unavailable: no play skin for A');
  });
});

describe('BeatorajaThemeService skin options', () => {
  test('new options for the select entry go to a beatoraja select screen, which keeps its place', async () => {
    const { service, options, select } = harness();
    await drop(service, FULL());
    const config = { offset: 5 } as unknown as BeatorajaSkinConfig;
    // A built-in select screen takes no beatoraja kit.
    select.current = { identity: { family: 'built-in' }, updateKit: vi.fn() } as unknown as SelectScene;
    await service.applyBeatorajaSelectSkinConfig(SELECT.entryPath, config);
    expect(loadKit).not.toHaveBeenCalled();

    const updateKit = vi.fn();
    select.current = { identity: { family: 'beatoraja' }, updateKit } as unknown as SelectScene;
    await service.applyBeatorajaSelectSkinConfig(SELECT.entryPath, config);
    expect(loadKit).toHaveBeenCalledWith(
      expect.objectContaining({ entryPath: SELECT.entryPath, skinConfig: config, reloadTextures: true }),
    );
    const kit = { family: 'beatoraja', kit: { entryPath: SELECT.entryPath, skinConfig: config } };
    expect(updateKit).toHaveBeenCalledWith(kit);
    expect(service.beatorajaSelectKit).toMatchObject({ entryPath: SELECT.entryPath, kit });
    expect(options.refreshBeatorajaSelectSkinOptions).toHaveBeenCalledOnce();
  });

  test('new options for the play entry go to the play on the stage, and are dropped once it is gone', async () => {
    const { service, options, play } = harness();
    await drop(service, FULL());
    const config = { offset: 5 } as unknown as BeatorajaSkinConfig;
    const updateKit = vi.fn();
    play.current = { identity: { family: 'beatoraja' }, updateKit } as unknown as PlayScene;
    service.activeBeatorajaPlay = { entryPath: PLAY_7.entryPath, header: PLAY_7.header, variant: '7' };
    await service.applyBeatorajaPlaySkinConfig(PLAY_7_B.entryPath, config);
    expect(updateKit).toHaveBeenCalledWith({
      family: 'beatoraja',
      kit: { entryPath: PLAY_7_B.entryPath, skinConfig: config },
    });
    expect(service.activeBeatorajaPlay).toEqual({
      entryPath: PLAY_7_B.entryPath,
      header: { type: 0, name: PLAY_7_B.entryPath },
      variant: '7',
    });
    expect(options.refreshBeatorajaPlaySkinOptions).toHaveBeenCalledOnce();

    // The play leaves the stage while the entry loads: the kit is not handed to anything.
    loadKit.mockImplementationOnce(async (load) => {
      play.current = undefined;
      return loaded(load.entryPath, load.skinConfig);
    });
    await service.applyBeatorajaPlaySkinConfig(PLAY_7.entryPath, config);
    expect(updateKit).toHaveBeenCalledOnce();
    expect(options.refreshBeatorajaPlaySkinOptions).toHaveBeenCalledOnce();
  });

  test('the play entry belongs to the play it was set for: another play held, or none, has none', async () => {
    const { service, play } = harness();
    await drop(service, FULL());
    const updateKit = vi.fn();
    const started = { identity: { family: 'beatoraja' }, updateKit } as unknown as PlayScene;
    play.current = started;
    const entry = { entryPath: PLAY_7.entryPath, header: PLAY_7.header, variant: '7' as const };
    service.activeBeatorajaPlay = entry;
    expect(service.activeBeatorajaPlay).toEqual(entry);

    // The next play loads behind a decide screen: the entry of the play before is not its entry.
    const next = { identity: { family: 'beatoraja' }, updateKit: vi.fn() } as unknown as PlayScene;
    play.current = next;
    expect(service.activeBeatorajaPlay).toBeUndefined();
    await service.applyBeatorajaPlaySkinConfig(PLAY_7_B.entryPath, {} as BeatorajaSkinConfig);
    expect(loadKit).not.toHaveBeenCalled();
    play.current = undefined;
    expect(service.activeBeatorajaPlay).toBeUndefined();

    // Set as the next play takes the stage, it is that play's; a play on another family sets none.
    play.current = next;
    service.activeBeatorajaPlay = entry;
    expect(service.activeBeatorajaPlay).toEqual(entry);
    service.activeBeatorajaPlay = undefined;
    expect(service.activeBeatorajaPlay).toBeUndefined();
  });

  test("an entry's options are kept by entry path, seeded from its header", async () => {
    const { service } = harness();
    await drop(service, FULL());
    const header = { type: 5, name: 'select', property: [], filepath: [] } as never;
    const config = service.beatorajaSkinConfig(SELECT.entryPath, header);
    expect(service.beatorajaKitCaches.skinConfigs.get(SELECT.entryPath)).toBe(config);
    expect(service.beatorajaSkinConfig(SELECT.entryPath, header)).toBe(config);
  });
});
