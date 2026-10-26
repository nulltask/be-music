import type { ResultReplaySlots } from '../../services/replay-slot-service.ts';
import { createEmptyJSON } from '@be-music/chart-source';
import { drawBrowserRandomCourse, type BrowserChartCollection } from '@be-music/player-browser/collection';
import type { BeatorajaThemeBundle } from '@be-music/player-browser/skin';
import { parseBeatorajaCourseData } from '@be-music/player-engine/course';
import type { BeMusicCourseReplay, BeMusicReplay, ReplayCourseResult } from '@be-music/player-engine/replay';
import type { PlayResult } from '@be-music/player-scene-model';
import type { BrowseSnapshot, LibraryChart, LibraryCourse } from '@be-music/player-scene-model';
import { describe, expect, test, vi } from 'vite-plus/test';
import type { FamilyDispatchState } from '../../family-dispatch.ts';
import { recordCourseStage } from '../../course-flow.ts';
import { CourseRunService } from '../../services/courses.ts';
import { CourseRoute, type CourseRouteDeps } from './course.ts';

vi.mock('@be-music/player-browser/collection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@be-music/player-browser/collection')>();
  return { ...actual, drawBrowserRandomCourse: vi.fn(actual.drawBrowserRandomCourse) };
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
    subtitle: `${id} [ANOTHER]`,
    artist: 'artist',
    totalNotes: 10,
    chart: createEmptyJSON('bms'),
  };
}

/** A GRADE course whose stages are `ids`, all in the collection. */
function grade(ids: string[] = ['a', 'b'], overrides: Partial<LibraryCourse> = {}): LibraryCourse {
  const definition = parseBeatorajaCourseData({
    name: 'Dan',
    hash: ids.map((_, index) => ({ md5: String(index + 1).repeat(32) })),
    constraint: ['CLASS'],
  })!;
  return {
    id: 'dan#0',
    definition,
    stages: ids.map((id) => ({ title: id, chart: chartEntry(id) })),
    playable: true,
    ...overrides,
  };
}

/** A stage's replay: played by hand, its gauge left at `final` (0 fails the run). */
function stageLog(final = 80, play: Partial<BeMusicReplay['play']> = {}): BeMusicReplay {
  return {
    play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE', course: { kind: 'grade' }, ...play },
    results: {
      native: {
        ruleset: 'be-music/native',
        judge: { pgreat: 10, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 0 },
        fast: 0,
        slow: 0,
        exScore: 20,
        noteCount: 10,
        maxCombo: 10,
        gauge: { type: 'GRADE', final, cleared: final > 0, ...(final <= 0 ? { failedMidPlay: true } : {}) },
        course: { combo: 10, maxCombo: 10 },
      },
    },
  } as unknown as BeMusicReplay;
}

/** Where the select screen was when the course bar was started. */
const AT_COURSE_BAR = { folderPath: ['courses'] } as unknown as BrowseSnapshot;

/** The family state with no theme (every screen built-in), or a beatoraja theme with a result skin. */
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

/** The course route on fake screens and services, recording what it shows. */
function harness(options: { family?: 'built-in' | 'beatoraja'; beatorajaMounts?: boolean } = {}) {
  const courses = new CourseRunService();
  const deps = {
    courses,
    library: {
      prepareDrawnCourse: vi.fn<CourseRouteDeps['library']['prepareDrawnCourse']>((course) => ({
        course,
        remember: vi.fn(),
      })),
      collection: { sources: [], charts: [chartEntry('a'), chartEntry('b')], errors: [] } as BrowserChartCollection,
    },
    records: {
      resolveChartHashes: vi.fn<CourseRouteDeps['records']['resolveChartHashes']>(async () => undefined),
      peekChartBestRecord: vi.fn<CourseRouteDeps['records']['peekChartBestRecord']>(() => undefined),
      recordCourseResult: vi.fn<CourseRouteDeps['records']['recordCourseResult']>(),
    },
    courseMaker: { maker: { start: vi.fn<CourseRouteDeps['courseMaker']['maker']['start']>() } },
    replayAutoSave: { saveCourse: vi.fn<CourseRouteDeps['replayAutoSave']['saveCourse']>() },
    leaderboard: { maybeSubmitCourse: vi.fn<CourseRouteDeps['leaderboard']['maybeSubmitCourse']>() },
    familyKits: { familyDispatchState: () => familyState(options.family ?? 'built-in') },
    replayRecorder: { name: 'be-music-web' },
    selectNavigation: () => AT_COURSE_BAR,
    setStatus: vi.fn<CourseRouteDeps['setStatus']>(),
    startNonstopCourse: vi.fn<CourseRouteDeps['startNonstopCourse']>(async () => {}),
    showSelect: vi.fn<CourseRouteDeps['showSelect']>(async () => {}),
    showDecide: vi.fn<CourseRouteDeps['showDecide']>(async () => {}),
    playChart: vi.fn<CourseRouteDeps['playChart']>(async () => {}),
    showResult: vi.fn<CourseRouteDeps['showResult']>(async () => {}),
    showBeatorajaResult: vi.fn<CourseRouteDeps['showBeatorajaResult']>(async () => options.beatorajaMounts ?? true),
    courseReplaySlots: vi.fn<CourseRouteDeps['courseReplaySlots']>(() => ({}) as ResultReplaySlots),
    unlockReplayOptions: vi.fn<CourseRouteDeps['unlockReplayOptions']>(),
  };
  const route = new CourseRoute(deps);
  /** What the decide screen shown for the course leads to. */
  const decided = (): Parameters<CourseRouteDeps['showDecide']>[2] => deps.showDecide.mock.calls.at(-1)![2];
  return { courses, deps, route, decided };
}

/** Starts `course` and plays its first stage from its decide screen. */
async function startFirstStage(h: ReturnType<typeof harness>, course = grade(), autoPlay?: boolean): Promise<void> {
  await h.route.startCourse(course, autoPlay === true ? { autoPlay } : {});
  await h.decided().start();
}

describe('CourseRoute: starting a course', () => {
  test('a course bar starts its run on the decide screen, which plays the first stage with the course’s AUTO', async () => {
    const h = harness();
    await h.route.startCourse(grade(), { autoPlay: true });
    expect(h.courses.active?.course.id).toBe('dan#0');
    expect(h.courses.autoPlay).toBe(true);
    // The decide screen names the course, as LR2's does.
    const [decideSong, overrides] = h.deps.showDecide.mock.calls[0]!;
    expect(decideSong).toMatchObject({ id: 'a', title: 'Dan' });
    expect(decideSong).not.toHaveProperty('subtitle');
    expect(overrides).toEqual({});
    expect(h.deps.playChart).not.toHaveBeenCalled();

    await h.decided().start();
    expect(h.deps.setStatus).toHaveBeenLastCalledWith('Dan: stage 1 / 2');
    const [stage, play] = h.deps.playChart.mock.calls[0]!;
    expect(stage.id).toBe('a');
    expect(play).toMatchObject({ courseStage: { index: 0, stageCount: 2 }, autoPlay: true });
    expect(play.courseStage.courseInfo).toMatchObject({ title: 'Dan', stageIndex: 0 });
  });

  test('PLAY on a course bar follows the Debug Menu’s auto play', async () => {
    const h = harness();
    await startFirstStage(h);
    expect(h.courses.autoPlay).toBeUndefined();
    expect(h.deps.playChart.mock.calls[0]![1]).not.toHaveProperty('autoPlay');
  });

  test('backing out of the decide screen drops the run, and the select screen goes back to the course bar', async () => {
    const h = harness();
    await h.route.startCourse(grade());
    h.decided().cancel!();
    expect(h.courses.active).toBeUndefined();
    expect(h.courses.takeReturnNavigation()).toBe(AT_COURSE_BAR);
  });

  test('a NEW COURSE bar starts making a course, and a course with a missing stage says why; neither runs', async () => {
    const h = harness();
    await h.route.startCourse(grade(['a'], { newCourse: true }));
    expect(h.deps.courseMaker.maker.start).toHaveBeenCalledWith('grade');
    expect(h.deps.setStatus).toHaveBeenLastCalledWith('Making a course: decide songs to add them, then save');

    await h.route.startCourse(
      grade(['a'], { playable: false, stages: [{ title: 'a', chart: chartEntry('a') }, { title: 'x' }] }),
    );
    expect(h.deps.setStatus).toHaveBeenLastCalledWith('Dan: 1 stage is not in the collection');
    expect(h.courses.active).toBeUndefined();
    expect(h.courses.takeReturnNavigation()).toBeUndefined();
    expect(h.deps.showDecide).not.toHaveBeenCalled();
  });

  test('a NONSTOP course goes to the NONSTOP route with its decide screen, and keeps no run', async () => {
    const h = harness();
    const base = grade();
    const nonstop = { ...base, definition: { ...base.definition, kind: 'nonstop' as const } };
    await h.route.startCourse(nonstop, { autoPlay: true });
    expect(h.deps.startNonstopCourse).toHaveBeenCalledWith(nonstop, { decide: true });
    expect(h.courses.active).toBeUndefined();
    expect(h.courses.autoPlay).toBe(true);
    expect(h.courses.takeReturnNavigation()).toBe(AT_COURSE_BAR);
  });

  test('a random course draws its stages from the library first, or says which stage found no chart', async () => {
    const h = harness();
    const random = grade(['a'], { random: {} as LibraryCourse['random'] });
    vi.mocked(drawBrowserRandomCourse).mockReturnValueOnce({ ok: false, stage: 0, reason: 'no-candidates' });
    await h.route.startCourse(random);
    expect(h.deps.setStatus).toHaveBeenLastCalledWith('Dan: stage 1 matches no chart');
    expect(h.deps.showDecide).not.toHaveBeenCalled();

    const drawn = grade(['b']);
    vi.mocked(drawBrowserRandomCourse).mockReturnValueOnce({ ok: true, course: drawn });
    await h.route.startCourse(random);
    // Every chart of the library is a candidate, with its hashes.
    expect(vi.mocked(drawBrowserRandomCourse).mock.calls.at(-1)![1]).toEqual([
      { chart: chartEntry('a') },
      { chart: chartEntry('b') },
    ]);
    expect(h.courses.active?.course).toBe(drawn);
    expect(h.deps.showDecide.mock.calls[0]![0]).toMatchObject({ id: 'b', title: 'Dan' });
  });
});

describe('CourseRoute: the stages and the course result', () => {
  test('dismissing a stage’s result plays the next stage, with the gauge the stage left', async () => {
    const h = harness();
    await startFirstStage(h, grade(), true);
    h.courses.active!.run.recordStage(stageLog(70));
    expect(h.route.continueCourse()).toBe(true);
    await vi.waitFor(() => expect(h.deps.playChart).toHaveBeenCalledTimes(2));
    const [stage, play] = h.deps.playChart.mock.calls[1]!;
    expect(stage.id).toBe('b');
    expect(play).toMatchObject({ courseStage: { index: 1, course: { carryIn: { gauge: 70 } } }, autoPlay: true });
    expect(h.deps.setStatus).toHaveBeenLastCalledWith('Dan: stage 2 / 2');
  });

  test('outside a course, dismissing a result does nothing here', () => {
    const h = harness();
    expect(h.route.continueCourse()).toBe(false);
    expect(h.deps.playChart).not.toHaveBeenCalled();
    expect(h.deps.showResult).not.toHaveBeenCalled();
  });

  test('after the last stage, the course result shows the run as one play, kept, saved and ranked as one', async () => {
    const h = harness();
    await startFirstStage(h);
    const active = h.courses.active!;
    active.run.recordStage(stageLog(70));
    active.run.recordStage(stageLog(60));
    expect(h.route.continueCourse()).toBe(true);
    await vi.waitFor(() => expect(h.deps.showResult).toHaveBeenCalled());
    // The course result takes the run: the select screen goes back to the course bar after it.
    expect(h.courses.active).toBeUndefined();
    expect(h.courses.takeReturnNavigation()).toBe(AT_COURSE_BAR);

    const courseLog = h.deps.replayAutoSave.saveCourse.mock.calls[0]![0];
    expect(courseLog).toMatchObject({ course: { name: 'Dan', kind: 'grade' }, recorder: { name: 'be-music-web' } });
    expect(courseLog.stages.map((stage) => stage.played)).toEqual([true, true]);
    expect(h.deps.records.recordCourseResult.mock.calls[0]![0]?.key).toMatch(/^lr2:course:grade:/);
    expect(h.deps.leaderboard.maybeSubmitCourse).toHaveBeenCalledWith(courseLog, active.run.stages);
    const [data, mode] = h.deps.showResult.mock.calls[0]!;
    expect(data).toMatchObject({ run: 'course', chart: { title: 'Dan' }, cleared: true });
    expect(mode.course).toMatchObject({ title: 'Dan' });
    expect(mode.courseLog!.log).toBe(courseLog);
    expect(h.deps.showBeatorajaResult).not.toHaveBeenCalled();
  });

  test('a course given up with ESC shows its course result as a failed run', async () => {
    const h = harness();
    await startFirstStage(h);
    const active = h.courses.active!;
    h.courses.giveUp(active, stageLog(40, { aborted: true }));
    await h.route.showCourseResult();
    const [data, mode] = h.deps.showResult.mock.calls[0]!;
    expect(data).toMatchObject({ run: 'course', cleared: false, lamp: 'FAILED' });
    expect(mode.courseLog!.native.stagesPlayed).toBe(1);
    expect(h.courses.active).toBeUndefined();
  });

  test('a course result with no stage played goes back to the select screen', async () => {
    const h = harness();
    await h.route.startCourse(grade());
    await h.route.showCourseResult();
    expect(h.deps.showSelect).toHaveBeenCalledOnce();
    expect(h.deps.showResult).not.toHaveBeenCalled();
    expect(h.deps.records.recordCourseResult).not.toHaveBeenCalled();
  });

  test('a beatoraja theme shows the course result on its skin, every stage joined', async () => {
    const h = harness({ family: 'beatoraja' });
    await startFirstStage(h);
    h.courses.active!.run.recordStage(stageLog(70));
    h.courses.active!.run.recordStage(stageLog(60));
    await h.route.showCourseResult();
    const [data, options] = h.deps.showBeatorajaResult.mock.calls[0]!;
    expect(options.run).toBe('course');
    expect(options.course.info).toMatchObject({ title: 'Dan' });
    expect(data.courseRun?.stageHistories).toHaveLength(2);
    expect(h.deps.unlockReplayOptions).toHaveBeenCalledOnce();
    expect(h.deps.showResult).not.toHaveBeenCalled();
  });

  test('a beatoraja theme with no result skin to show leaves the course result to the LR2 or built-in screen', async () => {
    const h = harness({ family: 'beatoraja', beatorajaMounts: false });
    await startFirstStage(h);
    h.courses.active!.run.recordStage(stageLog(0));
    await h.route.showCourseResult();
    expect(h.deps.showBeatorajaResult).toHaveBeenCalledOnce();
    expect(h.deps.unlockReplayOptions).not.toHaveBeenCalled();
    expect(h.deps.showResult.mock.calls[0]![0]).toMatchObject({ run: 'course', cleared: false });
  });
});

test('a practice course shows its summed result without recording, ranking or auto-saving', async () => {
  const h = harness();
  await startFirstStage(h);
  const active = h.courses.active!;
  active.run.recordStage(stageLog(70));
  active.run.recordStage(undefined, {
    gaugeHistory: [],
    scoreHistory: [],
    playSeconds: 10,
    practice: true,
    stageOutcome: stageLog(60).results!.native!,
  });
  await h.route.showCourseResult();
  expect(h.deps.showResult.mock.calls[0]?.[0]).toMatchObject({ practice: true, run: 'course', cleared: true });
  expect(h.deps.showResult.mock.calls[0]?.[1].courseLog).toBeUndefined();
  expect(h.deps.records.recordCourseResult).not.toHaveBeenCalled();
  expect(h.deps.replayAutoSave.saveCourse).not.toHaveBeenCalled();
  expect(h.deps.leaderboard.maybeSubmitCourse).not.toHaveBeenCalled();
});

describe('CourseRoute kept draws', () => {
  test.each([undefined, true])('keeps a draw only when the decide screen shows (AUTO %s)', async (autoPlay) => {
    const h = harness();
    const random = grade(['a'], { random: {} as LibraryCourse['random'] });
    const drawn = grade(['b']);
    const kept = {
      ...drawn,
      id: 'kept-draw',
      definition: { ...drawn.definition, name: 'Dan 20261024_123456', release: false },
    };
    const remember = vi.fn();
    h.deps.library.prepareDrawnCourse.mockReturnValueOnce({ course: kept, remember });
    vi.mocked(drawBrowserRandomCourse).mockReturnValueOnce({ ok: true, course: drawn });
    await h.route.startCourse(random, { autoPlay });
    expect(h.courses.active?.course).toBe(kept);
    expect(h.courses.autoPlay).toBe(autoPlay);
    expect(remember).not.toHaveBeenCalled();
    const continuation = h.deps.showDecide.mock.calls[0]![2];
    continuation.shown!();
    expect(remember).toHaveBeenCalledOnce();
    h.courses.finishRun();
    expect(h.courses.takeReturnNavigation()).toMatchObject({ folderPath: ['courses'], focusKey: 'course:kept-draw' });
  });

  test('does not keep a stale draw after the run was interrupted', async () => {
    const h = harness();
    vi.mocked(drawBrowserRandomCourse).mockReturnValueOnce({ ok: true, course: grade(['b']) });
    await h.route.startCourse(grade(['a'], { random: {} as LibraryCourse['random'] }));
    const prepared = h.deps.library.prepareDrawnCourse.mock.results[0]!.value;
    h.courses.endRun();
    h.deps.showDecide.mock.calls[0]![2].shown!();
    expect(prepared.remember).not.toHaveBeenCalled();
  });
});

/**
 * A course replay of the GRADE course `grade(ids)`, its stages played with `stages` (the rest never reached), with the
 * course result it recorded: the last stage's gauge, cleared when every stage was reached.
 */
function gradeReplay(stages: BeMusicReplay[], ids: string[] = ['a', 'b', 'c']): BeMusicCourseReplay {
  const last = stages.at(-1)!.results!.native!;
  const cleared = stages.length === ids.length && last.gauge.cleared;
  const native = {
    ...last,
    noteCount: 10 * ids.length,
    missCount: 0,
    djLevel: 'AAA',
    gauge: { ...last.gauge, cleared },
    stagesPlayed: stages.length,
    lamp: cleared ? 'NORMAL' : 'FAILED',
    stages: stages.map((stage) => stage.results!.native!),
  } as ReplayCourseResult;
  return {
    format: 'be-music-course-replay',
    version: 1,
    course: { name: 'Dan', kind: 'grade', constraints: ['grade'], trophies: [] },
    stages: ids.map((_, index) =>
      stages[index] !== undefined
        ? { played: true, replay: stages[index]! }
        : { played: false, md5: String(index + 1).repeat(32), facts: {} as never },
    ),
    results: { native },
  };
}

/** The live result of a stage played back from its replay: a replay played back records none. */
const PLAYED_BACK = { gaugeHistory: [], scoreHistory: [], playSeconds: 30, fromReplay: true } as unknown as PlayResult;

describe('CourseRoute: a course replay', () => {
  test('plays each recorded stage with its own replay, in order, through the decide screen', async () => {
    const h = harness();
    const first = stageLog(70);
    const second = stageLog(60);
    const log = gradeReplay([first, second], ['a', 'b']);
    await h.route.startCourseReplay(grade(), log);
    expect(h.courses.active?.replay?.log).toBe(log);
    expect(h.deps.showDecide.mock.calls[0]![0]).toMatchObject({ id: 'a', title: 'Dan' });
    await h.decided().start();
    expect(h.deps.playChart).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'a' }),
      expect.objectContaining({ replay: first, autoPlay: false, courseStage: expect.objectContaining({ index: 0 }) }),
    );
    expect(h.deps.setStatus).toHaveBeenLastCalledWith('Dan: stage 1 / 2 (replay)');
    recordCourseStage(h.courses.active!, PLAYED_BACK);
    expect(h.route.continueCourse()).toBe(true);
    await vi.waitFor(() => expect(h.deps.playChart).toHaveBeenCalledTimes(2));
    expect(h.deps.playChart.mock.calls[1]![1]).toMatchObject({ replay: second, courseStage: { index: 1 } });
  });

  test('stops where the recorded run failed, and shows its course result without keeping anything', async () => {
    const h = harness();
    const log = gradeReplay([stageLog(70), stageLog(0)]);
    await h.route.startCourseReplay(grade(['a', 'b', 'c']), log);
    await h.decided().start();
    recordCourseStage(h.courses.active!, PLAYED_BACK);
    h.route.continueCourse();
    await vi.waitFor(() => expect(h.deps.playChart).toHaveBeenCalledTimes(2));
    recordCourseStage(h.courses.active!, PLAYED_BACK);
    // The failed stage ends the run: the course result, not the third stage.
    expect(h.route.continueCourse()).toBe(true);
    await vi.waitFor(() => expect(h.deps.showResult).toHaveBeenCalled());
    expect(h.deps.playChart).toHaveBeenCalledTimes(2);
    const [data, mode] = h.deps.showResult.mock.calls[0]!;
    expect(data).toMatchObject({ run: 'course', cleared: false, fromReplay: true });
    expect(mode.courseLog?.log).toBe(log);
    expect(mode.courseLog?.native.stagesPlayed).toBe(2);
    // A replay keeps no course record, saves no replay and ranks nothing.
    expect(h.deps.records.recordCourseResult).not.toHaveBeenCalled();
    expect(h.deps.replayAutoSave.saveCourse).not.toHaveBeenCalled();
    expect(h.deps.leaderboard.maybeSubmitCourse).not.toHaveBeenCalled();
  });

  test('a stage the recorded run gave up ends the run as given up', async () => {
    const h = harness();
    const log = gradeReplay([stageLog(70), stageLog(50, { aborted: true })]);
    await h.route.startCourseReplay(grade(['a', 'b', 'c']), log);
    await h.decided().start();
    recordCourseStage(h.courses.active!, PLAYED_BACK);
    h.route.continueCourse();
    await vi.waitFor(() => expect(h.deps.playChart).toHaveBeenCalledTimes(2));
    recordCourseStage(h.courses.active!, PLAYED_BACK);
    expect(h.courses.active!.run.finished).toBe(true);
    await h.route.showCourseResult();
    expect(h.deps.showResult.mock.calls[0]![0]).toMatchObject({ cleared: false, lamp: 'FAILED', fromReplay: true });
  });

  test('a course replay with no stage played starts nothing', async () => {
    const h = harness();
    const log = gradeReplay([stageLog(70)]);
    log.stages[0] = { played: false, md5: '1'.repeat(32), facts: {} as never };
    await h.route.startCourseReplay(grade(['a', 'b', 'c']), log);
    expect(h.deps.showDecide).not.toHaveBeenCalled();
    expect(h.courses.active).toBeUndefined();
  });
});
