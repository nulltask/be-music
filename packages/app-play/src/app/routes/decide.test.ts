import { createEmptyJSON } from '@be-music/chart-source';
import type { ResolvedPlayChart } from '@be-music/player-engine';
import type { AudioService } from '@be-music/player-browser/audio';
import type { BrowserChartCollection, ChartFileHashes } from '@be-music/player-browser/collection';
import {
  createDecideScene,
  type DecideScene,
  type DecideSceneKit,
  type DecideSceneOptions,
  type PlayScene,
  type PlaySceneKit,
  type SelectScene,
} from '@be-music/player-browser/host';
import { systemSoundSetFromBeatoraja, type BrowseSnapshot, type LibraryChart } from '@be-music/player-scene-model';
import { describe, expect, test, vi } from 'vite-plus/test';
import type { FamilyDispatchState } from '../../family-dispatch.ts';
import { startArmedRecording, type RecordingDeps } from '../../recording-controller.ts';
import { PlayOptionsService } from '../../services/play-options.ts';
import type { DemoScene, PlayerWebDemoElements } from '../../types.ts';
import { SceneRouter } from '../scene-router.ts';
import { DecideRoute, playingFamily, type DecideRouteDeps } from './decide.ts';

vi.mock('@be-music/player-browser/host', () => ({ createDecideScene: vi.fn() }));
vi.mock('../../recording-controller.ts', () => ({ startArmedRecording: vi.fn() }));

type Family = DecideSceneKit['family'];

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

/** The chart as the decide screen drew it (its `#RANDOM` branches). */
const RESOLVED = { chart: createEmptyJSON('bms'), draws: [2] } as unknown as ResolvedPlayChart;
const HASHES = { sha256: 'f'.repeat(64), md5: 'e'.repeat(32) } as ChartFileHashes;
/** Where the select screen was when the chart was started. */
const AT_BAR = { folderPath: ['pack'] } as unknown as BrowseSnapshot;

const kitOf = <K>(family: Family): K => ({ family }) as unknown as K;

/** A promise settled from outside: a play's load. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void } {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface FakeDecide {
  readonly identity: { readonly kind: 'decide'; readonly family: Family };
  readonly kit: DecideSceneKit;
  readonly options: DecideSceneOptions;
  readonly resolved: ResolvedPlayChart;
  readonly dispose: ReturnType<typeof vi.fn<() => void>>;
}

interface FakePlay {
  readonly identity: { readonly kind: 'play'; readonly family: Family };
  readonly load: ReturnType<typeof deferred>;
  readonly prepare: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly start: ReturnType<typeof vi.fn<() => void>>;
  readonly getTempo: () => number;
  readonly dispose: ReturnType<typeof vi.fn<() => void>>;
}

function fakePlay(family: Family): FakePlay {
  const load = deferred();
  return {
    identity: { kind: 'play', family },
    load,
    prepare: vi.fn(() => load.promise),
    start: vi.fn(),
    getTempo: () => 1,
    dispose: vi.fn(),
  };
}

/** The shell's class list, as a set. */
function fakeShell(): { readonly classes: Set<string>; readonly shell: HTMLDivElement } {
  const classes = new Set<string>();
  return {
    classes,
    shell: { classList: { add: (name: string) => void classes.add(name) } } as unknown as HTMLDivElement,
  };
}

/**
 * The decide route on a real scene router over a fake stage, with the select screen up and fake services. The decide
 * screen is drawn by `decideFamily` (`undefined`: no decide screen), the play by `playFamily`.
 */
async function harness(options: { decideFamily?: Family | null; playFamily?: Family } = {}) {
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

  const decides: FakeDecide[] = [];
  vi.mocked(createDecideScene).mockImplementation((kit, sceneOptions) => {
    const decide: FakeDecide = {
      identity: { kind: 'decide', family: kit.family },
      kit,
      options: sceneOptions,
      resolved: RESOLVED,
      dispose: vi.fn(),
    };
    decides.push(decide);
    return decide as unknown as DecideScene;
  });
  const plays: FakePlay[] = [];
  const decideFamily = options.decideFamily === null ? undefined : (options.decideFamily ?? 'built-in');
  const playFamily = options.playFamily ?? 'built-in';
  const { classes, shell } = fakeShell();
  const recording = {} as RecordingDeps;
  const selectRoute: { lastSelectNavigation: BrowseSnapshot | undefined } = { lastSelectNavigation: undefined };
  const state: FamilyDispatchState = {
    beatorajaTheme: undefined,
    selectSkin: undefined,
    decideSkin: undefined,
    resultSkin: undefined,
    playSkins: {},
    skinFamilyOverride: 'auto',
  };
  const deps = {
    router,
    selectRoute,
    elements: { shell } as Pick<PlayerWebDemoElements, 'shell'>,
    library: { collection: { sources: [], charts: [chartEntry('a')], errors: [] } as BrowserChartCollection },
    records: { resolveChartHashes: vi.fn<DecideRouteDeps['records']['resolveChartHashes']>(async () => HASHES) },
    familyKits: {
      familyDispatchState: () => state,
      playsOnBeatoraja: vi.fn<DecideRouteDeps['familyKits']['playsOnBeatoraja']>(() => playFamily === 'beatoraja'),
      decideKitFor: vi.fn<DecideRouteDeps['familyKits']['decideKitFor']>(async () =>
        decideFamily !== undefined ? kitOf<DecideSceneKit>(decideFamily) : undefined,
      ),
      resolvePlayKit: vi.fn<DecideRouteDeps['familyKits']['resolvePlayKit']>(async () => ({
        kit: kitOf<PlaySceneKit>(playFamily),
      })),
    },
    beatoraja: {
      beatorajaThemeBGM: { decide: new Uint8Array([1, 2, 3]) } as DecideRouteDeps['beatoraja']['beatorajaThemeBGM'],
    },
    playOptions: new PlayOptionsService({ hiSpeed: 3 }),
    guiState: { autoPlay: false, tempoEnabled: true, tempoPercent: 0, tempoPitchMode: 'pitch' as const },
    audio: {} as AudioService,
    beatorajaSkinOptions: { refreshBeatorajaPlaySkinOptions: vi.fn() },
    lastPlay: vi.fn<DecideRouteDeps['lastPlay']>(() => undefined),
    recordingDeps: () => recording,
    setRecordingFilenameBase: vi.fn<DecideRouteDeps['setRecordingFilenameBase']>(),
    setStatus: vi.fn<DecideRouteDeps['setStatus']>(),
    setPlayStatus: vi.fn<DecideRouteDeps['setPlayStatus']>(),
    lockReplayOptionsForPlay: vi.fn<DecideRouteDeps['lockReplayOptionsForPlay']>(),
    showSelect: vi.fn<DecideRouteDeps['showSelect']>(async () => {}),
    playChart: vi.fn<DecideRouteDeps['playChart']>(async () => {}),
    buildPlayScene: vi.fn<DecideRouteDeps['buildPlayScene']>((_song, { kit }) => {
      const play = fakePlay(kit.family);
      plays.push(play);
      return play as unknown as PlayScene;
    }),
    latchPlay: vi.fn<DecideRouteDeps['latchPlay']>(),
  };
  const route = new DecideRoute(deps);
  return { route, router, deps, select, decides, plays, stage, classes, onInterrupt, recording };
}

type Harness = Awaited<ReturnType<typeof harness>>;

/** The decide screen shown last, and the play loading behind it once it is made. */
async function decided(h: Harness): Promise<{ decide: FakeDecide; play: FakePlay }> {
  await vi.waitFor(() => expect(h.plays).toHaveLength(1));
  return { decide: h.decides.at(-1)!, play: h.plays.at(-1)! };
}

describe('DecideRoute: a chart’s built-in decide screen', () => {
  test('the select screen goes off the stage, kept, and the screen shows the chart with the play options in force', async () => {
    const h = await harness();
    await h.route.showDecide(chartEntry('a'), { autoPlay: true });

    const decide = h.decides[0]!;
    expect(h.deps.familyKits.decideKitFor).toHaveBeenCalledWith('default', chartEntry('a'), false);
    expect(decide.kit).toEqual({ family: 'built-in' });
    expect(decide.options).toMatchObject({
      chart: chartEntry('a'),
      playOptions: { ...h.deps.playOptions.current, autoPlay: true },
      // The select screen's decide jingle rings on through it: the built-in screen plays none of its own.
      sounds: {},
      audio: h.deps.audio,
    });
    expect(h.router.current).toBe(decide);
    expect(h.stage).toEqual([h.select, undefined, decide]);
    expect(h.router.select).toBe(h.select);
    expect(h.select.dispose).not.toHaveBeenCalled();
    expect(h.deps.selectRoute.lastSelectNavigation).toBe(AT_BAR);
    // A chart's decide screen starts a run of its own.
    expect(h.onInterrupt).toHaveBeenCalledOnce();
    expect(h.deps.setStatus).not.toHaveBeenCalled();
  });

  test('the Debug Menu’s auto play goes on the screen when the start set none', async () => {
    const h = await harness();
    h.deps.guiState.autoPlay = true;
    await h.route.showDecide(chartEntry('a'));
    expect(h.decides[0]!.options.playOptions?.autoPlay).toBe(true);
  });

  test('the play loads off stage behind the screen, with the screen’s draws and the start’s AUTO', async () => {
    const h = await harness();
    await h.route.showDecide(chartEntry('a'), { autoPlay: true });
    const { play } = await decided(h);

    expect(h.deps.familyKits.resolvePlayKit).toHaveBeenCalledWith(chartEntry('a'), {});
    expect(h.deps.buildPlayScene).toHaveBeenCalledWith(
      chartEntry('a'),
      { kit: { family: 'built-in' } },
      {
        autoPlay: true,
        preResolved: RESOLVED,
        chartHashes: HASHES,
      },
    );
    expect(h.deps.setRecordingFilenameBase).toHaveBeenCalledWith('a');
    await vi.waitFor(() => expect(play.prepare).toHaveBeenCalledOnce());
    expect(h.router.play).toBe(play);
    expect(h.stage).not.toContain(play);
  });

  test('once the screen is done, the play it prepared takes the stage and starts', async () => {
    const h = await harness();
    await h.route.showDecide(chartEntry('a'));
    const { decide, play } = await decided(h);
    h.deps.selectRoute.lastSelectNavigation = undefined;

    // Done before the play has loaded: the screen stays up until it has.
    decide.options.on.continue();
    await Promise.resolve();
    expect(h.router.current).toBe(decide);
    play.load.resolve();

    await vi.waitFor(() => expect(play.start).toHaveBeenCalledOnce());
    expect(h.router.current).toBe(play);
    expect(h.router.play).toBe(play);
    expect(decide.dispose).toHaveBeenCalledOnce();
    expect(h.select.dispose).not.toHaveBeenCalled();
    expect(h.router.select).toBe(h.select);
    expect(h.classes.has('playing')).toBe(true);
    expect(h.deps.selectRoute.lastSelectNavigation).toBe(AT_BAR);
    expect(h.deps.setPlayStatus).toHaveBeenCalledWith('Playing: a');
    // The play puts what it was made with in force as it takes the stage, before its status line reads it.
    expect(h.deps.latchPlay).toHaveBeenCalledExactlyOnceWith(play);
    expect(h.deps.latchPlay.mock.invocationCallOrder[0]).toBeLessThan(
      h.deps.setPlayStatus.mock.invocationCallOrder[0]!,
    );
    // Pitch follows tempo at the slider's tempo: the tempo slider stays live during the play.
    expect(h.deps.lockReplayOptionsForPlay).toHaveBeenCalledWith(true);
    // A recording armed on the select screen starts with the play.
    expect(startArmedRecording).toHaveBeenLastCalledWith(h.recording);
    expect(play.start.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(startArmedRecording).mock.invocationCallOrder.at(-1)!,
    );
    expect(h.deps.beatorajaSkinOptions.refreshBeatorajaPlaySkinOptions).toHaveBeenCalledOnce();
    expect(h.deps.playChart).not.toHaveBeenCalled();
  });

  test('the play shown is the one prepared behind the screen, never whichever play the router holds by then', async () => {
    const h = await harness();
    await h.route.showDecide(chartEntry('a'));
    const { decide, play } = await decided(h);
    play.load.resolve();
    await vi.waitFor(() => expect(h.router.play).toBe(play));
    // Another play loading off stage takes the router's hold (and disposes the screen's).
    const other = fakePlay('built-in');
    other.load.resolve();
    await h.router.prepare(other as unknown as PlayScene);
    decide.options.on.continue();
    // Every step of the hand-off settles before the next task.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(other.start).not.toHaveBeenCalled();
    expect(h.stage).not.toContain(other);
    expect(play.start).not.toHaveBeenCalled();
  });

  test('the screen leads on once: a second continue, or a cancel after it, does nothing', async () => {
    const h = await harness();
    await h.route.showDecide(chartEntry('a'));
    const { decide, play } = await decided(h);
    play.load.resolve();
    decide.options.on.continue();
    decide.options.on.continue();
    decide.options.on.cancel();
    await vi.waitFor(() => expect(play.start).toHaveBeenCalledOnce());
    expect(h.deps.showSelect).not.toHaveBeenCalled();
  });

  test('backing out of the screen goes back to the select screen', async () => {
    const h = await harness();
    await h.route.showDecide(chartEntry('a'));
    const { decide, play } = await decided(h);
    decide.options.on.cancel();
    decide.options.on.continue();
    expect(h.deps.showSelect).toHaveBeenCalledOnce();
    play.load.resolve();
    await Promise.resolve();
    expect(play.start).not.toHaveBeenCalled();
    // The play loaded behind it never took the stage, so it put nothing in force.
    expect(h.deps.latchPlay).not.toHaveBeenCalled();
  });

  test('a newer navigation drops the play prepared behind the screen, and the screen leads nowhere', async () => {
    const h = await harness();
    await h.route.showDecide(chartEntry('a'));
    const { decide, play } = await decided(h);
    // A drop, say: the router begins a navigation of its own.
    h.router.begin();
    play.load.resolve();
    decide.options.on.continue();
    await vi.waitFor(() => expect(play.dispose).toHaveBeenCalledOnce());
    expect(play.start).not.toHaveBeenCalled();
    expect(h.stage).not.toContain(play);
    expect(h.deps.playChart).not.toHaveBeenCalled();
    expect(h.deps.latchPlay).not.toHaveBeenCalled();
  });

  test('a play that failed to load is made again without the screen, with the screen’s draws', async () => {
    const h = await harness();
    await h.route.showDecide(chartEntry('a'), { autoPlay: true });
    const { decide, play } = await decided(h);
    play.load.reject(new Error('decode failed'));
    decide.options.on.continue();
    await vi.waitFor(() => expect(h.deps.playChart).toHaveBeenCalledOnce());
    expect(h.deps.playChart).toHaveBeenCalledWith(chartEntry('a'), { autoPlay: true, preResolved: RESOLVED });
    expect(play.dispose).toHaveBeenCalledOnce();
    expect(play.start).not.toHaveBeenCalled();
  });

  test('a chart with no play skin is played again the same way', async () => {
    const h = await harness();
    h.deps.familyKits.resolvePlayKit.mockResolvedValue(undefined);
    await h.route.showDecide(chartEntry('a'));
    h.decides[0]!.options.on.continue();
    await vi.waitFor(() => expect(h.deps.playChart).toHaveBeenCalledOnce());
    expect(h.deps.playChart).toHaveBeenCalledWith(chartEntry('a'), { preResolved: RESOLVED });
    expect(h.deps.buildPlayScene).not.toHaveBeenCalled();
  });
});

describe('DecideRoute: a course’s decide screen, and none at all', () => {
  test('a course’s screen carries its run on, loads no play and leads to its first stage', async () => {
    const h = await harness();
    const start = vi.fn(async () => {});
    const cancel = vi.fn();
    await h.route.showDecide(chartEntry('a'), {}, { start, cancel });
    expect(h.onInterrupt).not.toHaveBeenCalled();
    expect(h.router.current).toBe(h.decides[0]);

    h.decides[0]!.options.on.continue();
    expect(start).toHaveBeenCalledOnce();
    expect(h.deps.buildPlayScene).not.toHaveBeenCalled();
    expect(h.deps.playChart).not.toHaveBeenCalled();
  });

  test('backing out of a course’s screen undoes its start and goes back to the select screen', async () => {
    const h = await harness();
    const start = vi.fn(async () => {});
    const cancel = vi.fn();
    await h.route.showDecide(chartEntry('a'), {}, { start, cancel });
    h.decides[0]!.options.on.cancel();
    expect(cancel).toHaveBeenCalledOnce();
    expect(h.deps.showSelect).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
  });

  test('with no decide screen the chart plays at once, and a course its first stage', async () => {
    const h = await harness({ decideFamily: null });
    await h.route.showDecide(chartEntry('a'), { autoPlay: true });
    expect(h.deps.playChart).toHaveBeenCalledWith(chartEntry('a'), { autoPlay: true });
    expect(createDecideScene).not.toHaveBeenCalled();
    // No navigation of its own: the play takes the select screen off the stage.
    expect(h.router.current).toBe(h.select);
    expect(h.onInterrupt).not.toHaveBeenCalled();

    const start = vi.fn(async () => {});
    await h.route.showDecide(chartEntry('a'), {}, { start });
    expect(start).toHaveBeenCalledOnce();
    expect(h.deps.playChart).toHaveBeenCalledOnce();
  });
});

describe('DecideRoute: the other families', () => {
  test('the LR2 screen plays no jingle of its own either', async () => {
    const h = await harness({ decideFamily: 'lr2' });
    await h.route.showDecide(chartEntry('a'));
    expect(h.decides[0]!.options.sounds).toEqual({});
    expect(h.deps.setStatus).not.toHaveBeenCalled();
  });

  test('a beatoraja screen plays its theme’s decide sound and names itself in the status line', async () => {
    const h = await harness({ decideFamily: 'beatoraja' });
    await h.route.showDecide(chartEntry('a'));
    expect(h.decides[0]!.options.sounds).toEqual(
      systemSoundSetFromBeatoraja({ bgm: h.deps.beatoraja.beatorajaThemeBGM }),
    );
    expect(h.deps.setStatus).toHaveBeenCalledWith('Decide (beatoraja): a');
  });

  test('a play on the beatoraja play screen asks for its decide kit as one, and names itself once it starts', async () => {
    const h = await harness({ decideFamily: 'beatoraja', playFamily: 'beatoraja' });
    await h.route.showDecide(chartEntry('a'));
    expect(h.deps.familyKits.decideKitFor).toHaveBeenCalledWith('default', chartEntry('a'), true);
    const { decide, play } = await decided(h);
    play.load.resolve();
    decide.options.on.continue();
    await vi.waitFor(() => expect(play.start).toHaveBeenCalledOnce());
    expect(h.deps.setPlayStatus).toHaveBeenCalledWith('Playing (beatoraja): a');
  });

  test('a play’s status line names the beatoraja family only', () => {
    expect(playingFamily({ identity: { kind: 'play', family: 'beatoraja' } } as PlayScene)).toEqual({
      family: 'beatoraja',
    });
    expect(playingFamily({ identity: { kind: 'play', family: 'lr2' } } as PlayScene)).toEqual({});
    expect(playingFamily({ identity: { kind: 'play', family: 'built-in' } } as PlayScene)).toEqual({});
  });
});
