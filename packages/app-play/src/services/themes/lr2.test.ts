import { loadLR2ThemeSkinsFromFiles, type LR2Skin, type LR2ThemeSkins } from '@be-music/skin-lr2';
import { resolveLR2CourseOps } from '@be-music/skin-lr2/state';
import { parseBeatorajaCourseData } from '@be-music/player-engine/course';
import { resolveCourseView, type CourseView, type LibraryCourse } from '@be-music/player-scene-model';
import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import type { LoadingOverlayElements } from '../../loading-overlay.ts';
import { nameJingle } from '../../test-hook.ts';
import { LR2ThemeService, type LR2ThemeServiceOptions } from './lr2.ts';

vi.mock('@be-music/skin-lr2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@be-music/skin-lr2')>();
  return { ...actual, loadLR2ThemeSkinsFromFiles: vi.fn() };
});

const loadThemeSkins = vi.mocked(loadLR2ThemeSkinsFromFiles);

/** A dropped file at `path` inside the drop. */
function dropped(path: string): File {
  return { name: path.split('/').at(-1)!, webkitRelativePath: path } as File;
}

function skin(name: string): LR2Skin {
  return { name } as unknown as LR2Skin;
}

const bytes = (value: number): { path: string; bytes: Uint8Array } => ({
  path: `${value}.wav`,
  bytes: new Uint8Array([value]),
});

/** What the theme loader reads from a theme's files; `overrides` replace the full set. */
function themeSkins(overrides: Partial<LR2ThemeSkins> = {}): LR2ThemeSkins {
  return {
    playSkins: { '7': skin('play7'), '14': skin('play14') },
    selectSkin: skin('select'),
    resultSkin: skin('result'),
    decideSkin: skin('decide'),
    courseResultSkin: skin('courseResult'),
    loadSkin: vi.fn(() => undefined),
    selectBGM: bytes(1),
    decideBGM: bytes(2),
    clearBGM: bytes(3),
    failBGM: bytes(4),
    resultBGM: bytes(5),
    courseClearBGM: bytes(6),
    courseFailBGM: bytes(7),
    systemSounds: { playStop: bytes(12), cursorMove: bytes(8), folderOpen: bytes(9), optionChange: bytes(10) },
    ...overrides,
  } as LR2ThemeSkins;
}

function harness(): { service: LR2ThemeService; options: LR2ThemeServiceOptions } {
  const options: LR2ThemeServiceOptions = {
    elements: {} as LoadingOverlayElements,
    setStatus: vi.fn(),
    rebuildSkinFamilyPicker: vi.fn(),
    rebuildLR2ThemePicker: vi.fn(),
  };
  return { service: new LR2ThemeService(options), options };
}

/** The paths of the files the theme loader was handed on its `call`-th load. */
function mountedPaths(call = 0): string[] {
  return [...loadThemeSkins.mock.calls[call]![0]].map((file) => (file as File).webkitRelativePath);
}

function courseView(stageIndex?: number): CourseView {
  const definition = parseBeatorajaCourseData({
    name: 'Dan',
    hash: [{ md5: '1'.repeat(32) }, { md5: '2'.repeat(32) }],
    constraint: ['grade'],
  })!;
  const course: LibraryCourse = { id: 'dan#0', definition, stages: [{ title: 'a' }, { title: 'b' }], playable: true };
  return resolveCourseView(course, stageIndex);
}

const ALPHA = ['drop/LR2files/Theme/Alpha/play.lr2skin', 'drop/LR2files/Theme/Alpha/img/frame.png'];
const ZETA = ['drop/LR2files/Theme/Zeta/select.lr2skin'];
const BETA = ['drop/LR2files/Theme/Beta/play.lr2skin'];

beforeEach(() => {
  vi.clearAllMocks();
  loadThemeSkins.mockImplementation(async () => themeSkins());
});

describe('LR2ThemeService.loadTheme', () => {
  test("mounts the drop's first theme with the LR2files folders outside Theme/, and lists every theme", async () => {
    const { service, options } = harness();
    await service.loadTheme(
      [
        ...ZETA,
        ...ALPHA,
        'drop/LR2files/BGM/alpha/select.wav',
        'drop/LR2files/WallPaper/Select/a.bmp',
        'drop/a.bms',
      ].map(dropped),
    );
    expect(mountedPaths()).toEqual([
      ...ALPHA,
      'drop/LR2files/BGM/alpha/select.wav',
      'drop/LR2files/WallPaper/Select/a.bmp',
    ]);
    expect(service.activeLR2ThemeName).toBe('Alpha');
    expect(service.availableLR2Themes.map((theme) => theme.name)).toEqual(['Alpha', 'Zeta']);
    expect(options.setStatus).toHaveBeenCalledWith('Loading LR2 theme "Alpha"...');
  });

  test('a later drop adds its themes; re-dropping the mounted theme mounts it again, another drop its own first', async () => {
    const { service } = harness();
    await service.loadTheme([...ALPHA, ...ZETA].map(dropped));
    const zeta = service.availableLR2Themes.find((theme) => theme.name === 'Zeta')!;
    // The LR2 theme picker mounts another of the themes listed.
    await service.mountLR2Theme(zeta.files, zeta.name);
    expect(service.activeLR2ThemeName).toBe('Zeta');

    await service.loadTheme([...BETA, ...ZETA].map(dropped));
    expect(service.activeLR2ThemeName).toBe('Zeta');
    expect(mountedPaths(2)).toEqual(ZETA);
    expect(service.availableLR2Themes.map((theme) => theme.name)).toEqual(['Alpha', 'Beta', 'Zeta']);

    await service.loadTheme(BETA.map(dropped));
    expect(service.activeLR2ThemeName).toBe('Beta');
  });

  test('a drop without LR2files/Theme/<name>/ is mounted whole as one theme and lists none', async () => {
    const { service } = harness();
    await service.loadTheme([...ALPHA, ...ZETA].map(dropped));
    await service.loadTheme(['skin/play.lr2skin', 'skin/frame.png'].map(dropped));
    expect(mountedPaths(1)).toEqual(['skin/play.lr2skin', 'skin/frame.png']);
    expect(service.availableLR2Themes).toEqual([]);
    expect(service.activeLR2ThemeName).toBeUndefined();
  });
});

describe('LR2ThemeService.mountLR2Theme', () => {
  test("replaces the previous theme's skins and sounds, then rebuilds the pickers", async () => {
    const { service, options } = harness();
    await service.mountLR2Theme(ALPHA.map(dropped), 'Alpha');
    const playSkins = service.playSkins;
    const play7 = skin('other7');
    loadThemeSkins.mockImplementationOnce(async () =>
      themeSkins({
        playSkins: { '7': play7 },
        decideSkin: undefined,
        decideBGM: undefined,
        systemSounds: { cursorMove: bytes(11) },
      }),
    );
    vi.mocked(options.rebuildSkinFamilyPicker).mockImplementation(() => {
      // The pickers see the new theme.
      expect(service.activeLR2ThemeName).toBe('Zeta');
      expect(service.decideSkin).toBeUndefined();
    });
    await service.mountLR2Theme(ZETA.map(dropped), 'Zeta');

    // The same map, emptied and filled, so a holder of it sees the new skins.
    expect(service.playSkins).toBe(playSkins);
    expect(service.playSkins).toEqual({ '7': play7 });
    expect(Object.keys(service.selectSoundSet())).toEqual(['selectBGM', 'cursor']);
    expect(options.rebuildSkinFamilyPicker).toHaveBeenCalledTimes(2);
    expect(options.rebuildLR2ThemePicker).toHaveBeenCalledTimes(2);
  });

  test("the select sounds are the theme's select BGM, decide jingle and cues, by slot", async () => {
    const { service } = harness();
    expect(service.selectSoundSet()).toEqual({});
    await service.mountLR2Theme(ALPHA.map(dropped), 'Alpha');
    expect(service.selectSoundSet()).toEqual({
      selectBGM: { bytes: new Uint8Array([1]) },
      decideBGM: { bytes: new Uint8Array([2]) },
      playStop: { bytes: new Uint8Array([12]) },
      cursor: { bytes: new Uint8Array([8]) },
      folderOpen: { bytes: new Uint8Array([9]) },
      optionChange: { bytes: new Uint8Array([10]) },
    });
  });

  test('the result jingles keep the slot names the test hook reports', async () => {
    const { service } = harness();
    const theme = themeSkins();
    loadThemeSkins.mockImplementationOnce(async () => theme);
    await service.mountLR2Theme(ALPHA.map(dropped), 'Alpha');
    const jingles = service.resultJingles();
    expect(Object.keys(jingles)).toEqual(['clear', 'fail', 'result', 'courseClear', 'courseFail']);
    expect(nameJingle(theme.clearBGM!.bytes, { lr2: jingles })).toBe('lr2:clear');
    expect(nameJingle(theme.courseClearBGM!.bytes, { lr2: jingles })).toBe('lr2:courseClear');
    expect(nameJingle(theme.courseFailBGM!.bytes, { lr2: jingles })).toBe('lr2:courseFail');
  });
});

describe('LR2ThemeService.courseLR2Skin', () => {
  test("parses the mounted theme's skin again with the course ops, falling back to the skin as mounted", async () => {
    const { service } = harness();
    const mounted = skin('result');
    expect(service.courseLR2Skin(mounted, courseView(), { kind: 'result' })).toBe(mounted);

    const reparsed = skin('result (course)');
    const loadSkin = vi.fn(() => reparsed);
    loadThemeSkins.mockImplementationOnce(async () => themeSkins({ loadSkin }));
    await service.mountLR2Theme(ALPHA.map(dropped), 'Alpha');
    const stage = courseView(1);
    expect(service.courseLR2Skin(mounted, stage, { kind: 'result' })).toBe(reparsed);
    expect(loadSkin).toHaveBeenCalledWith({ kind: 'result', parseOps: resolveLR2CourseOps(stage) });

    loadSkin.mockReturnValueOnce(undefined as never);
    expect(service.courseLR2Skin(mounted, stage, { kind: 'result' })).toBe(mounted);
    expect(service.courseLR2Skin(undefined, stage, { kind: 'result' })).toBeUndefined();
  });
});
