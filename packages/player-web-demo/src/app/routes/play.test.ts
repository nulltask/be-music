import { createEmptyJson } from '@be-music/json';
import type { ResolvedPlayChart } from '@be-music/player';
import type { AudioService } from '@be-music/player-web/audio';
import type { BrowserSongCollection, ChartFileHashes } from '@be-music/player-web/collection';
import {
  createPlayScene,
  type PixiSceneHost,
  type PlayScene,
  type PlaySceneKit,
  type PlaySceneOptions,
  type SelectScene,
} from '@be-music/player-web/host';
import type { CourseDefinition } from '@be-music/player/course';
import type { BeMusicPlaylog } from '@be-music/player/playlog';
import type { BrowseSnapshot, LibraryChart, LibraryCourse } from '@be-music/scene-model';
import { describe, expect, test, vi } from 'vite-plus/test';
import { nextCourseStagePlay, type CourseStagePlay } from '../../course-flow.ts';
import type { DeviceProfile } from '../../device-profile.ts';
import type { RecordingDeps } from '../../recording-controller.ts';
import { CourseRunService } from '../../services/courses.ts';
import { PlayOptionsService } from '../../services/play-options.ts';
import type { BeatorajaPlayEntry } from '../../services/themes/beatoraja.ts';
import { courseStageRecordKey, playRecordKey } from '../../song-records.ts';
import type { DemoScene, PlayerWebDemoElements } from '../../types.ts';
import type { DebugMenu } from '../../ui/debug-menu/index.ts';
import type { ResolvedPlayKit } from '../family-kits.ts';
import { SceneRouter } from '../scene-router.ts';
import { PlayRoute, type LastPlay, type PlayRouteDeps } from './play.ts';

vi.mock('@be-music/player-web/host', () => ({ createPlayScene: vi.fn() }));
vi.mock('../../recording-controller.ts', () => ({ startArmedRecording: vi.fn() }));
vi.mock('../../hi-speed-storage.ts', () => ({ storeHiSpeed: vi.fn() }));

type Family = PlaySceneKit['family'];

function song(id: string): LibraryChart {
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
    chart: createEmptyJson('bms'),
  };
}

/** A GRADE course of charts `a` and `b`. */
function course(): LibraryCourse {
  const definition: CourseDefinition = {
    name: 'Dan',
    kind: 'grade',
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
      { title: 'a', chart: song('a') },
      { title: 'b', chart: song('b') },
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

/** A play log of an AUTO play. */
const REPLAY = { play: { mode: 'auto', autoScratch: false, gauge: 'GROOVE', tempo: 1.2 } } as unknown as BeMusicPlaylog;

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
  readonly waitForPlaylog: ReturnType<typeof vi.fn<() => Promise<BeMusicPlaylog | undefined>>>;
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
      waitForPlaylog: vi.fn(async () => undefined),
      resolved: { chart: createEmptyJson('bms'), draws: [] } as unknown as ResolvedPlayChart,
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
    library: { collection: { sources: [], charts: [song('a')], errors: [] } as BrowserSongCollection },
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
      compressorBgm: true,
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
    playlogRecorder: { name: 'be-music-web', version: '0.0.0', platform: 'web' as const },
    testHook: { recordPlaylog: vi.fn() },
    recordingDeps: () => recording,
    setRecordingFilenameBase: vi.fn<PlayRouteDeps['setRecordingFilenameBase']>(),
    setPlayStatus: vi.fn<PlayRouteDeps['setPlayStatus']>(),
    lockPlaylogOptionsForPlay: vi.fn<PlayRouteDeps['lockPlaylogOptionsForPlay']>(),
    unlockPlaylogOptions: vi.fn<PlayRouteDeps['unlockPlaylogOptions']>(),
    showSelect: vi.fn<PlayRouteDeps['showSelect']>(async () => {}),
    setPlayOptions: vi.fn<PlayRouteDeps['setPlayOptions']>(),
  };
  const route = new PlayRoute({ ...deps, debugMenu: deps.debugMenu as unknown as DebugMenu });
  return { route, router, deps, select, plays, stage, classes, onInterrupt, recording };
}

type Harness = Awaited<ReturnType<typeof harness>>;

/** Plays `chart` with no decide screen, up to the play loading on the stage. */
async function playing(h: Harness, chart: LibraryChart, overrides = {}): Promise<FakePlay> {
  void h.route.playSong(chart, overrides);
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
  const play = await playing(h, song('a'));
  play.load.resolve();
  await vi.waitFor(() => expect(play.start).toHaveBeenCalledOnce());
  return h;
}

describe('PlayRoute: what a play puts in force, and when', () => {
  test('a play loading behind a decide screen, or one backed out of, puts nothing in force', async () => {
    const h = await afterAPlay();
    const before = inForce(h);
    expect(before).toEqual({
      lastPlay: { song: song('a'), overrides: { autoPlay: false } },
      playRecordKey: playRecordKey(song('a'), HASHES.sha256, {
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
      song('b'),
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
      song('b'),
      { kit: kitOf('beatoraja'), beatorajaPlay: ENTRY_14 },
      { chartHashes: HASHES },
    );
    h.route.latchPlay(view);
    expect(inForce(h)).toEqual({
      lastPlay: { song: song('b'), overrides: { autoPlay: false } },
      playRecordKey: playRecordKey(song('b'), HASHES.sha256, {
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
    const view = h.route.buildPlayScene(song('b'), { kit: kitOf('lr2') }, { autoPlay: true, replay: REPLAY });
    h.route.latchPlay(view);
    expect(inForce(h)).toEqual({
      lastPlay: { song: song('b'), overrides: { autoPlay: true, replay: REPLAY } },
      playRecordKey: undefined,
      stageRecordKey: undefined,
      beatorajaPlay: undefined,
    });
  });

  test('a course stage also keeps its chart’s record under the stage key', async () => {
    const h = await harness();
    const active = h.deps.courses.beginRun(course());
    const courseStage: CourseStagePlay = nextCourseStagePlay(active)!;
    const view = h.route.buildPlayScene(song('a'), { kit: kitOf('built-in') }, { courseStage, chartHashes: HASHES });
    h.route.latchPlay(view);
    const kind = { autoPlay: false, replay: false, tempo: 1, judgeRuleset: 'lr2' as const };
    expect(h.deps.records.activePlayRecordKey).toBe(playRecordKey(song('a'), HASHES.sha256, { ...kind, course: true }));
    expect(h.deps.records.activeStageRecordKey).toBe(courseStageRecordKey(song('a'), HASHES.sha256, kind));
    expect(h.deps.records.activeStageRecordKey).toBeDefined();
  });

  test('once per play: a later latch does not bring back record keys a tempo change dropped', async () => {
    const h = await harness();
    const view = h.route.buildPlayScene(song('a'), { kit: kitOf('built-in') }, { chartHashes: HASHES });
    h.route.latchPlay(view);
    expect(h.deps.records.activePlayRecordKey).toBeDefined();
    // A tempo change during the play makes it practice.
    h.plays[0]!.options.on.tempo?.(1.1);
    expect(h.deps.records.activePlayRecordKey).toBeUndefined();
    h.route.latchPlay(view);
    expect(h.deps.records.activePlayRecordKey).toBeUndefined();
    // A play this route did not make puts nothing in force.
    h.route.latchPlay({} as PlayScene);
    expect(h.route.lastPlay?.song).toEqual(song('a'));
  });

  test('a play with no decide screen puts them in force as it shows, before it has loaded', async () => {
    const h = await harness({ family: 'beatoraja', beatorajaPlay: ENTRY_7 });
    const play = await playing(h, song('a'), { autoPlay: true });
    expect(h.router.current).toBe(play);
    expect(play.start).not.toHaveBeenCalled();
    expect(inForce(h)).toMatchObject({
      lastPlay: { song: song('a'), overrides: { autoPlay: true } },
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
    const started = h.route.playSong(song('a'));
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
