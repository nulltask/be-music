import { loadLr2ThemeSkinsFromFiles, type Lr2Skin, type Lr2ThemeSkins } from '@be-music/lr2-skin';
import { resolveLr2CourseOps } from '@be-music/lr2-skin/state';
import { parseBeatorajaCourseData } from '@be-music/player/course';
import { resolveCourseView, type CourseView, type LibraryCourse } from '@be-music/scene-model';
import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import type { LoadingOverlayElements } from '../../loading-overlay.ts';
import { nameJingle } from '../../test-hook.ts';
import { Lr2ThemeService, type Lr2ThemeServiceOptions } from './lr2.ts';

vi.mock('@be-music/lr2-skin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@be-music/lr2-skin')>();
  return { ...actual, loadLr2ThemeSkinsFromFiles: vi.fn() };
});

const loadThemeSkins = vi.mocked(loadLr2ThemeSkinsFromFiles);

/** A dropped file at `path` inside the drop. */
function dropped(path: string): File {
  return { name: path.split('/').at(-1)!, webkitRelativePath: path } as File;
}

function skin(name: string): Lr2Skin {
  return { name } as unknown as Lr2Skin;
}

const bytes = (value: number): { path: string; bytes: Uint8Array } => ({
  path: `${value}.wav`,
  bytes: new Uint8Array([value]),
});

/** What the theme loader reads from a theme's files; `overrides` replace the full set. */
function themeSkins(overrides: Partial<Lr2ThemeSkins> = {}): Lr2ThemeSkins {
  return {
    playSkins: { '7': skin('play7'), '14': skin('play14') },
    selectSkin: skin('select'),
    resultSkin: skin('result'),
    decideSkin: skin('decide'),
    courseResultSkin: skin('courseResult'),
    loadSkin: vi.fn(() => undefined),
    selectBgm: bytes(1),
    decideBgm: bytes(2),
    clearBgm: bytes(3),
    failBgm: bytes(4),
    resultBgm: bytes(5),
    courseClearBgm: bytes(6),
    courseFailBgm: bytes(7),
    systemSounds: { cursorMove: bytes(8), folderOpen: bytes(9), optionChange: bytes(10) },
    ...overrides,
  } as Lr2ThemeSkins;
}

function harness(): { service: Lr2ThemeService; options: Lr2ThemeServiceOptions } {
  const options: Lr2ThemeServiceOptions = {
    elements: {} as LoadingOverlayElements,
    setStatus: vi.fn(),
    rebuildSkinFamilyPicker: vi.fn(),
    rebuildLr2ThemePicker: vi.fn(),
  };
  return { service: new Lr2ThemeService(options), options };
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

describe('Lr2ThemeService.loadTheme', () => {
  test("mounts the drop's first theme with the LR2files folders outside Theme/, and lists every theme", async () => {
    const { service, options } = harness();
    await service.loadTheme(
      [
        ...ZETA,
        ...ALPHA,
        'drop/LR2files/Bgm/alpha/select.wav',
        'drop/LR2files/WallPaper/Select/a.bmp',
        'drop/a.bms',
      ].map(dropped),
    );
    expect(mountedPaths()).toEqual([
      ...ALPHA,
      'drop/LR2files/Bgm/alpha/select.wav',
      'drop/LR2files/WallPaper/Select/a.bmp',
    ]);
    expect(service.activeLr2ThemeName).toBe('Alpha');
    expect(service.availableLr2Themes.map((theme) => theme.name)).toEqual(['Alpha', 'Zeta']);
    expect(options.setStatus).toHaveBeenCalledWith('Loading LR2 theme "Alpha"...');
  });

  test('a later drop adds its themes; re-dropping the mounted theme mounts it again, another drop its own first', async () => {
    const { service } = harness();
    await service.loadTheme([...ALPHA, ...ZETA].map(dropped));
    const zeta = service.availableLr2Themes.find((theme) => theme.name === 'Zeta')!;
    // The LR2 theme picker mounts another of the themes listed.
    await service.mountLr2Theme(zeta.files, zeta.name);
    expect(service.activeLr2ThemeName).toBe('Zeta');

    await service.loadTheme([...BETA, ...ZETA].map(dropped));
    expect(service.activeLr2ThemeName).toBe('Zeta');
    expect(mountedPaths(2)).toEqual(ZETA);
    expect(service.availableLr2Themes.map((theme) => theme.name)).toEqual(['Alpha', 'Beta', 'Zeta']);

    await service.loadTheme(BETA.map(dropped));
    expect(service.activeLr2ThemeName).toBe('Beta');
  });

  test('a drop without LR2files/Theme/<name>/ is mounted whole as one theme and lists none', async () => {
    const { service } = harness();
    await service.loadTheme([...ALPHA, ...ZETA].map(dropped));
    await service.loadTheme(['skin/play.lr2skin', 'skin/frame.png'].map(dropped));
    expect(mountedPaths(1)).toEqual(['skin/play.lr2skin', 'skin/frame.png']);
    expect(service.availableLr2Themes).toEqual([]);
    expect(service.activeLr2ThemeName).toBeUndefined();
  });
});

describe('Lr2ThemeService.mountLr2Theme', () => {
  test("replaces the previous theme's skins and sounds, then rebuilds the pickers", async () => {
    const { service, options } = harness();
    await service.mountLr2Theme(ALPHA.map(dropped), 'Alpha');
    const playSkins = service.playSkins;
    const play7 = skin('other7');
    loadThemeSkins.mockImplementationOnce(async () =>
      themeSkins({
        playSkins: { '7': play7 },
        decideSkin: undefined,
        decideBgm: undefined,
        systemSounds: { cursorMove: bytes(11) },
      }),
    );
    vi.mocked(options.rebuildSkinFamilyPicker).mockImplementation(() => {
      // The pickers see the new theme.
      expect(service.activeLr2ThemeName).toBe('Zeta');
      expect(service.decideSkin).toBeUndefined();
    });
    await service.mountLr2Theme(ZETA.map(dropped), 'Zeta');

    // The same map, emptied and filled, so a holder of it sees the new skins.
    expect(service.playSkins).toBe(playSkins);
    expect(service.playSkins).toEqual({ '7': play7 });
    expect(Object.keys(service.selectSoundSet())).toEqual(['selectBgm', 'cursor']);
    expect(options.rebuildSkinFamilyPicker).toHaveBeenCalledTimes(2);
    expect(options.rebuildLr2ThemePicker).toHaveBeenCalledTimes(2);
  });

  test("the select sounds are the theme's select BGM, decide jingle and cues, by slot", async () => {
    const { service } = harness();
    expect(service.selectSoundSet()).toEqual({});
    await service.mountLr2Theme(ALPHA.map(dropped), 'Alpha');
    expect(service.selectSoundSet()).toEqual({
      selectBgm: { bytes: new Uint8Array([1]) },
      decideBgm: { bytes: new Uint8Array([2]) },
      cursor: { bytes: new Uint8Array([8]) },
      folderOpen: { bytes: new Uint8Array([9]) },
      optionChange: { bytes: new Uint8Array([10]) },
    });
  });

  test('the result jingles keep the slot names the test hook reports', async () => {
    const { service } = harness();
    const theme = themeSkins();
    loadThemeSkins.mockImplementationOnce(async () => theme);
    await service.mountLr2Theme(ALPHA.map(dropped), 'Alpha');
    const jingles = service.resultJingles();
    expect(Object.keys(jingles)).toEqual(['clear', 'fail', 'result', 'courseClear', 'courseFail']);
    expect(nameJingle(theme.clearBgm!.bytes, { lr2: jingles })).toBe('lr2:clear');
    expect(nameJingle(theme.courseClearBgm!.bytes, { lr2: jingles })).toBe('lr2:courseClear');
    expect(nameJingle(theme.courseFailBgm!.bytes, { lr2: jingles })).toBe('lr2:courseFail');
  });
});

describe('Lr2ThemeService.courseLr2Skin', () => {
  test("parses the mounted theme's skin again with the course ops, falling back to the skin as mounted", async () => {
    const { service } = harness();
    const mounted = skin('result');
    expect(service.courseLr2Skin(mounted, courseView(), { kind: 'result' })).toBe(mounted);

    const reparsed = skin('result (course)');
    const loadSkin = vi.fn(() => reparsed);
    loadThemeSkins.mockImplementationOnce(async () => themeSkins({ loadSkin }));
    await service.mountLr2Theme(ALPHA.map(dropped), 'Alpha');
    const stage = courseView(1);
    expect(service.courseLr2Skin(mounted, stage, { kind: 'result' })).toBe(reparsed);
    expect(loadSkin).toHaveBeenCalledWith({ kind: 'result', parseOps: resolveLr2CourseOps(stage) });

    loadSkin.mockReturnValueOnce(undefined as never);
    expect(service.courseLr2Skin(mounted, stage, { kind: 'result' })).toBe(mounted);
    expect(service.courseLr2Skin(undefined, stage, { kind: 'result' })).toBeUndefined();
  });
});
