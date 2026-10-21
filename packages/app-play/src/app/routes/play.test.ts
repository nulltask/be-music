import { createEmptyJSON } from '@be-music/chart-source';
import type { ResolvedPlayChart } from '@be-music/player-engine';
import type { AudioService } from '@be-music/player-browser/audio';
import type { BrowserChartCollection, ChartFileHashes } from '@be-music/player-browser/collection';
import {
  createPlayScene,
  type PixiSceneHost,
  type PlayScene,
  type PlaySceneKit,
  type PlaySceneOptions,
  type SelectScene,
} from '@be-music/player-browser/host';
import type { CourseDefinition } from '@be-music/player-engine/course';
import type { BeMusicReplay } from '@be-music/player-engine/replay';
import type { BrowseSnapshot, LibraryChart, LibraryCourse, PlayResult } from '@be-music/player-scene-model';
import { describe, expect, test, vi } from 'vite-plus/test';
import { nextCourseStagePlay, type CourseStagePlay } from '../../course-flow.ts';
import type { DeviceProfile } from '../../device-profile.ts';
import { storeHiSpeed } from '../../hi-speed-storage.ts';
import type { PreparedNonstopPlay } from '../../nonstop-course.ts';
import { describePlayingStatus } from '../../play-tempo-settings.ts';
import { startArmedRecording, type RecordingDeps } from '../../recording-controller.ts';
import { CourseRunService } from '../../services/courses.ts';
import { PlayOptionsService } from '../../services/play-options.ts';
import type { BeatorajaPlayEntry } from '../../services/themes/beatoraja.ts';
import { courseStageRecordKey, playRecordKey } from '../../chart-best-records.ts';
import type { DemoScene, PlayerWebDemoElements } from '../../types.ts';
import type { DebugMenu } from '../../ui/debug-menu/index.ts';
import type { ResolvedPlayKit } from '../family-kits.ts';
import { SceneRouter } from '../scene-router.ts';
import type { NonstopPlay } from './nonstop.ts';
import { PlayRoute, type LastPlay, type PlayRouteDeps } from './play.ts';

vi.mock('@be-music/player-browser/host', () => ({ createPlayScene: vi.fn() }));
vi.mock('../../recording-controller.ts', () => ({ startArmedRecording: vi.fn() }));
vi.mock('../../hi-speed-storage.ts', () => ({ storeHiSpeed: vi.fn() }));

type Family = PlaySceneKit['family'];

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

/** A GRADE course of charts `a` and `b` (or a NONSTOP one). */
function course(kind: CourseDefinition['kind'] = 'grade'): LibraryCourse {
  const definition: CourseDefinition = {
    name: 'Dan',
    kind,
    stages: [{ md5: '1'.repeat(32) }, { md5: '2'.repeat(32) }],
    constraints: ['grade'],
    trophies: [],
    release: true,
    source: { format: 'beatoraja-json' },
  };
  return {
    id: 'dan#0',
    definition,
    stages: [
      { title: 'a', chart: chartEntry('a') },
      { title: 'b', chart: chartEntry('b') },
    ],
    playable: true,
  };
}

const HASHES = { sha256: 'f'.repeat(64), md5: 'e'.repeat(32) } as ChartFileHashes;
/** Where the select screen was when the chart was started. */
const AT_BAR = { folderPath: ['pack'] } as unknown as BrowseSnapshot;
const ENTRY_7: BeatorajaPlayEntry = { entryPath: 'skin/play7.luaskin', header: { type: 0 } as never, variant: '7' };
const ENTRY_14: BeatorajaPlayEntry = { entryPath: 'skin/play14.luaskin', header: { type: 1 } as never, variant: '14' };

const kitOf = (family: Family): PlaySceneKit => ({ family }) as unknown as PlaySceneKit;

/** A replay of an AUTO play. */
const REPLAY = { play: { mode: 'auto', autoScratch: false, gauge: 'GROOVE', tempo: 1.2 } } as unknown as BeMusicReplay;

/** A promise settled from outside: a play's load. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** A play as `createPlayScene` makes it: the kit and options it was made with, and what it was told. */
interface FakePlay {
  readonly identity: { readonly kind: 'play'; readonly family: Family };
  readonly kit: PlaySceneKit;
  readonly options: PlaySceneOptions;
  readonly load: ReturnType<typeof deferred>;
  readonly prepare: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly start: ReturnType<typeof vi.fn<() => void>>;
  readonly getTempo: () => number;
  readonly setHiSpeed: ReturnType<typeof vi.fn<(hiSpeed: number) => void>>;
  readonly waitForReplay: ReturnType<typeof vi.fn<() => Promise<BeMusicReplay | undefined>>>;
  readonly resolved: ResolvedPlayChart;
  readonly dispose: ReturnType<typeof vi.fn<(options?: { preserveAudioTail?: boolean }) => void>>;
}

/** The play route on a real scene router over a fake stage, with the select screen up and fake services. */
async function harness(options: { family?: Family; beatorajaPlay?: BeatorajaPlayEntry } = {}) {
  const stage: (DemoScene | undefined)[] = [];
  const onInterrupt = vi.fn();
  const router = new SceneRouter<DemoScene, PlayScene, SelectScene>({
    host: {
      setScene: async (scene) => {
        stage.push(scene);
      },
    },
    recorder: { finalize: async () => {} },
    onInterrupt,
  });
  const select = {
    identity: { kind: 'select', family: 'built-in' },
    snapshot: vi.fn(() => AT_BAR),
    dispose: vi.fn(),
  };
  await router.show(select as unknown as SelectScene, { role: 'select' });
  onInterrupt.mockClear();

  const plays: FakePlay[] = [];
  vi.mocked(createPlayScene).mockImplementation((kit, sceneOptions) => {
    const load = deferred();
    const play: FakePlay = {
      identity: { kind: 'play', family: kit.family },
      kit,
      options: sceneOptions,
      load,
      prepare: vi.fn(() => load.promise),
      start: vi.fn(),
      getTempo: () => sceneOptions.settings.tempo ?? 1,
      setHiSpeed: vi.fn(),
      waitForReplay: vi.fn(async () => undefined),
      resolved: { chart: createEmptyJSON('bms'), draws: [] } as unknown as ResolvedPlayChart,
      dispose: vi.fn(),
    };
    plays.push(play);
    return play as unknown as PlayScene;
  });
  const classes = new Set<string>();
  const shell = { classList: { add: (name: string) => void classes.add(name) } } as unknown as HTMLDivElement;
  const family = options.family ?? 'built-in';
  const recording = {} as RecordingDeps;
  const deps = {
    router,
    selectRoute: { lastSelectNavigation: undefined as BrowseSnapshot | undefined },
    elements: { shell } as Pick<PlayerWebDemoElements, 'shell'>,
    library: { collection: { sources: [], charts: [chartEntry('a')], errors: [] } as BrowserChartCollection },
    records: {
      resolveChartHashes: vi.fn<PlayRouteDeps['records']['resolveChartHashes']>(async () => HASHES),
      activePlayRecordKey: undefined as string | undefined,
      activeStageRecordKey: undefined as string | undefined,
      recordActiveCourseStage: vi.fn<PlayRouteDeps['records']['recordActiveCourseStage']>(),
    },
    familyKits: {
      resolvePlayKit: vi.fn<PlayRouteDeps['familyKits']['resolvePlayKit']>(async (): Promise<ResolvedPlayKit> => ({
        kit: kitOf(family),
        ...(options.beatorajaPlay !== undefined ? { beatorajaPlay: options.beatorajaPlay } : {}),
      })),
    },
    beatoraja: { activeBeatorajaPlay: undefined as BeatorajaPlayEntry | undefined },
    courses: new CourseRunService(),
    courseRoute: {
      continueCourse: vi.fn<PlayRouteDeps['courseRoute']['continueCourse']>(() => true),
      showCourseResult: vi.fn<PlayRouteDeps['courseRoute']['showCourseResult']>(async () => {}),
    },
    nonstopRoute: {
      showNonstopCourseResult: vi.fn<PlayRouteDeps['nonstopRoute']['showNonstopCourseResult']>(async () => {}),
      startNonstopCourse: vi.fn<PlayRouteDeps['nonstopRoute']['startNonstopCourse']>(async () => {}),
    },
    results: {
      lastBeatorajaChart: undefined as PlayRouteDeps['results']['lastBeatorajaChart'],
      showResult: vi.fn<PlayRouteDeps['results']['showResult']>(async () => {}),
      showBeatorajaPlayResult: vi.fn<PlayRouteDeps['results']['showBeatorajaPlayResult']>(async () => {}),
    },
    playOptions: new PlayOptionsService({ hiSpeed: 3 }),
    guiState: {
      autoPlay: false,
      random1P: 'OFF',
      random2P: 'OFF',
      dpFlip: false,
      gauge: 'GROOVE',
      autoScratch1P: false,
      autoScratch2P: false,
      replayView: { tempo: true, hiSpeed: true, covers: true, lift: true },
      tempoEnabled: true,
      tempoPercent: 0,
      tempoPitchMode: 'pitch',
      tempoStretchAlgorithm: 'wsola',
      judgeRuleset: 'lr2',
      autoPauseOnBlur: false,
      hiSpeed: 3,
      keyVolume: 100,
      bgmVolume: 100,
      compressor: true,
      compressorKey: true,
      compressorBGM: true,
      compressorMaster: true,
      bgaResizeMaxEdgePx: 0,
      bgaUseWebCodecs: false,
      showInvisibleNotes: false,
      judgedNoteDisplay: 'KEEP_SCROLLING',
      courseAutoAdvance: false,
      playLayout: 'auto',
    } as PlayRouteDeps['guiState'],
    debugMenu: {
      resolveCompressorParamOverrides: vi.fn(() => ({})),
      refreshHiSpeed: vi.fn(),
    },
    compressorMode: 'split' as const,
    deviceProfile: { touchFirst: false, phone: false } as DeviceProfile,
    audio: {} as AudioService,
    sceneHost: {} as PixiSceneHost,
    replayRecorder: { name: 'be-music-web', version: '0.0.0', platform: 'web' as const },
    testHook: { recordReplay: vi.fn() },
    recordingDeps: () => recording,
    setRecordingFilenameBase: vi.fn<PlayRouteDeps['setRecordingFilenameBase']>(),
    setPlayStatus: vi.fn<PlayRouteDeps['setPlayStatus']>(),
    lockReplayOptionsForPlay: vi.fn<PlayRouteDeps['lockReplayOptionsForPlay']>(),
    unlockReplayOptions: vi.fn<PlayRouteDeps['unlockReplayOptions']>(),
    showSelect: vi.fn<PlayRouteDeps['showSelect']>(async () => {}),
    setPlayOptions: vi.fn<PlayRouteDeps['setPlayOptions']>(),
  };
  const route = new PlayRoute({ ...deps, debugMenu: deps.debugMenu as unknown as DebugMenu });
  return { route, router, deps, select, plays, stage, classes, onInterrupt, recording };
}

type Harness = Awaited<ReturnType<typeof harness>>;

/** Plays `chart` with no decide screen, up to the play loading on the stage. */
async function playing(h: Harness, chart: LibraryChart, overrides = {}): Promise<FakePlay> {
  void h.route.playChart(chart, overrides);
  await vi.waitFor(() => expect(h.plays.at(-1)?.prepare).toHaveBeenCalled());
  return h.plays.at(-1)!;
}

/** What the last play to take the stage put in force: its start, its record keys and its beatoraja entry. */
function inForce(h: Harness): {
  lastPlay: LastPlay | undefined;
  playRecordKey: string | undefined;
  stageRecordKey: string | undefined;
  beatorajaPlay: BeatorajaPlayEntry | undefined;
} {
  return {
    lastPlay: h.route.lastPlay,
    playRecordKey: h.deps.records.activePlayRecordKey,
    stageRecordKey: h.deps.records.activeStageRecordKey,
    beatorajaPlay: h.deps.beatoraja.activeBeatorajaPlay,
  };
}

/** A play `a` that has taken the stage and started, on the beatoraja 7-keys entry. */
async function afterAPlay(): Promise<Harness> {
  const h = await harness({ family: 'beatoraja', beatorajaPlay: ENTRY_7 });
  const play = await playing(h, chartEntry('a'));
  play.load.resolve();
  await vi.waitFor(() => expect(play.start).toHaveBeenCalledOnce());
  return h;
}

describe('PlayRoute: what a play puts in force, and when', () => {
  test('a play loading behind a decide screen, or one backed out of, puts nothing in force', async () => {
    const h = await afterAPlay();
    const before = inForce(h);
    expect(before).toEqual({
      lastPlay: { chart: chartEntry('a'), overrides: { autoPlay: false } },
      playRecordKey: playRecordKey(chartEntry('a'), HASHES.sha256, {
        autoPlay: false,
        replay: false,
        course: false,
        tempo: 1,
        judgeRuleset: 'lr2',
      }),
      stageRecordKey: undefined,
      beatorajaPlay: ENTRY_7,
    });

    // The decide route makes the next play (here an AUTO one on the 14-keys entry) and loads it off the stage.
    const view = h.route.buildPlayScene(
      chartEntry('b'),
      { kit: kitOf('beatoraja'), beatorajaPlay: ENTRY_14 },
      { autoPlay: true, chartHashes: HASHES },
    );
    expect(inForce(h)).toEqual(before);
    // The decide screen is backed out of: the play goes and never takes the stage.
    view.dispose();
    expect(inForce(h)).toEqual(before);
  });

  test('the play puts its start, record keys and beatoraja entry in force as it takes the stage', async () => {
    const h = await afterAPlay();
    const view = h.route.buildPlayScene(
      chartEntry('b'),
      { kit: kitOf('beatoraja'), beatorajaPlay: ENTRY_14 },
      { chartHashes: HASHES },
    );
    h.route.latchPlay(view);
    expect(inForce(h)).toEqual({
      lastPlay: { chart: chartEntry('b'), overrides: { autoPlay: false } },
      playRecordKey: playRecordKey(chartEntry('b'), HASHES.sha256, {
        autoPlay: false,
        replay: false,
        course: false,
        tempo: 1,
        judgeRuleset: 'lr2',
      }),
      stageRecordKey: undefined,
      beatorajaPlay: ENTRY_14,
    });
  });

  test('a replay keeps no record, and a play on another family leaves no beatoraja entry in force', async () => {
    const h = await afterAPlay();
    const view = h.route.buildPlayScene(chartEntry('b'), { kit: kitOf('lr2') }, { autoPlay: true, replay: REPLAY });
    h.route.latchPlay(view);
    expect(inForce(h)).toEqual({
      lastPlay: { chart: chartEntry('b'), overrides: { autoPlay: true, replay: REPLAY } },
      playRecordKey: undefined,
      stageRecordKey: undefined,
      beatorajaPlay: undefined,
    });
  });

  test('a course stage also keeps its chart’s record under the stage key', async () => {
    const h = await harness();
    const active = h.deps.courses.beginRun(course());
    const courseStage: CourseStagePlay = nextCourseStagePlay(active)!;
    const view = h.route.buildPlayScene(
      chartEntry('a'),
      { kit: kitOf('built-in') },
      { courseStage, chartHashes: HASHES },
    );
    h.route.latchPlay(view);
    const kind = { autoPlay: false, replay: false, tempo: 1, judgeRuleset: 'lr2' as const };
    expect(h.deps.records.activePlayRecordKey).toBe(
      playRecordKey(chartEntry('a'), HASHES.sha256, { ...kind, course: true }),
    );
    expect(h.deps.records.activeStageRecordKey).toBe(courseStageRecordKey(chartEntry('a'), HASHES.sha256, kind));
    expect(h.deps.records.activeStageRecordKey).toBeDefined();
  });

  test('once per play: a later latch does not bring back record keys a tempo change dropped', async () => {
    const h = await harness();
    const view = h.route.buildPlayScene(chartEntry('a'), { kit: kitOf('built-in') }, { chartHashes: HASHES });
    h.route.latchPlay(view);
    expect(h.deps.records.activePlayRecordKey).toBeDefined();
    // A tempo change during the play makes it practice.
    h.plays[0]!.options.on.tempo?.(1.1);
    expect(h.deps.records.activePlayRecordKey).toBeUndefined();
    h.route.latchPlay(view);
    expect(h.deps.records.activePlayRecordKey).toBeUndefined();
    // A play this route did not make puts nothing in force.
    h.route.latchPlay({} as PlayScene);
    expect(h.route.lastPlay?.chart).toEqual(chartEntry('a'));
  });

  test('a play with no decide screen puts them in force as it shows, before it has loaded', async () => {
    const h = await harness({ family: 'beatoraja', beatorajaPlay: ENTRY_7 });
    const play = await playing(h, chartEntry('a'), { autoPlay: true });
    expect(h.router.current).toBe(play);
    expect(play.start).not.toHaveBeenCalled();
    expect(inForce(h)).toMatchObject({
      lastPlay: { chart: chartEntry('a'), overrides: { autoPlay: true } },
      beatorajaPlay: ENTRY_7,
    });
  });

  test('a play whose navigation a newer one replaced before it showed puts nothing in force', async () => {
    const h = await harness({ family: 'beatoraja', beatorajaPlay: ENTRY_7 });
    let resolveKit!: (kit: ResolvedPlayKit) => void;
    h.deps.familyKits.resolvePlayKit.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveKit = resolve;
        }),
    );
    const started = h.route.playChart(chartEntry('a'));
    await vi.waitFor(() => expect(h.deps.familyKits.resolvePlayKit).toHaveBeenCalled());
    // A drop, say: the router begins a navigation of its own while the kit loads.
    h.router.begin();
    resolveKit({ kit: kitOf('beatoraja'), beatorajaPlay: ENTRY_7 });
    await started;
    expect(h.plays[0]!.dispose).toHaveBeenCalled();
    expect(inForce(h)).toEqual({
      lastPlay: undefined,
      playRecordKey: undefined,
      stageRecordKey: undefined,
      beatorajaPlay: undefined,
    });
  });
});

/** A play's result as the engine hands it over. */
function resultOf(chart: LibraryChart): PlayResult {
  return {
    chart: chart,
    score: { total: 10, perfect: 8, great: 2, good: 0, bad: 0, poor: 0, emptyPoor: 0, exScore: 18 },
    maxCombo: 10,
    gauge: 90,
    cleared: true,
    playSeconds: 30,
    gaugeHistory: [],
    scoreHistory: [],
    replay: { play: { mode: 'manual' } } as unknown as BeMusicReplay,
  } as unknown as PlayResult;
}

/** A NONSTOP course stitched into one chart. */
function nonstopPlay(): NonstopPlay {
  const prepared = {
    chart: chartEntry('nonstop'),
    stitched: { map: { stages: [] } },
  } as unknown as PreparedNonstopPlay;
  return { course: course('nonstop'), prepared };
}

/** Plays `chart` with no decide screen and lets it load and start. */
async function started(h: Harness, chart: LibraryChart, overrides = {}): Promise<FakePlay> {
  const play = await playing(h, chart, overrides);
  play.load.resolve();
  await vi.waitFor(() => expect(play.start).toHaveBeenCalledOnce());
  return play;
}

/** Every step queued on the router and the promises it awaits settle. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('PlayRoute.playChart: a chart played at once', () => {
  test('the select screen goes off the stage, kept, and the play takes it, loads there and then starts', async () => {
    const h = await harness();
    const play = await playing(h, chartEntry('a'));
    expect(h.classes.has('playing')).toBe(true);
    expect(h.deps.selectRoute.lastSelectNavigation).toBe(AT_BAR);
    expect(h.stage).toEqual([h.select, undefined, play]);
    expect(h.router.select).toBe(h.select);
    expect(h.select.dispose).not.toHaveBeenCalled();
    // A play of its own starts a run of its own.
    expect(h.onInterrupt).toHaveBeenCalledOnce();
    expect(h.deps.setRecordingFilenameBase).toHaveBeenCalledWith('a');
    expect(h.deps.familyKits.resolvePlayKit).toHaveBeenCalledWith(chartEntry('a'), {});
    expect(h.deps.setPlayStatus).toHaveBeenCalledWith('Playing: a');
    // Pitch follows tempo at the slider's tempo: the tempo slider stays live during the play.
    expect(h.deps.lockReplayOptionsForPlay).toHaveBeenCalledWith(true);
    expect(play.kit).toEqual({ family: 'built-in' });
    expect(play.options).toMatchObject({
      chart: chartEntry('a'),
      audio: h.deps.audio,
      host: h.deps.sceneHost,
      playOptions: h.deps.playOptions.current,
      settings: { chartSHA256: HASHES.sha256, chartMD5: HASHES.md5, layoutMode: 'standard' },
    });
    expect(play.options).not.toHaveProperty('course');
    expect(play.options).not.toHaveProperty('replay');

    expect(play.start).not.toHaveBeenCalled();
    play.load.resolve();
    await vi.waitFor(() => expect(play.start).toHaveBeenCalledOnce());
    // A recording armed on the select screen starts once the play has its audio.
    expect(startArmedRecording).toHaveBeenLastCalledWith(h.recording);
    expect(play.start.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(startArmedRecording).mock.invocationCallOrder.at(-1)!,
    );
  });

  test('a replay plays at its recorded tempo and says so, and hashes no chart', async () => {
    const h = await harness();
    const play = await playing(h, chartEntry('a'), { autoPlay: true, replay: REPLAY });
    expect(h.deps.records.resolveChartHashes).not.toHaveBeenCalled();
    expect(h.deps.setPlayStatus).toHaveBeenCalledWith(describePlayingStatus('a', { tempoPercent: 20, replay: true }));
    expect(h.deps.lockReplayOptionsForPlay).toHaveBeenCalledWith(false);
    expect(play.options.replay).toBe(REPLAY);
    expect(play.options.settings).not.toHaveProperty('chartSHA256');
  });

  test('the LR2 and beatoraja plays take the settings without a touch layout', async () => {
    for (const family of ['lr2', 'beatoraja'] as const) {
      const h = await harness({ family });
      const play = await playing(h, chartEntry('a'));
      expect(play.options.settings).not.toHaveProperty('layoutMode');
    }
  });

  test('a course stage carries its run on, with its course handed to the play', async () => {
    const h = await harness();
    const active = h.deps.courses.beginRun(course());
    const courseStage = nextCourseStagePlay(active)!;
    const play = await playing(h, chartEntry('a'), { courseStage });
    expect(h.onInterrupt).not.toHaveBeenCalled();
    expect(h.deps.familyKits.resolvePlayKit).toHaveBeenCalledWith(chartEntry('a'), { courseStage });
    expect(play.options.course).toEqual({ stage: courseStage.course, view: courseStage.courseInfo });
  });

  test('a NONSTOP run carries its run on too, and its stitched chart has no file to hash', async () => {
    const h = await harness();
    const nonstop = nonstopPlay();
    await playing(h, nonstop.prepared.chart, { nonstop });
    expect(h.onInterrupt).not.toHaveBeenCalled();
    expect(h.deps.records.resolveChartHashes).not.toHaveBeenCalled();
  });

  test('a chart with no play kit goes back to the select screen', async () => {
    const h = await harness();
    h.deps.familyKits.resolvePlayKit.mockResolvedValueOnce(undefined);
    await h.route.playChart(chartEntry('a'));
    expect(h.deps.showSelect).toHaveBeenCalledOnce();
    expect(createPlayScene).not.toHaveBeenCalled();
  });
});

describe('PlayRoute: where a play leads', () => {
  test('a finished play shows its result', async () => {
    const h = await harness();
    const play = await started(h, chartEntry('a'));
    play.options.on.finish(resultOf(chartEntry('a')), undefined);
    expect(h.deps.results.showResult).toHaveBeenCalledWith(resultOf(chartEntry('a')));
    expect(h.deps.results.showBeatorajaPlayResult).not.toHaveBeenCalled();
  });

  test('a play on the beatoraja play screen shows its result there, with the chart as it played it kept', async () => {
    const h = await harness({ family: 'beatoraja', beatorajaPlay: ENTRY_7 });
    const play = await started(h, chartEntry('a'));
    play.options.on.finish(resultOf(chartEntry('a')), undefined);
    expect(h.deps.results.lastBeatorajaChart).toEqual({ resolved: play.resolved, chartPath: 'a.bms' });
    expect(h.deps.results.showBeatorajaPlayResult).toHaveBeenCalledWith(resultOf(chartEntry('a')), false);
    expect(h.deps.results.showResult).not.toHaveBeenCalled();
  });

  test('a NONSTOP run that ends shows the run’s result, with the stitched chart as it played it', async () => {
    const h = await harness();
    const nonstop = nonstopPlay();
    const play = await started(h, nonstop.prepared.chart, { nonstop });
    const result = resultOf(nonstop.prepared.chart);
    play.options.on.finish(result, undefined);
    expect(h.deps.nonstopRoute.showNonstopCourseResult).toHaveBeenCalledWith(
      nonstop,
      result.replay,
      result,
      play.resolved,
    );
    expect(h.deps.results.showResult).not.toHaveBeenCalled();
  });

  test('a course stage whose result is skipped goes straight on, its last samples ringing out', async () => {
    const h = await harness();
    h.deps.guiState.courseAutoAdvance = true;
    const active = h.deps.courses.beginRun(course());
    const play = await started(h, chartEntry('a'), { courseStage: nextCourseStagePlay(active)! });
    const result = resultOf(chartEntry('a'));
    play.options.on.finish(result, undefined);
    await vi.waitFor(() => expect(h.deps.courseRoute.continueCourse).toHaveBeenCalledOnce());
    expect(h.deps.testHook.recordReplay).toHaveBeenCalledWith(result.replay);
    expect(h.deps.records.recordActiveCourseStage).toHaveBeenCalledOnce();
    expect(h.stage.at(-1)).toBeUndefined();
    expect(play.dispose).toHaveBeenCalledWith({ preserveAudioTail: true });
    expect(h.deps.unlockReplayOptions).toHaveBeenCalledOnce();
    // The course asked for its next stage: the run goes on.
    expect(h.onInterrupt).not.toHaveBeenCalled();
    expect(h.deps.results.showResult).not.toHaveBeenCalled();
  });

  test('a course stage whose result shows goes to the result screen', async () => {
    const h = await harness();
    const active = h.deps.courses.beginRun(course());
    const play = await started(h, chartEntry('a'), { courseStage: nextCourseStagePlay(active)! });
    play.options.on.finish(resultOf(chartEntry('a')), undefined);
    expect(h.deps.results.showResult).toHaveBeenCalledOnce();
    expect(h.deps.courseRoute.continueCourse).not.toHaveBeenCalled();
  });

  test('Escape leaves a single play for the select screen', async () => {
    const h = await harness();
    const play = await started(h, chartEntry('a'));
    play.options.on.exit();
    expect(h.deps.showSelect).toHaveBeenCalledOnce();
  });

  test('Escape gives a course up: the stage is recorded with its replay, and the course result shows', async () => {
    const h = await harness();
    const active = h.deps.courses.beginRun(course());
    const play = await started(h, chartEntry('a'), { courseStage: nextCourseStagePlay(active)! });
    const replay = { play: { mode: 'manual', aborted: true } } as unknown as BeMusicReplay;
    play.waitForReplay.mockResolvedValueOnce(replay);
    play.options.on.exit();
    await vi.waitFor(() => expect(h.deps.courseRoute.showCourseResult).toHaveBeenCalledOnce());
    expect(h.deps.testHook.recordReplay).toHaveBeenCalledWith(replay);
    expect(h.deps.courses.active).toBe(active);
    expect(h.deps.showSelect).not.toHaveBeenCalled();
  });

  test('Escape ends a NONSTOP run on its result', async () => {
    const h = await harness();
    const nonstop = nonstopPlay();
    const play = await started(h, nonstop.prepared.chart, { nonstop });
    const replay = { play: { mode: 'manual' } } as unknown as BeMusicReplay;
    play.waitForReplay.mockResolvedValueOnce(replay);
    play.options.on.exit();
    await vi.waitFor(() => expect(h.deps.nonstopRoute.showNonstopCourseResult).toHaveBeenCalledOnce());
    expect(h.deps.nonstopRoute.showNonstopCourseResult).toHaveBeenCalledWith(nonstop, replay, undefined, play.resolved);
  });

  test('F5 plays a single chart again as it was played: AUTO stays AUTO and a replay stays a replay', async () => {
    const h = await harness();
    const play = await started(h, chartEntry('a'), { autoPlay: true, replay: REPLAY });
    const again = vi.spyOn(h.route, 'playChart');
    play.options.on.restart();
    expect(again).toHaveBeenCalledWith(chartEntry('a'), { autoPlay: true, replay: REPLAY });
    await vi.waitFor(() => expect(h.plays).toHaveLength(2));
    expect(h.plays[1]!.options.replay).toBe(REPLAY);
    expect(h.plays[1]!.options.settings.autoPlay).toBe(true);
  });

  test('F5 in a course stage drops the run and goes back to the select screen', async () => {
    const h = await harness();
    const active = h.deps.courses.beginRun(course());
    const play = await started(h, chartEntry('a'), { courseStage: nextCourseStagePlay(active)! });
    play.options.on.restart();
    expect(h.deps.courses.active).toBeUndefined();
    expect(h.deps.showSelect).toHaveBeenCalledOnce();
  });

  test('F5 in a NONSTOP run stitches the course again', async () => {
    const h = await harness();
    const nonstop = nonstopPlay();
    const play = await started(h, nonstop.prepared.chart, { nonstop });
    play.options.on.restart();
    expect(h.deps.nonstopRoute.startNonstopCourse).toHaveBeenCalledWith(nonstop.course);
  });
});

describe('PlayRoute: the hi-speed and the tempo', () => {
  test('a hi-speed stepped in the play is remembered and mirrored onto the menu and the select screen', async () => {
    const h = await harness();
    const play = await started(h, chartEntry('a'));
    play.options.on.hiSpeed?.(3.25);
    expect(h.deps.guiState.hiSpeed).toBe(3.25);
    expect(storeHiSpeed).toHaveBeenLastCalledWith(3.25);
    expect(h.deps.debugMenu.refreshHiSpeed).toHaveBeenCalledOnce();
    expect(h.deps.setPlayOptions).toHaveBeenCalledWith({ hiSpeed: 3.25 });
    // The play took it already.
    expect(play.setHiSpeed).not.toHaveBeenCalled();
  });

  test('one from the menu goes to the running play, one from the select screen to the menu only', async () => {
    const h = await harness();
    const play = await started(h, chartEntry('a'));
    h.route.rememberHiSpeed(2.5, 'menu');
    expect(play.setHiSpeed).toHaveBeenCalledWith(2.5);
    expect(h.deps.debugMenu.refreshHiSpeed).not.toHaveBeenCalled();
    expect(h.deps.setPlayOptions).toHaveBeenCalledWith({ hiSpeed: 2.5 });

    h.route.rememberHiSpeed(4, 'select');
    expect(h.deps.guiState.hiSpeed).toBe(4);
    expect(h.deps.debugMenu.refreshHiSpeed).toHaveBeenCalledOnce();
    expect(h.deps.setPlayOptions).toHaveBeenCalledOnce();
    expect(play.setHiSpeed).toHaveBeenCalledOnce();

    // Not a number: nothing is remembered.
    h.route.rememberHiSpeed(Number.NaN, 'menu');
    expect(h.deps.guiState.hiSpeed).toBe(4);
  });

  test('a tempo change shows on the status line, and a play at another tempo leaves the records alone', async () => {
    const h = await harness();
    const play = await started(h, chartEntry('a'));
    expect(h.deps.records.activePlayRecordKey).toBeDefined();
    play.options.on.tempo?.(1);
    expect(h.deps.records.activePlayRecordKey).toBeDefined();
    play.options.on.tempo?.(1.1);
    expect(h.deps.setPlayStatus).toHaveBeenLastCalledWith(describePlayingStatus('a', { tempoPercent: 10 }));
    expect(h.deps.records.activePlayRecordKey).toBeUndefined();
    expect(h.deps.records.activeStageRecordKey).toBeUndefined();
    await settle();
  });
});
