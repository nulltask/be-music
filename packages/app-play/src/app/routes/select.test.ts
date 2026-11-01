import { createEmptyJSON } from '@be-music/chart-source';
import type { LR2Skin } from '@be-music/skin-lr2';
import type { AudioService } from '@be-music/player-browser/audio';
import { describeChartCollection, type BrowserChartCollection } from '@be-music/player-browser/collection';
import {
  createSelectScene,
  type PlayScene,
  type SelectScene,
  type SelectSceneKit,
  type SelectSceneOptions,
} from '@be-music/player-browser/host';
import type { BeatorajaThemeBundle } from '@be-music/player-browser/skin';
import type { BeatorajaSkinConfig } from '@be-music/skin-beatoraja';
import { parseBeatorajaCourseData } from '@be-music/player-engine/course';
import type { BrowseSnapshot, LibraryChart, LibraryCourse, PlayOptions } from '@be-music/player-scene-model';
import { describe, expect, test, vi } from 'vite-plus/test';
import type { FamilyDispatchState } from '../../family-dispatch.ts';
import { CourseRunService } from '../../services/courses.ts';
import { PlayOptionsService } from '../../services/play-options.ts';
import type { PlayerScene, PlayerWebElements } from '../../types.ts';
import type { DebugMenu } from '../../ui/debug-menu/index.ts';
import { SceneRouter } from '../scene-router.ts';
import { SelectRoute, type SelectRouteDeps } from './select.ts';

vi.mock('@be-music/player-browser/host', () => ({ createSelectScene: vi.fn() }));

type Family = SelectSceneKit['family'];

function chartEntry(id: string): LibraryChart {
  return {
    id,
    sourceId: 'drop1',
    sourceLabel: 'pack',
    sourceKind: 'directory',
    chartPath: `${id}.bms`,
    directoryLabel: 'pack',
    fileLabel: `${id}.bms`,
    title: id,
    artist: 'artist',
    totalNotes: 10,
    chart: createEmptyJSON('bms'),
  };
}

/** A GRADE course of charts `a` and `b`. */
function course(playable = true): LibraryCourse {
  const definition = parseBeatorajaCourseData({
    name: 'Dan',
    hash: [{ md5: '1'.repeat(32) }, { md5: '2'.repeat(32) }],
    constraint: ['CLASS'],
  })!;
  const b = playable ? { title: 'b', chart: chartEntry('b') } : { title: 'b' };
  return { id: 'dan#0', definition, stages: [{ title: 'a', chart: chartEntry('a') }, b], playable };
}

/** Where the select screen was left, and where a course was started from. */
const AT_FOLDER = { folderPath: ['pack'] } as unknown as BrowseSnapshot;
const AT_COURSE_BAR = { folderPath: ['courses'] } as unknown as BrowseSnapshot;
/** Where the player browsed to after coming back, and where a drop opens what it brought. */
const AT_FIXTURE = { folderPath: ['fixtures'] } as unknown as BrowseSnapshot;
const AT_DROPPED = { folderPath: ['dropped'] } as unknown as BrowseSnapshot;

const BUILT_IN_KIT = { family: 'built-in' } as unknown as SelectSceneKit;
const LR2_SKIN = { barLayout: { slots: [{}] } } as unknown as LR2Skin;
const BEATORAJA_KIT = { family: 'beatoraja', entryPath: 'select/select.json' } as unknown as SelectSceneKit;

/** A select scene as `createSelectScene` makes it: the kit and options it was made with, and what it was told. */
interface FakeSelect {
  readonly identity: { readonly kind: 'select'; readonly family: Family };
  readonly kit: SelectSceneKit;
  readonly options: SelectSceneOptions;
  readonly updateKit: ReturnType<typeof vi.fn<(kit: SelectSceneKit) => void>>;
  readonly setSounds: ReturnType<typeof vi.fn<(sounds: unknown) => void>>;
  readonly setLibrary: ReturnType<typeof vi.fn<(library: BrowserChartCollection) => void>>;
  readonly restore: ReturnType<typeof vi.fn<(snapshot: BrowseSnapshot) => void>>;
  readonly snapshot: ReturnType<typeof vi.fn<() => BrowseSnapshot>>;
  readonly dispose: ReturnType<typeof vi.fn<() => void>>;
}

function fakeSelect(kit: SelectSceneKit, options: SelectSceneOptions): FakeSelect {
  return {
    identity: { kind: 'select', family: kit.family },
    kit,
    options,
    updateKit: vi.fn(),
    setSounds: vi.fn(),
    setLibrary: vi.fn(),
    restore: vi.fn(),
    snapshot: vi.fn(() => ({ folderPath: [`left on ${kit.family}`] }) as unknown as BrowseSnapshot),
    dispose: vi.fn(),
  };
}

/** The shell's class list, as a set. */
function fakeShell(): { readonly classes: Set<string>; readonly shell: HTMLDivElement } {
  const classes = new Set<string>();
  const classList = {
    add: (name: string) => void classes.add(name),
    remove: (name: string) => void classes.delete(name),
    toggle: (name: string, force?: boolean) => {
      const on = force ?? !classes.has(name);
      if (on) classes.add(name);
      else classes.delete(name);
      return on;
    },
  };
  return { classes, shell: { classList } as unknown as HTMLDivElement };
}

/** The select route on a real scene router over a fake stage, with fake services; `family` picks the family. */
function harness(options: { charts?: LibraryChart[] } = {}) {
  let family: Family = 'built-in';
  const state = (): FamilyDispatchState => ({
    beatorajaTheme:
      family === 'beatoraja' ? ({ theme: { selectSkin: {} } } as unknown as BeatorajaThemeBundle) : undefined,
    selectSkin: family === 'lr2' ? LR2_SKIN : undefined,
    decideSkin: undefined,
    resultSkin: undefined,
    playSkins: {},
    skinFamilyOverride: 'auto',
  });
  const stage: (PlayerScene | undefined)[] = [];
  const router = new SceneRouter<PlayerScene, PlayScene, SelectScene>({
    host: {
      setScene: async (scene) => {
        stage.push(scene);
      },
    },
    recorder: { finalize: async () => {} },
  });
  const made: FakeSelect[] = [];
  vi.mocked(createSelectScene).mockImplementation((kit, sceneOptions) => {
    const scene = fakeSelect(kit, sceneOptions);
    made.push(scene);
    return scene as unknown as SelectScene;
  });
  const { classes, shell } = fakeShell();
  const courses = new CourseRunService();
  const playOptions = new PlayOptionsService({ hiSpeed: 2 });
  const lr2: { selectSkin: LR2Skin | undefined } = { selectSkin: undefined };
  const deps = {
    router,
    elements: { shell } as Pick<PlayerWebElements, 'shell'>,
    library: {
      collection: { sources: [], charts: options.charts ?? [chartEntry('a')], errors: [] } as BrowserChartCollection,
    },
    records: {
      lookupChartBestRecord: vi.fn<SelectRouteDeps['records']['lookupChartBestRecord']>(() => undefined),
      currentRulesetRecords: vi.fn<SelectRouteDeps['records']['currentRulesetRecords']>(() => new Map()),
      currentDanRanks: vi.fn<SelectRouteDeps['records']['currentDanRanks']>(() => []),
    },
    courses,
    courseRoute: { startCourse: vi.fn<SelectRouteDeps['courseRoute']['startCourse']>(async () => {}) },
    courseMaker: {
      maker: {} as SelectRouteDeps['courseMaker']['maker'],
      panel: undefined,
      addChartToCourseBeingMade: vi.fn<SelectRouteDeps['courseMaker']['addChartToCourseBeingMade']>(() => false),
    },
    familyKits: {
      familyDispatchState: state,
      selectSoundSet: vi.fn((kitFamily: Family) => ({ selectBGM: { path: `${kitFamily}.ogg` } })),
    },
    lr2,
    beatoraja: {
      loadBeatorajaSelectKit: vi.fn(async () => BEATORAJA_KIT),
      beatorajaSelectKit: undefined as { readonly entryPath: string } | undefined,
      beatorajaKitCaches: { skinConfigs: new Map<string, BeatorajaSkinConfig>() },
      applyBeatorajaSelectSkinConfig: vi.fn(async () => {}),
    },
    builtIn: { builtInKit: BUILT_IN_KIT },
    playOptions,
    guiState: {
      autoPlay: false,
      gauge: 'GROOVE',
      random1P: 'OFF',
      random2P: 'OFF',
      dpFlip: false,
      autoScratch1P: false,
      autoScratch2P: false,
      sort: 'OFF',
      keysFilter: 'ALL',
      difficultyFilter: 'ALL',
      hiSpeed: 2,
      nonstopPlacement: 'intended',
    },
    audio: {} as AudioService,
    search: { openFromPointer: vi.fn() },
    debugMenu: { refreshPlayOptionControllers: vi.fn(), scheduleFirstRunResolutionDetect: vi.fn() },
    beatorajaSkinOptions: { refreshBeatorajaSelectSkinOptions: vi.fn(), clear: vi.fn() },
    playStatusShown: vi.fn(() => false),
    setStatus: vi.fn<SelectRouteDeps['setStatus']>(),
    unlockReplayOptions: vi.fn<SelectRouteDeps['unlockReplayOptions']>(),
    rememberHiSpeed: vi.fn<SelectRouteDeps['rememberHiSpeed']>(),
    showDecide: vi.fn<SelectRouteDeps['showDecide']>(async () => {}),
    replaySlots: { exists: vi.fn(() => [false, false, false, false]) },
    replaySlotsPanel: { showSelect: vi.fn() },
    startReplayFromSlot: vi.fn<SelectRouteDeps['startReplayFromSlot']>(() => true),
  };
  const route = new SelectRoute({
    ...deps,
    // The fakes stand in for the services' types.
    beatoraja: deps.beatoraja as unknown as SelectRouteDeps['beatoraja'],
    guiState: deps.guiState as SelectRouteDeps['guiState'],
    debugMenu: deps.debugMenu as unknown as DebugMenu,
    builtIn: deps.builtIn as unknown as SelectRouteDeps['builtIn'],
    familyKits: deps.familyKits as unknown as SelectRouteDeps['familyKits'],
  });
  const setFamily = (next: Family): void => {
    family = next;
    lr2.selectSkin = next === 'lr2' ? LR2_SKIN : undefined;
  };
  return { route, router, deps, made, stage, classes, courses, playOptions, setFamily };
}

/** The scene the route made last, and what it was made with. */
function lastMade(h: ReturnType<typeof harness>): FakeSelect {
  return h.made.at(-1)!;
}

describe('SelectRoute: the first select screen', () => {
  test('it starts from the play options in force, the library and the cursor, with its family’s sounds', async () => {
    const h = harness();
    h.route.lastSelectNavigation = AT_FOLDER;
    h.classes.add('playing');
    await h.route.showSelect();

    expect(h.made).toHaveLength(1);
    const scene = lastMade(h);
    expect(scene.kit).toBe(BUILT_IN_KIT);
    expect(scene.options.library).toBe(h.deps.library.collection);
    expect(scene.options.browse).toBe(AT_FOLDER);
    expect(scene.options.playOptions).toEqual(h.playOptions.current);
    expect(scene.options.sounds).toEqual({ selectBGM: { path: 'built-in.ogg' } });
    expect(scene.options.audio).toBe(h.deps.audio);
    expect(scene.options.courseMaker).toBe(h.deps.courseMaker.maker);
    // The router shows it as its select scene, and keeps it.
    expect(h.router.current).toBe(scene);
    expect(h.router.select).toBe(scene);
    expect(h.stage).toEqual([scene]);
    expect(h.deps.debugMenu.scheduleFirstRunResolutionDetect).toHaveBeenCalledOnce();
    expect(h.deps.beatorajaSkinOptions.refreshBeatorajaSelectSkinOptions).not.toHaveBeenCalled();
    expect(h.deps.unlockReplayOptions).toHaveBeenCalledOnce();
    expect([...h.classes]).toEqual([]);
  });

  test('an empty library shows the drop hint on the built-in screen, a beatoraja theme loaded or not', async () => {
    const h = harness({ charts: [] });
    h.setFamily('beatoraja');
    await h.route.showSelect();
    expect(h.deps.beatoraja.loadBeatorajaSelectKit).not.toHaveBeenCalled();
    expect(lastMade(h).kit).toBe(BUILT_IN_KIT);
    expect(h.classes.has('empty')).toBe(true);
  });

  test('an LR2 theme’s select skin draws it, with the LR2 theme’s sounds', async () => {
    const h = harness();
    h.setFamily('lr2');
    await h.route.showSelect();
    expect(lastMade(h).kit).toEqual({ family: 'lr2', skin: LR2_SKIN });
    expect(lastMade(h).options.sounds).toEqual({ selectBGM: { path: 'lr2.ogg' } });
  });

  test('the status line goes back to the library when it described a play or result', async () => {
    const h = harness();
    await h.route.showSelect();
    expect(h.deps.setStatus).not.toHaveBeenCalled();
    h.deps.playStatusShown.mockReturnValue(true);
    await h.route.showSelect();
    expect(h.deps.setStatus).toHaveBeenCalledWith(describeChartCollection(h.deps.library.collection));
  });

  test('a newer navigation begun before it shows disposes it, and the screen does nothing more', async () => {
    const h = harness();
    const showing = h.route.showSelect();
    h.router.begin();
    await showing;
    expect(lastMade(h).dispose).toHaveBeenCalledOnce();
    expect(h.router.select).toBeUndefined();
    expect(h.stage).toEqual([]);
    expect(h.deps.debugMenu.scheduleFirstRunResolutionDetect).not.toHaveBeenCalled();
  });
});

describe('SelectRoute: coming back to the select screen', () => {
  test('the kept screen takes the latest skin, sounds and library before it shows again, then the cursor', async () => {
    const h = harness();
    h.setFamily('lr2');
    await h.route.showSelect();
    const scene = lastMade(h);
    // A play took the stage; the router kept the select scene off it.
    await h.router.leave();
    h.route.lastSelectNavigation = AT_FOLDER;
    const shownBefore = h.stage.length;

    await h.route.showSelect();
    expect(h.made).toHaveLength(1);
    expect(scene.dispose).not.toHaveBeenCalled();
    expect(h.router.current).toBe(scene);
    expect(h.stage.slice(shownBefore)).toEqual([scene]);
    expect(scene.updateKit).toHaveBeenCalledWith({ family: 'lr2', skin: LR2_SKIN });
    expect(scene.setSounds).toHaveBeenCalledWith({ selectBGM: { path: 'lr2.ogg' } });
    expect(scene.setLibrary).toHaveBeenCalledWith(h.deps.library.collection);
    expect(scene.restore).toHaveBeenCalledWith(AT_FOLDER);
    // The skin and sounds go on before it enters (its BGM starts as it enters), the cursor once it is up.
    const takes = Math.max(
      ...[scene.updateKit, scene.setSounds, scene.setLibrary].map((fn) => fn.mock.invocationCallOrder[0]!),
    );
    expect(takes).toBeLessThan(scene.restore.mock.invocationCallOrder[0]!);
    expect(h.deps.debugMenu.scheduleFirstRunResolutionDetect).toHaveBeenCalledOnce();
  });

  test('the built-in screen keeps its own kit on a return', async () => {
    const h = harness();
    await h.route.showSelect();
    await h.router.leave();
    await h.route.showSelect();
    expect(lastMade(h).updateKit).not.toHaveBeenCalled();
    expect(lastMade(h).setSounds).toHaveBeenCalledOnce();
  });

  test('back from a course, the cursor returns to the course bar it was started from, once', async () => {
    const h = harness();
    await h.route.showSelect();
    h.route.lastSelectNavigation = AT_FOLDER;
    h.courses.leaveSelect(AT_COURSE_BAR);
    await h.router.leave();
    await h.route.showSelect();
    expect(lastMade(h).restore).toHaveBeenLastCalledWith(AT_COURSE_BAR);
    // Neither the route nor the course run holds on to it: the screen's own cursor is the place from now on.
    expect(h.route.lastSelectNavigation).toBeUndefined();
    expect(h.courses.takeReturnNavigation()).toBeUndefined();
  });

  test('while a course runs, the cursor stays where the select screen was', async () => {
    const h = harness();
    await h.route.showSelect();
    h.route.lastSelectNavigation = AT_FOLDER;
    h.courses.leaveSelect(AT_COURSE_BAR);
    h.courses.beginRun(course());
    await h.router.leave();
    await h.route.showSelect();
    expect(lastMade(h).restore).toHaveBeenLastCalledWith(AT_FOLDER);
  });

  test('another family drops the kept screen and makes the next one, carrying the cursor across', async () => {
    const h = harness();
    await h.route.showSelect();
    const builtIn = lastMade(h);
    h.setFamily('lr2');
    await h.route.showSelect();
    expect(builtIn.dispose).toHaveBeenCalledOnce();
    const lr2 = lastMade(h);
    expect(lr2).not.toBe(builtIn);
    expect(lr2.kit).toEqual({ family: 'lr2', skin: LR2_SKIN });
    expect(lr2.options.browse).toEqual({ folderPath: ['left on built-in'] });
    expect(h.router.select).toBe(lr2);
    expect(h.router.current).toBe(lr2);
  });

  test('a cursor kept already wins over the dropped screen’s own', async () => {
    const h = harness();
    await h.route.showSelect();
    h.route.lastSelectNavigation = AT_FOLDER;
    h.setFamily('lr2');
    await h.route.showSelect();
    expect(lastMade(h).options.browse).toBe(AT_FOLDER);
  });

  test('the cursor kept for a return is taken once: the next showing leaves the screen’s own cursor alone', async () => {
    const h = harness();
    await h.route.showSelect();
    const scene = lastMade(h);
    // A play started on the folder and came back to it.
    h.route.lastSelectNavigation = AT_FOLDER;
    await h.router.leave();
    await h.route.showSelect();
    expect(scene.restore).toHaveBeenCalledExactlyOnceWith(AT_FOLDER);
    expect(h.route.lastSelectNavigation).toBeUndefined();
    // Files loading take the screen off the stage and bring it back, the cursor where the player left it.
    await h.router.leave();
    await h.route.showSelect();
    expect(scene.restore).toHaveBeenCalledOnce();
  });

  test('after a play, another family’s screen opens on the cursor as it is now, not where the play started', async () => {
    const h = harness();
    await h.route.showSelect();
    const builtIn = lastMade(h);
    h.route.lastSelectNavigation = AT_FOLDER;
    await h.router.leave();
    await h.route.showSelect();
    // The player browses on, then a theme of another family is dropped.
    builtIn.snapshot.mockReturnValue(AT_FIXTURE);
    h.setFamily('beatoraja');
    await h.route.showSelect();
    expect(lastMade(h).kit).toBe(BEATORAJA_KIT);
    expect(lastMade(h).options.browse).toBe(AT_FIXTURE);
  });

  test('after a course, another family’s screen opens on the cursor as it is now, not on the course bar', async () => {
    const h = harness();
    h.setFamily('lr2');
    await h.route.showSelect();
    const lr2 = lastMade(h);
    // A course started on its bar and was given up.
    h.courses.leaveSelect(AT_COURSE_BAR);
    await h.router.leave();
    await h.route.showSelect();
    expect(lr2.restore).toHaveBeenLastCalledWith(AT_COURSE_BAR);
    lr2.snapshot.mockReturnValue(AT_FIXTURE);
    h.setFamily('beatoraja');
    await h.route.showSelect();
    expect(lastMade(h).options.browse).toBe(AT_FIXTURE);
  });

  test('after a return, what a drop brought still wins over the cursor when another family takes the screen over', async () => {
    const h = harness();
    await h.route.showSelect();
    h.route.lastSelectNavigation = AT_FOLDER;
    await h.router.leave();
    await h.route.showSelect();
    // A drop of charts and another family's theme opens what it brought (`LibraryService` → `browseTo`).
    h.route.lastSelectNavigation = AT_DROPPED;
    h.setFamily('lr2');
    await h.route.showSelect();
    expect(lastMade(h).options.browse).toBe(AT_DROPPED);
    expect(h.route.lastSelectNavigation).toBeUndefined();
  });

  test('back from a course as another family takes the screen over, the new screen opens on the course bar', async () => {
    const h = harness();
    await h.route.showSelect();
    h.courses.leaveSelect(AT_COURSE_BAR);
    await h.router.leave();
    h.setFamily('lr2');
    await h.route.showSelect();
    expect(lastMade(h).options.browse).toBe(AT_COURSE_BAR);
  });

  test('a beatoraja theme’s select entry goes onto the kept screen on every return, and its skin options follow', async () => {
    const h = harness();
    h.setFamily('beatoraja');
    await h.route.showSelect();
    const scene = lastMade(h);
    expect(scene.kit).toBe(BEATORAJA_KIT);
    expect(scene.options.sounds).toEqual({ selectBGM: { path: 'beatoraja.ogg' } });
    expect(h.deps.beatorajaSkinOptions.refreshBeatorajaSelectSkinOptions).toHaveBeenCalledOnce();

    await h.router.leave();
    await h.route.showSelect();
    // The theme service hands the entry it loaded once again (its kit cache); the route takes no other.
    expect(h.deps.beatoraja.loadBeatorajaSelectKit).toHaveBeenCalledTimes(2);
    expect(h.made).toHaveLength(1);
    expect(scene.updateKit).toHaveBeenCalledWith(BEATORAJA_KIT);
    expect(h.deps.beatorajaSkinOptions.refreshBeatorajaSelectSkinOptions).toHaveBeenCalledTimes(2);
  });
});

describe('SelectRoute: dropping the screen for another skin system or LR2 theme', () => {
  test('the next screen opens on the cursor as it is now, not where the last play started', async () => {
    const h = harness();
    await h.route.showSelect();
    const builtIn = lastMade(h);
    h.route.lastSelectNavigation = AT_FOLDER;
    await h.router.leave();
    await h.route.showSelect();
    // The player browses on, then picks another skin system in the Debug Menu.
    builtIn.snapshot.mockReturnValue(AT_FIXTURE);
    await h.route.dropSelect();
    expect(builtIn.dispose).toHaveBeenCalledOnce();
    expect(h.router.select).toBeUndefined();
    h.setFamily('lr2');
    await h.route.showSelect();
    expect(lastMade(h).options.browse).toBe(AT_FIXTURE);
  });

  test('a place a drop or a course has put the cursor already wins over the dropped screen’s own', async () => {
    const h = harness();
    await h.route.showSelect();
    h.route.lastSelectNavigation = AT_DROPPED;
    await h.route.dropSelect();
    await h.route.showSelect();
    expect(lastMade(h).options.browse).toBe(AT_DROPPED);
  });

  test('with no screen up, it keeps only what it had', async () => {
    const h = harness();
    await h.route.dropSelect();
    expect(h.route.lastSelectNavigation).toBeUndefined();
    h.route.lastSelectNavigation = AT_DROPPED;
    await h.route.dropSelect();
    expect(h.route.lastSelectNavigation).toBe(AT_DROPPED);
  });
});

describe('SelectRoute: what the screen tells the app', () => {
  test('a chart started goes to its decide screen, with AUTO only from the skin’s AUTO', async () => {
    const h = harness();
    await h.route.showSelect();
    const { start } = lastMade(h).options.on;
    expect(start({ kind: 'chart', chart: chartEntry('a') }, { autoPlay: true })).toBe(true);
    expect(h.deps.showDecide).toHaveBeenLastCalledWith(chartEntry('a'), { autoPlay: true });
    expect(start({ kind: 'chart', chart: chartEntry('b') }, { autoPlay: false })).toBe(true);
    expect(h.deps.showDecide).toHaveBeenLastCalledWith(chartEntry('b'), {});
  });

  test('while a course is being made, a chart started joins it and plays nothing', async () => {
    const h = harness();
    h.deps.courseMaker.addChartToCourseBeingMade.mockReturnValue(true);
    await h.route.showSelect();
    expect(lastMade(h).options.on.start({ kind: 'chart', chart: chartEntry('a') }, { autoPlay: false })).toBe(false);
    expect(h.deps.courseMaker.addChartToCourseBeingMade).toHaveBeenCalledWith(chartEntry('a'));
    expect(h.deps.showDecide).not.toHaveBeenCalled();
  });

  test('a course bar goes to the course route, and starts a play only when it is playable', async () => {
    const h = harness();
    await h.route.showSelect();
    const { start } = lastMade(h).options.on;
    const playable = course();
    expect(start({ kind: 'course', course: playable }, { autoPlay: true })).toBe(true);
    expect(h.deps.courseRoute.startCourse).toHaveBeenLastCalledWith(playable, { autoPlay: true });
    const missing = course(false);
    expect(start({ kind: 'course', course: missing }, { autoPlay: false })).toBe(false);
    expect(h.deps.courseRoute.startCourse).toHaveBeenLastCalledWith(missing, {});
    expect(h.deps.showDecide).not.toHaveBeenCalled();
  });

  test('its play option edits go to the play options in force and the Debug Menu; a new hi-speed is remembered', async () => {
    const h = harness();
    await h.route.showSelect();
    const edit = (changes: Partial<PlayOptions>): void =>
      lastMade(h).options.on.playOptions!({ ...h.playOptions.current, ...changes });

    edit({ autoPlay: true, hsFix: 'MAXBPM' });
    expect(h.playOptions.current).toMatchObject({ autoPlay: true, hsFix: 'MAXBPM' });
    expect(h.deps.guiState.autoPlay).toBe(true);
    expect(h.deps.rememberHiSpeed).not.toHaveBeenCalled();
    expect(h.deps.debugMenu.refreshPlayOptionControllers).toHaveBeenCalledOnce();

    edit({ hiSpeed: 3.5 });
    expect(h.deps.rememberHiSpeed).toHaveBeenCalledWith(3.5, 'select');
  });

  test('Escape at the root of a beatoraja screen leaves it for the drop screen: the screen and the cursor go', async () => {
    const h = harness();
    h.setFamily('beatoraja');
    await h.route.showSelect();
    const scene = lastMade(h);
    h.route.lastSelectNavigation = AT_FOLDER;
    scene.options.on.exit!();
    expect(h.classes.has('empty')).toBe(true);
    expect(h.route.lastSelectNavigation).toBeUndefined();
    expect(h.deps.beatorajaSkinOptions.clear).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(scene.dispose).toHaveBeenCalledOnce());
    expect(h.router.select).toBeUndefined();
    expect(h.router.current).toBeUndefined();

    // Coming back (a drop or a theme) starts at the root.
    await h.route.showSelect();
    expect(lastMade(h)).not.toBe(scene);
    expect(lastMade(h).options.browse).toBeUndefined();
  });

  test('a beatoraja skin’s JUDGE TIMING keeps its options for the entry and loads it again with them', async () => {
    const h = harness();
    h.setFamily('beatoraja');
    await h.route.showSelect();
    const config = { offset: { 1: { x: 0 } } } as unknown as BeatorajaSkinConfig;
    const { skinConfigChange } = lastMade(h).options.on as { skinConfigChange(config: BeatorajaSkinConfig): void };

    skinConfigChange(config);
    expect(h.deps.beatoraja.applyBeatorajaSelectSkinConfig).not.toHaveBeenCalled();

    h.deps.beatoraja.beatorajaSelectKit = { entryPath: 'select/select.json' };
    skinConfigChange(config);
    expect(h.deps.beatoraja.beatorajaKitCaches.skinConfigs.get('select/select.json')).toBe(config);
    expect(h.deps.beatoraja.applyBeatorajaSelectSkinConfig).toHaveBeenCalledWith('select/select.json', config);
  });

  test('its bars show the records of the judge ruleset in force, and a skin’s search box opens the search field', async () => {
    const h = harness();
    await h.route.showSelect();
    const { records, on } = lastMade(h).options;
    records!.chart(chartEntry('a'));
    expect(h.deps.records.lookupChartBestRecord).toHaveBeenCalledWith(chartEntry('a'));
    expect(records!.course(course())).toBeUndefined();
    expect(h.deps.records.currentRulesetRecords).toHaveBeenCalled();
    expect(records!.danRanks!()).toEqual([]);
    expect(h.deps.records.currentDanRanks).toHaveBeenCalled();
    on.search!();
    expect(h.deps.search.openFromPointer).toHaveBeenCalledOnce();
  });
});
