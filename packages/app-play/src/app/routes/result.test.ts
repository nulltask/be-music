import { createMemoryReplaySlotBackend, ReplaySlotStore } from '../../services/replay-slots.ts';
import { createEmptyJSON } from '@be-music/chart-source';
import type { LR2Skin } from '@be-music/skin-lr2';
import type { ResolvedPlayChart } from '@be-music/player-engine';
import type { AudioService } from '@be-music/player-browser/audio';
import type { BrowserChartCollection } from '@be-music/player-browser/collection';
import {
  createResultScene,
  type BeatorajaKit,
  type PlayScene,
  type ResultScene,
  type ResultSceneKit,
  type ResultSceneOptions,
  type SelectScene,
} from '@be-music/player-browser/host';
import type { BeatorajaThemeBGM, BeatorajaThemeBundle } from '@be-music/player-browser/skin';
import type { CourseDefinition } from '@be-music/player-engine/course';
import type { BeMusicCourseReplay, BeMusicReplay, ReplayCourseResult } from '@be-music/player-engine/replay';
import { courseStageRecordPlayFromResult, recordPlayFromResult } from '@be-music/player-engine/records';
import {
  resolveCourseView,
  systemSoundSetFromBeatoraja,
  type LibraryChart,
  type LibraryCourse,
  type PlayResult,
} from '@be-music/player-scene-model';
import { describe, expect, test, vi } from 'vite-plus/test';
import { activeCourseInfo } from '../../course-flow.ts';
import type { FamilyDispatchState } from '../../family-dispatch.ts';
import { resolveResultSoundSet, type LR2ResultJingles } from '../../result-jingles.ts';
import { CourseRunService } from '../../services/courses.ts';
import { resultFromCourseLog, resultFromData } from '../../test-hook.ts';
import type { PlayerScene } from '../../types.ts';
import { SceneRouter } from '../scene-router.ts';
import type { LastPlay } from './play.ts';
import { ResultRoute, type ResultRouteDeps } from './result.ts';

vi.mock('@be-music/player-browser/host', () => ({ createResultScene: vi.fn() }));

type Family = ResultSceneKit['family'];

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
      { title: 'a', chart: chartEntry('a') },
      { title: 'b', chart: chartEntry('b') },
    ],
    playable: true,
  };
}

/** A play's result as the engine hands it over. */
function resultOf(chart: LibraryChart, cleared = true): PlayResult {
  return {
    chart: chart,
    score: { total: 10, perfect: 8, great: 2, good: 0, bad: 0, poor: 0, emptyPoor: 0, exScore: 18 },
    maxCombo: 10,
    gauge: 90,
    gaugeType: 'GROOVE',
    cleared,
    playSeconds: 30,
    gaugeHistory: [],
    scoreHistory: [],
    replay: { play: { mode: 'manual' } } as unknown as BeMusicReplay,
  } as unknown as PlayResult;
}

/** A course run's replay and native result. */
const COURSE_LOG = {
  log: { course: { name: 'Dan', kind: 'grade' }, stages: [] } as unknown as BeMusicCourseReplay,
  native: {
    lamp: 'NORMAL',
    exScore: 40,
    judge: { pgreat: 20, great: 0, good: 0, bad: 0, poor: 0 },
    gauge: { type: 'CLASS', final: 50, cleared: true },
    stagesPlayed: 2,
  } as unknown as ReplayCourseResult,
};

const LR2_RESULT = { name: 'result' } as unknown as LR2Skin;
const LR2_COURSE_RESULT = { name: 'course result' } as unknown as LR2Skin;
const BUILT_IN_KIT = { family: 'built-in' } as unknown as ResultSceneKit;
const BEATORAJA_KIT = { family: 'beatoraja', kit: { entryPath: 'result/result.json' } } as unknown as BeatorajaKit;
const LR2_JINGLES: LR2ResultJingles = { clear: new Uint8Array([1]), fail: new Uint8Array([2]) };
const BEATORAJA_BGM = { clear: new Uint8Array([3]), fail: new Uint8Array([4]) } as BeatorajaThemeBGM;
const PLAYED = { chart: createEmptyJSON('bms'), draws: [1] } as unknown as ResolvedPlayChart;

/** A result screen as `createResultScene` makes it: the kit and options it was made with. */
interface FakeResult {
  readonly identity: { readonly kind: 'result'; readonly family: Family };
  readonly kit: ResultSceneKit;
  readonly options: ResultSceneOptions;
  readonly dispose: ReturnType<typeof vi.fn<() => void>>;
}

/**
 * The result route on a real scene router over a fake stage, with a play on the stage and fake services. `family` is
 * the theme loaded: LR2 (with a result skin), beatoraja (with one) or none.
 */
async function harness(options: { family?: 'lr2' | 'beatoraja' | 'none'; lastPlay?: LastPlay } = {}) {
  const stage: (PlayerScene | undefined)[] = [];
  const onInterrupt = vi.fn();
  const router = new SceneRouter<PlayerScene, PlayScene, SelectScene>({
    host: {
      setScene: async (scene) => {
        stage.push(scene);
      },
    },
    recorder: { finalize: async () => {} },
    onInterrupt,
  });
  const play = { identity: { kind: 'play', family: 'built-in' }, prepare: vi.fn(), dispose: vi.fn() };
  await router.show(play as unknown as PlayScene, { role: 'play' });
  onInterrupt.mockClear();

  const results: FakeResult[] = [];
  vi.mocked(createResultScene).mockImplementation((kit, sceneOptions) => {
    const scene: FakeResult = {
      identity: { kind: 'result', family: kit.family },
      kit,
      options: sceneOptions,
      dispose: vi.fn(),
    };
    results.push(scene);
    return scene as unknown as ResultScene;
  });
  const family = options.family ?? 'none';
  const state: FamilyDispatchState = {
    beatorajaTheme:
      family === 'beatoraja' ? ({ theme: { resultSkin: {} } } as unknown as BeatorajaThemeBundle) : undefined,
    selectSkin: undefined,
    decideSkin: undefined,
    resultSkin: family === 'lr2' ? LR2_RESULT : undefined,
    playSkins: {},
    skinFamilyOverride: 'auto',
  };
  const courses = new CourseRunService();
  const deps = {
    router,
    library: { collection: { sources: [], charts: [chartEntry('a')], errors: [] } as BrowserChartCollection },
    records: {
      recordActivePlay: vi.fn<ResultRouteDeps['records']['recordActivePlay']>(),
      recordActiveCourseStage: vi.fn<ResultRouteDeps['records']['recordActiveCourseStage']>(),
    },
    courses,
    courseRoute: { continueCourse: vi.fn<ResultRouteDeps['courseRoute']['continueCourse']>(() => true) },
    familyKits: { familyDispatchState: () => state },
    lr2: {
      resultSkin: family === 'lr2' ? LR2_RESULT : undefined,
      courseResultSkin: family === 'lr2' ? LR2_COURSE_RESULT : undefined,
      courseLR2Skin: vi.fn(
        (mounted: LR2Skin | undefined) => mounted && ({ name: `${mounted.name} (course)` } as LR2Skin),
      ),
      resultJingles: vi.fn(() => LR2_JINGLES),
    },
    beatoraja: {
      loadBeatorajaResultKit: vi.fn<ResultRouteDeps['beatoraja']['loadBeatorajaResultKit']>(async () =>
        family === 'beatoraja' ? BEATORAJA_KIT : undefined,
      ),
      beatorajaThemeBGM: family === 'beatoraja' ? BEATORAJA_BGM : {},
    },
    builtIn: { builtInKit: BUILT_IN_KIT },
    replayAutoSave: { savePlay: vi.fn<ResultRouteDeps['replayAutoSave']['savePlay']>() },
    leaderboard: { maybeSubmit: vi.fn<ResultRouteDeps['leaderboard']['maybeSubmit']>() },
    audio: {} as AudioService,
    testHook: { recordReplay: vi.fn(), recordResult: vi.fn() },
    lastPlay: vi.fn<ResultRouteDeps['lastPlay']>(() => options.lastPlay),
    nameResultJingle: vi.fn<ResultRouteDeps['nameResultJingle']>(() => 'jingle'),
    setPlayStatus: vi.fn<ResultRouteDeps['setPlayStatus']>(),
    showSelect: vi.fn<ResultRouteDeps['showSelect']>(async () => {}),
    playChart: vi.fn<ResultRouteDeps['playChart']>(async () => {}),
    unlockReplayOptions: vi.fn<ResultRouteDeps['unlockReplayOptions']>(),
    replaySlots: {
      store: new ReplaySlotStore({ backend: createMemoryReplaySlotBackend() }),
      rules: () => ['never', 'never', 'never', 'never'] as const,
      panel: { showResult: vi.fn() },
    },
    setStatus: vi.fn<ResultRouteDeps['setStatus']>(),
  };
  const route = new ResultRoute({
    ...deps,
    // The fakes stand in for the services' types.
    lr2: deps.lr2 as unknown as ResultRouteDeps['lr2'],
    builtIn: deps.builtIn as unknown as ResultRouteDeps['builtIn'],
  });
  return { route, router, deps, play, results, stage, onInterrupt };
}

type Harness = Awaited<ReturnType<typeof harness>>;

/** The result screen shown last. */
function shown(h: Harness): FakeResult {
  return h.results.at(-1)!;
}

describe('ResultRoute.showResult: a single play', () => {
  test('the result takes the stage from the play, which rings out, and the play is kept, saved and ranked', async () => {
    const h = await harness();
    const data = resultOf(chartEntry('a'));
    await h.route.showResult(data);
    const result = shown(h);
    expect(result.kit).toBe(BUILT_IN_KIT);
    expect(result.options).toMatchObject({
      result: data,
      run: 'single',
      sounds: resolveResultSoundSet('default', { lr2: LR2_JINGLES, beatoraja: {} }),
      audio: h.deps.audio,
    });
    expect(h.router.current).toBe(result);
    expect(h.play.dispose).toHaveBeenCalledWith({ preserveAudioTail: true });
    // The play asked for its result: the run goes on.
    expect(h.onInterrupt).not.toHaveBeenCalled();
    expect(h.deps.setPlayStatus).toHaveBeenCalledWith('Result: a');
    expect(h.deps.testHook.recordReplay).toHaveBeenCalledWith(data.replay);
    expect(h.deps.nameResultJingle).toHaveBeenCalledWith(LR2_JINGLES.clear);
    expect(h.deps.testHook.recordResult).toHaveBeenCalledWith(resultFromData(data, 'single', 'built-in', 'jingle'));
    expect(h.deps.records.recordActivePlay).toHaveBeenCalledWith(recordPlayFromResult(data), data.replay);
    expect(h.deps.replayAutoSave.savePlay).toHaveBeenCalledWith(data.replay);
    expect(h.deps.leaderboard.maybeSubmit).toHaveBeenCalledWith(data.replay, chartEntry('a'));
    expect(h.deps.unlockReplayOptions).toHaveBeenCalledOnce();
  });

  test('on an LR2 theme the result shows on its result skin, and a fail names the fail jingle', async () => {
    const h = await harness({ family: 'lr2' });
    await h.route.showResult(resultOf(chartEntry('a'), false));
    expect(shown(h).kit).toEqual({ family: 'lr2', skin: LR2_RESULT });
    expect(h.deps.nameResultJingle).toHaveBeenCalledWith(LR2_JINGLES.fail);
    expect(h.deps.testHook.recordResult).toHaveBeenCalledWith(expect.objectContaining({ family: 'lr2' }));
  });

  test('dismissed, it goes back to the select screen', async () => {
    const h = await harness();
    await h.route.showResult(resultOf(chartEntry('a')));
    shown(h).options.on.continue();
    expect(h.deps.showSelect).toHaveBeenCalledOnce();
  });

  test('R plays the chart again as it was started, the result screen going first', async () => {
    const lastPlay: LastPlay = { chart: chartEntry('a'), overrides: { autoPlay: true } };
    const h = await harness({ lastPlay });
    await h.route.showResult(resultOf(chartEntry('a')));
    shown(h).options.on.retry!();
    await vi.waitFor(() => expect(h.deps.playChart).toHaveBeenCalledWith(chartEntry('a'), { autoPlay: true }));
    expect(h.stage.at(-1)).toBeUndefined();
    expect(shown(h).dispose).toHaveBeenCalledOnce();
    // The result asked for the retry: the run goes on.
    expect(h.onInterrupt).not.toHaveBeenCalled();
  });

  test('R is offered only when the play last started is this chart’s', async () => {
    const h = await harness({ lastPlay: { chart: chartEntry('b'), overrides: { autoPlay: false } } });
    await h.route.showResult(resultOf(chartEntry('a')));
    expect(shown(h).options.on.retry).toBeUndefined();
  });

  test('a newer navigation that took the stage first keeps its status; the play is still kept, saved and ranked', async () => {
    const h = await harness();
    const data = resultOf(chartEntry('a'));
    const showing = h.route.showResult(data);
    // A drop, say, begins a navigation before the result's turn.
    h.router.begin();
    await showing;
    expect(shown(h).dispose).toHaveBeenCalledOnce();
    expect(h.deps.setPlayStatus).not.toHaveBeenCalled();
    expect(h.deps.testHook.recordResult).not.toHaveBeenCalled();
    expect(h.deps.records.recordActivePlay).toHaveBeenCalledOnce();
    expect(h.deps.replayAutoSave.savePlay).toHaveBeenCalledOnce();
    expect(h.deps.leaderboard.maybeSubmit).toHaveBeenCalledOnce();
    expect(h.deps.unlockReplayOptions).toHaveBeenCalledOnce();
  });
});

describe('ResultRoute.showResult: a course', () => {
  test('a stage’s result records the stage on the run, shows the course, and leads to the next stage', async () => {
    const h = await harness({ family: 'lr2', lastPlay: { chart: chartEntry('a'), overrides: { autoPlay: false } } });
    const active = h.deps.courses.beginRun(course());
    const data = resultOf(chartEntry('a'));
    await h.route.showResult(data);
    expect(h.deps.records.recordActiveCourseStage).toHaveBeenCalledWith(
      courseStageRecordPlayFromResult(data),
      data.replay,
    );
    const info = activeCourseInfo(active);
    expect(h.deps.lr2.courseLR2Skin).toHaveBeenCalledWith(LR2_RESULT, info, { kind: 'result' });
    const result = shown(h);
    expect(result.options).toMatchObject({ run: 'stage', result: { ...data, course: info } });
    // No quick retry in a course, and its stages are saved and ranked as the course.
    expect(result.options.on.retry).toBeUndefined();
    expect(h.deps.replayAutoSave.savePlay).not.toHaveBeenCalled();
    expect(h.deps.leaderboard.maybeSubmit).not.toHaveBeenCalled();

    result.options.on.continue();
    await vi.waitFor(() => expect(h.deps.courseRoute.continueCourse).toHaveBeenCalledOnce());
    expect(h.stage.at(-1)).toBeUndefined();
    expect(h.deps.showSelect).not.toHaveBeenCalled();
  });

  test('the course result shows on the course-result skin and reports the course run', async () => {
    const h = await harness({ family: 'lr2' });
    const info = resolveCourseView(course());
    const data = resultOf(chartEntry('a'));
    await h.route.showResult(data, { course: info, courseLog: COURSE_LOG });
    expect(h.deps.lr2.courseLR2Skin).toHaveBeenCalledWith(LR2_COURSE_RESULT, info, { kind: 'courseResult' });
    expect(shown(h).options.run).toBe('course');
    expect(h.deps.testHook.recordReplay).not.toHaveBeenCalled();
    expect(h.deps.testHook.recordResult).toHaveBeenCalledWith(
      resultFromCourseLog(COURSE_LOG.log, COURSE_LOG.native, { family: 'lr2', playSeconds: 30, jingle: 'jingle' }),
    );
    expect(h.deps.replayAutoSave.savePlay).not.toHaveBeenCalled();
  });

  test('a NONSTOP run’s result: R stitches it again, and its course log was saved already', async () => {
    const h = await harness();
    const retry = vi.fn();
    await h.route.showResult(resultOf(chartEntry('a')), { nonstop: { info: resolveCourseView(course()), retry } });
    expect(shown(h).options.run).toBe('nonstop');
    shown(h).options.on.retry!();
    await vi.waitFor(() => expect(retry).toHaveBeenCalledOnce());
    expect(h.deps.replayAutoSave.savePlay).not.toHaveBeenCalled();
    expect(h.deps.leaderboard.maybeSubmit).not.toHaveBeenCalled();
    expect(h.deps.records.recordActivePlay).toHaveBeenCalledOnce();
  });
});

describe('ResultRoute: the beatoraja result', () => {
  test('without a result skin nothing shows', async () => {
    const h = await harness();
    expect(await h.route.showBeatorajaResult(resultOf(chartEntry('a')), { run: 'single' })).toBe(false);
    expect(createResultScene).not.toHaveBeenCalled();
    expect(h.router.current).toBe(h.play);
  });

  test('it shows on the theme’s result skin, with the chart as the play played it', async () => {
    const h = await harness({
      family: 'beatoraja',
      lastPlay: { chart: chartEntry('a'), overrides: { autoPlay: false } },
    });
    h.route.lastBeatorajaChart = { resolved: PLAYED, chartPath: 'a.bms' };
    const data = resultOf(chartEntry('a'));
    expect(await h.route.showBeatorajaResult(data, { run: 'single' })).toBe(true);
    expect(h.deps.beatoraja.loadBeatorajaResultKit).toHaveBeenCalledWith(chartEntry('a'), false);
    const result = shown(h);
    expect(result.kit).toBe(BEATORAJA_KIT);
    expect(result.options).toMatchObject({
      result: data,
      run: 'single',
      playChart: PLAYED.chart,
      sounds: systemSoundSetFromBeatoraja({ bgm: BEATORAJA_BGM }),
    });
    expect(h.play.dispose).toHaveBeenCalledWith({ preserveAudioTail: true });
    expect(h.deps.setPlayStatus).toHaveBeenCalledWith('Result (beatoraja): a · ex=18 maxCombo=10');
    expect(h.deps.nameResultJingle).toHaveBeenCalledWith(BEATORAJA_BGM.clear);
    expect(h.deps.testHook.recordResult).toHaveBeenCalledWith(resultFromData(data, 'single', 'beatoraja', 'jingle'));

    result.options.on.retry!();
    await vi.waitFor(() => expect(h.deps.playChart).toHaveBeenCalledWith(chartEntry('a'), { autoPlay: false }));
  });

  test('a chart kept from another song is not plotted, and a NONSTOP run’s own chart is', async () => {
    const h = await harness({ family: 'beatoraja' });
    h.route.lastBeatorajaChart = { resolved: PLAYED, chartPath: 'b.bms' };
    await h.route.showBeatorajaResult(resultOf(chartEntry('a')), { run: 'single' });
    expect(shown(h).options).not.toHaveProperty('playChart');
    const stitched = createEmptyJSON('bms');
    const retry = vi.fn();
    await h.route.showBeatorajaResult(resultOf(chartEntry('a')), {
      run: 'nonstop',
      course: { info: resolveCourseView(course()) },
      nonstopRetry: retry,
      playChart: stitched as ResolvedPlayChart['chart'],
    });
    expect(shown(h).options.playChart).toBe(stitched);
    shown(h).options.on.retry!();
    await vi.waitFor(() => expect(retry).toHaveBeenCalledOnce());
  });

  test('a course run’s result shows on the course-result skin, plots no chart and goes back to select', async () => {
    const h = await harness({ family: 'beatoraja' });
    h.route.lastBeatorajaChart = { resolved: PLAYED, chartPath: 'a.bms' };
    const info = resolveCourseView(course());
    await h.route.showBeatorajaResult(resultOf(chartEntry('a')), {
      run: 'course',
      course: { info, result: COURSE_LOG },
    });
    expect(h.deps.beatoraja.loadBeatorajaResultKit).toHaveBeenCalledWith(chartEntry('a'), true);
    expect(shown(h).options).not.toHaveProperty('playChart');
    expect(shown(h).options.result.course).toEqual(info);
    expect(h.deps.setPlayStatus).toHaveBeenCalledWith('Result (beatoraja): Dan · ex=18 maxCombo=10');
    shown(h).options.on.continue();
    await vi.waitFor(() => expect(h.deps.showSelect).toHaveBeenCalledOnce());
    expect(h.deps.courseRoute.continueCourse).not.toHaveBeenCalled();
  });

  test('a single play on the beatoraja play screen is kept, saved and ranked; without a result skin it goes back to select', async () => {
    const h = await harness();
    const data = resultOf(chartEntry('a'));
    await h.route.showBeatorajaPlayResult(data, false);
    expect(h.deps.testHook.recordReplay).toHaveBeenCalledWith(data.replay);
    expect(h.deps.records.recordActivePlay).toHaveBeenCalledWith(recordPlayFromResult(data), data.replay);
    expect(h.deps.showSelect).toHaveBeenCalledOnce();
    expect(h.deps.replayAutoSave.savePlay).toHaveBeenCalledWith(data.replay);
    expect(h.deps.leaderboard.maybeSubmit).toHaveBeenCalledWith(data.replay, chartEntry('a'));
    expect(h.deps.unlockReplayOptions).toHaveBeenCalledOnce();
  });

  test('a course stage on the beatoraja play screen is recorded on the run, and goes on when no result skin shows it', async () => {
    const h = await harness();
    h.deps.courses.beginRun(course());
    const data = resultOf(chartEntry('a'));
    await h.route.showBeatorajaPlayResult(data, true);
    expect(h.deps.records.recordActiveCourseStage).toHaveBeenCalledWith(
      courseStageRecordPlayFromResult(data),
      data.replay,
    );
    expect(h.deps.courseRoute.continueCourse).toHaveBeenCalledOnce();
    expect(h.deps.records.recordActivePlay).not.toHaveBeenCalled();
    expect(h.deps.unlockReplayOptions).toHaveBeenCalledOnce();

    const themed = await harness({ family: 'beatoraja' });
    const running = themed.deps.courses.beginRun(course());
    await themed.route.showBeatorajaPlayResult(data, true);
    expect(shown(themed).options).toMatchObject({ run: 'stage', result: { course: activeCourseInfo(running) } });
    expect(themed.deps.courseRoute.continueCourse).not.toHaveBeenCalled();
  });
});

describe('practice results', () => {
  for (const family of ['none', 'lr2', 'beatoraja'] as const) {
    test(`${family}: shows a result without writing records, ranking or auto-saving`, async () => {
      const h = await harness({ family });
      const data = { ...resultOf(chartEntry('a')), practice: true };
      if (family === 'beatoraja') await h.route.showBeatorajaPlayResult(data, false);
      else await h.route.showResult(data);
      expect(h.deps.records.recordActivePlay).not.toHaveBeenCalled();
      expect(h.deps.records.recordActiveCourseStage).not.toHaveBeenCalled();
      expect(h.deps.replayAutoSave.savePlay).not.toHaveBeenCalled();
      expect(h.deps.leaderboard.maybeSubmit).not.toHaveBeenCalled();
    });
  }
});

for (const family of ['none', 'lr2', 'beatoraja'] as const) {
  test(`${family}: zero-total no-recovery keeps replay/submission without updating ordinary bests`, async () => {
    const h = await harness({ family });
    const data = resultOf(chartEntry('a'));
    data.replay = {
      format: 'be-music-replay',
      version: 0,
      clock: { unit: 'us', origin: 'chart-zero' },
      chart: {
        sourceFormat: 'bmson',
        total: 0,
        laneMode: '7keys',
        lnMode: 1,
        judgeRank: { percent: 100 },
        noteCount: 0,
        notes: [],
      },
      play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE', bmsonTotalMode: 'spec' },
      inputs: [],
    };
    if (family === 'beatoraja') await h.route.showBeatorajaPlayResult(data, false);
    else await h.route.showResult(data);
    expect(h.deps.records.recordActivePlay).not.toHaveBeenCalled();
    expect(h.deps.replayAutoSave.savePlay).toHaveBeenCalledWith(data.replay);
    expect(h.deps.leaderboard.maybeSubmit).toHaveBeenCalledWith(data.replay, data.chart);
  });
}
