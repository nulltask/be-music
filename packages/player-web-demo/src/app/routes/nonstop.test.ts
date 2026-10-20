import { createEmptyJSON } from '@be-music/json';
import type { ResolvedPlayChart } from '@be-music/player';
import type { BrowserAssetSource, BrowserChartCollection } from '@be-music/player-web/collection';
import type { BeatorajaThemeBundle } from '@be-music/player-web/skin';
import {
  buildNonstopCourseReplay,
  parseBeatorajaCourseData,
  type PreparedNonstopCourse,
} from '@be-music/player/course';
import type { BeMusicCourseReplay, BeMusicReplay, ReplayCourseResult } from '@be-music/player/replay';
import type { LibraryChart, LibraryCourse, PlayResult } from '@be-music/scene-model';
import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import type { FamilyDispatchState } from '../../family-dispatch.ts';
import { prepareNonstopPlay } from '../../nonstop-course.ts';
import { CourseRunService } from '../../services/courses.ts';
import { NonstopRoute, type NonstopPlay, type NonstopRouteDeps } from './nonstop.ts';

vi.mock('../../nonstop-course.ts', () => ({ prepareNonstopPlay: vi.fn() }));
vi.mock('@be-music/player/course', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@be-music/player/course')>();
  return { ...actual, buildNonstopCourseReplay: vi.fn() };
});

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
    totalNotes: 10,
    chart: createEmptyJSON('bms'),
  };
}

/** A NONSTOP course of two stages, both in the collection. */
function nonstopCourse(): LibraryCourse {
  const parsed = parseBeatorajaCourseData({
    name: 'Nonstop',
    hash: ['1', '2'].map((digit) => ({ md5: digit.repeat(32) })),
    constraint: [],
  })!;
  const definition = { ...parsed, kind: 'nonstop' as const };
  return {
    id: 'ns#0',
    definition,
    stages: ['a', 'b'].map((id) => ({ title: id, chart: chartEntry(id) })),
    playable: true,
  };
}

/** The course stitched (`prepareNonstopPlay`) with `placement`: the stitched song, its composite source and the stitch. */
function stitched(
  course: LibraryCourse,
  placement: 'intended' | 'lr2' = 'intended',
): { ok: true; prepared: NonstopPlay['prepared'] } {
  return {
    ok: true,
    prepared: {
      chart: { ...chartEntry('a'), id: `nonstop:${course.id}`, title: course.definition.name },
      source: { id: `nonstop:${course.id}` } as BrowserAssetSource,
      stitched: { placement } as PreparedNonstopCourse,
    },
  };
}

const RESULT = {
  ruleset: 'lr2',
  judge: { pgreat: 18, great: 2, good: 0, bad: 0, poor: 0, emptyPoor: 0 },
  fast: 0,
  slow: 0,
  exScore: 38,
  noteCount: 20,
  missCount: 0,
  maxCombo: 20,
  gauge: { type: 'GROOVE', final: 90, cleared: true },
  lamp: 'NORMAL',
  stagesPlayed: 2,
} as ReplayCourseResult;

/** The stitched play's replay, played by hand. */
const REPLAY = { play: { mode: 'manual', judgeRuleset: 'lr2', gauge: 'GROOVE' } } as unknown as BeMusicReplay;

/** The NONSTOP run's course log (`buildNonstopCourseReplay`), with its result. */
function nonstopLog(): BeMusicCourseReplay {
  return {
    course: { name: 'Nonstop', kind: 'nonstop' },
    stages: [],
    nonstop: { replay: REPLAY },
    results: { native: RESULT },
  } as unknown as BeMusicCourseReplay;
}

function familyState(family: 'built-in' | 'beatoraja'): FamilyDispatchState {
  return {
    beatorajaTheme:
      family === 'beatoraja' ? ({ theme: { resultSkin: {} } } as unknown as BeatorajaThemeBundle) : undefined,
    selectSkin: undefined,
    decideSkin: undefined,
    resultSkin: undefined,
    playSkins: {},
    skinFamilyOverride: 'auto',
  };
}

/** The NONSTOP route on fake screens and services, recording what it shows. */
function harness(options: { family?: 'built-in' | 'beatoraja' } = {}) {
  const courses = new CourseRunService();
  const collection: BrowserChartCollection = {
    sources: [{ id: 'drop1' } as BrowserAssetSource],
    charts: [chartEntry('a'), chartEntry('b')],
    errors: [],
  };
  const deps = {
    courses,
    library: { collection },
    records: {
      resolveChartHashes: vi.fn<NonstopRouteDeps['records']['resolveChartHashes']>(async (chart) => ({
        sha256: `${chart.id}-sha256`,
        md5: `${chart.id}-md5`,
      })),
      recordCourseResult: vi.fn<NonstopRouteDeps['records']['recordCourseResult']>(),
    },
    guiState: { nonstopPlacement: 'lr2' as const },
    replayAutoSave: { saveCourse: vi.fn<NonstopRouteDeps['replayAutoSave']['saveCourse']>() },
    leaderboard: { maybeSubmitCourse: vi.fn<NonstopRouteDeps['leaderboard']['maybeSubmitCourse']>() },
    familyKits: { familyDispatchState: () => familyState(options.family ?? 'built-in') },
    replayRecorder: { name: 'be-music-web' },
    testHook: { recordReplay: vi.fn<(replay: BeMusicReplay | undefined) => void>() },
    setStatus: vi.fn<NonstopRouteDeps['setStatus']>(),
    showSelect: vi.fn<NonstopRouteDeps['showSelect']>(async () => {}),
    showDecide: vi.fn<NonstopRouteDeps['showDecide']>(async () => {}),
    playChart: vi.fn<NonstopRouteDeps['playChart']>(async () => {}),
    showResult: vi.fn<NonstopRouteDeps['showResult']>(async () => {}),
    showBeatorajaResult: vi.fn<NonstopRouteDeps['showBeatorajaResult']>(async () => true),
    unlockReplayOptions: vi.fn<NonstopRouteDeps['unlockReplayOptions']>(),
  };
  return { courses, deps, route: new NonstopRoute(deps) };
}

beforeEach(() => {
  vi.mocked(prepareNonstopPlay).mockReset();
  vi.mocked(prepareNonstopPlay).mockImplementation((course, options) => stitched(course, options.placement));
  vi.mocked(buildNonstopCourseReplay).mockReset();
  vi.mocked(buildNonstopCourseReplay).mockImplementation(() => nonstopLog());
});

describe('NonstopRoute: starting and restitching', () => {
  test('a NONSTOP course bar stitches the course and plays it after its decide screen, with the course’s AUTO', async () => {
    const h = harness();
    const course = nonstopCourse();
    h.courses.start(true);
    await h.route.startNonstopCourse(course, { decide: true });
    // Stitched with each stage's hashes and the Debug Menu's placement.
    const [stitchedCourse, stitchOptions] = vi.mocked(prepareNonstopPlay).mock.calls[0]!;
    expect(stitchedCourse).toBe(course);
    expect(stitchOptions.placement).toBe('lr2');
    expect(stitchOptions.hashesOf!(chartEntry('b'))).toEqual({ sha256: 'b-sha256', md5: 'b-md5' });
    // The decide screen names the course; the play waits for it.
    const [decideSong, overrides, then] = h.deps.showDecide.mock.calls[0]!;
    expect(decideSong).toMatchObject({ id: 'nonstop:ns#0', title: 'Nonstop' });
    expect(overrides).toEqual({});
    expect(h.deps.playChart).not.toHaveBeenCalled();

    await then.start();
    const [played, play] = h.deps.playChart.mock.calls[0]!;
    expect(played).toBe(decideSong);
    expect(play).toEqual({ nonstop: { course, prepared: stitched(course, 'lr2').prepared }, autoPlay: true });
  });

  test('F5 and R stitch it again without the decide screen, keeping the course’s AUTO and one composite source', async () => {
    const h = harness();
    const course = nonstopCourse();
    h.courses.start(true);
    await h.route.startNonstopCourse(course, { decide: true });
    await h.route.startNonstopCourse(course);
    await h.route.startNonstopCourse(course);
    expect(h.deps.showDecide).toHaveBeenCalledOnce();
    expect(h.deps.playChart).toHaveBeenCalledTimes(2);
    expect(h.deps.playChart.mock.calls.every(([, play]) => play.autoPlay === true)).toBe(true);
    expect(h.deps.library.collection.sources.map((source) => source.id)).toEqual(['drop1', 'nonstop:ns#0']);
  });

  test('a NONSTOP course started with PLAY follows the Debug Menu’s auto play', async () => {
    const h = harness();
    await h.route.startNonstopCourse(nonstopCourse());
    expect(h.deps.playChart.mock.calls[0]![1]).not.toHaveProperty('autoPlay');
  });

  test('a course that cannot be stitched says why and plays nothing', async () => {
    const h = harness();
    vi.mocked(prepareNonstopPlay).mockReturnValueOnce({ ok: false, reason: 'missing-stage', stage: 1 });
    await h.route.startNonstopCourse(nonstopCourse(), { decide: true });
    expect(h.deps.setStatus).toHaveBeenCalledWith('Nonstop: cannot stitch the NONSTOP course: missing-stage (stage 2)');
    expect(h.deps.showDecide).not.toHaveBeenCalled();
    expect(h.deps.playChart).not.toHaveBeenCalled();
    expect(h.deps.library.collection.sources).toHaveLength(1);
  });
});

describe('NonstopRoute: the run’s result', () => {
  async function playing(h: ReturnType<typeof harness>): Promise<NonstopPlay> {
    await h.route.startNonstopCourse(nonstopCourse());
    return h.deps.playChart.mock.calls.at(-1)![1].nonstop;
  }

  test('is kept, saved and ranked as one course run, and R on it stitches the course again', async () => {
    const h = harness();
    const nonstop = await playing(h);
    await h.route.showNonstopCourseResult(nonstop, REPLAY);
    expect(h.deps.testHook.recordReplay).toHaveBeenCalledWith(REPLAY);
    expect(vi.mocked(buildNonstopCourseReplay).mock.calls[0]![3]).toMatchObject({
      recorder: { name: 'be-music-web' },
    });
    const courseLog = h.deps.replayAutoSave.saveCourse.mock.calls[0]![0];
    // Kept under the placement the run was stitched with.
    expect(h.deps.records.recordCourseResult.mock.calls[0]![0]?.key).toMatch(/^lr2:course:nonstop:.*:lr2$/);
    expect(h.deps.leaderboard.maybeSubmitCourse).toHaveBeenCalledWith(courseLog, [chartEntry('a'), chartEntry('b')]);
    const [data, mode] = h.deps.showResult.mock.calls[0]!;
    expect(data).toMatchObject({ run: 'nonstop', chart: { title: 'Nonstop' }, cleared: true });
    expect(mode!.nonstop.info).toMatchObject({ kind: 'nonstop', title: 'Nonstop' });

    mode!.nonstop.retry();
    await vi.waitFor(() => expect(h.deps.playChart).toHaveBeenCalledTimes(2));
    expect(h.deps.showDecide).not.toHaveBeenCalled();
  });

  test('a beatoraja theme shows it on its result skin, its graphs on the stitched chart as played', async () => {
    const h = harness({ family: 'beatoraja' });
    const nonstop = await playing(h);
    const resolved = { chart: { notes: [] } } as unknown as ResolvedPlayChart;
    await h.route.showNonstopCourseResult(nonstop, REPLAY, undefined, resolved);
    const [data, options] = h.deps.showBeatorajaResult.mock.calls[0]!;
    expect(data.run).toBe('nonstop');
    expect(options).toMatchObject({ run: 'nonstop', course: { info: { title: 'Nonstop' } } });
    expect(options.playChart).toBe(resolved.chart);
    expect(h.deps.unlockReplayOptions).toHaveBeenCalledOnce();
    expect(h.deps.showResult).not.toHaveBeenCalled();
  });

  test('a play that left no replay shows its own result, or goes back to the select screen', async () => {
    const h = harness();
    const nonstop = await playing(h);
    const fallback = { run: 'single', chart: chartEntry('a') } as unknown as PlayResult;
    await h.route.showNonstopCourseResult(nonstop, undefined, fallback);
    expect(h.deps.showResult).toHaveBeenCalledWith(fallback);
    await h.route.showNonstopCourseResult(nonstop, undefined);
    expect(h.deps.showSelect).toHaveBeenCalledOnce();
    expect(h.deps.testHook.recordReplay).toHaveBeenCalledWith(undefined);
    expect(h.deps.records.recordCourseResult).not.toHaveBeenCalled();
    expect(h.deps.replayAutoSave.saveCourse).not.toHaveBeenCalled();
  });
});
