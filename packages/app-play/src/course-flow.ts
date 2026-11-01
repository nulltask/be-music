import { playerText } from './player-copy.ts';
import {
  CourseRun,
  type CourseConstraint,
  type CourseDefinition,
  type CourseRunStagePlan,
  type RandomCourseDrawFailure,
} from '@be-music/player-engine/course';
import {
  listCourseReplayStageCharts,
  matchesCourseReplayStageChart,
  planCourseReplayPlayback,
  resolveCoursePlayedRuleset,
  type BeMusicCourseReplay,
  type BeMusicReplay,
  type CourseReplayStageChart,
  type CourseReplayStagePlayback,
  type ReplayCourseResult,
} from '@be-music/player-engine/replay';
import {
  resolveCourseView,
  resolveLibraryChartKeyMode,
  type CourseView,
  type LibraryChart,
  type LibraryCourse,
  type PlayResult,
} from '@be-music/player-scene-model';
import { EMPTY_COURSE_STAGE_HISTORY, type CourseStageHistory } from './course-result.ts';
import type { NonstopPlayFailure } from './nonstop-course.ts';
import { courseRunKeepsRecord, courseRunRecordPlay, type RecordPlay } from '@be-music/player-engine/records';
import { rulesetRecordKey } from './chart-best-records.ts';
import { resolveDanRankUpdate } from './dan-ranks.ts';
import type { DanRank } from '@be-music/player-engine/records';

/**
 * The decisions the player's course flow takes, kept apart from the scenes that act on them so they can be tested: what
 * a course bar starts, what a stage's end leads to, and which runs keep a record.
 */

/** What picking a course bar starts. */
export type CourseStartPlan =
  /** A NEW COURSE bar: start making a course of its folder's kind. */
  | { action: 'make'; kind: LibraryCourse['definition']['kind'] }
  /** A RANDOM MIX bar: draw a course of its folder's kind, keep it, then play it. */
  | { action: 'random-mix'; kind: 'expert' | 'nonstop' }
  /** A course with a stage missing from the collection: nothing starts. */
  | { action: 'unplayable' }
  /** A random course: draw its stages first, then plan the drawn course. */
  | { action: 'draw' }
  /** A NONSTOP course: stitch its stages and play them as one chart. */
  | { action: 'nonstop' }
  /** Any other course: play its stages one by one. */
  | { action: 'stages' };

export function planCourseStart(entry: LibraryCourse): CourseStartPlan {
  if (entry.newCourse === true) return { action: 'make', kind: entry.definition.kind };
  if (entry.randomMix === true && entry.definition.kind !== 'grade') {
    return { action: 'random-mix', kind: entry.definition.kind };
  }
  if (!entry.playable) return { action: 'unplayable' };
  if (entry.random !== undefined) return { action: 'draw' };
  return entry.definition.kind === 'nonstop' ? { action: 'nonstop' } : { action: 'stages' };
}

/** An EXPERT / GRADE course being played: the course bar it started from and its run. */
export interface ActiveCourse {
  course: LibraryCourse;
  run: CourseRun<LibraryChart, CourseStageHistory>;
  /** Set when the run plays a course replay back: the log, and the stage replays it plays up to where it stopped. */
  replay?: ActiveCourseReplay;
}

/** A course replay being played back as a course run. */
export interface ActiveCourseReplay {
  log: BeMusicCourseReplay;
  stages: CourseReplayStagePlayback[];
}

/** A stage of a running course as the player plays it: the run's plan, with the course as the skins show it there. */
export interface CourseStagePlay extends CourseRunStagePlan<LibraryChart> {
  courseInfo: CourseView;
  /** The stage's recorded replay, when the run plays a course replay back: it plays with the state it carried in. */
  replay?: BeMusicReplay;
}

/**
 * Starts a run of a course whose stages are all in the collection (`CourseRun` refuses one with a stage missing), or,
 * with `replay`, a run that plays that course replay back ({@link planCourseReplayPlayback}).
 */
export function startCourseRun(course: LibraryCourse, replay?: BeMusicCourseReplay): ActiveCourse {
  return {
    course,
    run: new CourseRun(
      course.definition,
      course.stages.map((stage) => stage.chart),
    ),
    ...(replay !== undefined ? { replay: { log: replay, stages: planCourseReplayPlayback(replay) } } : {}),
  };
}

/**
 * The next stage of a running course, with the course as the skins show it there; `undefined` once the run is over. A
 * course replay's run is over once its recorded stages have played, and each stage plays its own replay.
 */
export function nextCourseStagePlay(active: ActiveCourse): CourseStagePlay | undefined {
  const plan = active.run.nextStage();
  if (plan === undefined) return undefined;
  const courseInfo = resolveCourseView(active.course, plan.index);
  if (active.replay === undefined) return { ...plan, courseInfo };
  const recorded = active.replay.stages[plan.index];
  return recorded === undefined ? undefined : { ...plan, courseInfo, replay: recorded.replay };
}

/**
 * Records a finished stage on the run. A course replay's stage records its recorded replay (the replay played back
 * records none), and a stage the recorded run gave up ends the run as given up, as it did.
 */
export function recordCourseStage(active: ActiveCourse, result: PlayResult): void {
  const recorded = active.replay?.stages[active.run.stagesPlayed];
  if (recorded === undefined) {
    active.run.recordStage(result.replay, result);
    return;
  }
  if (recorded.end === 'given-up') active.run.giveUp(recorded.replay, result);
  else active.run.recordStage(recorded.replay, result);
}

/** Whether the run goes on after this stage ({@link recordCourseStage} leaving it unfinished). */
export function courseGoesOnAfter(active: ActiveCourse, result: PlayResult): boolean {
  const recorded = active.replay?.stages[active.run.stagesPlayed];
  if (recorded === undefined) return active.run.goesOnAfter(result.replay, result.stageOutcome);
  return recorded.end === 'next' && active.run.goesOnAfter(recorded.replay, result.stageOutcome);
}

/** Whether the stage just played is one the recorded run gave up: the run ends there with no stage result, as it did. */
export function courseReplayStageGivenUp(active: ActiveCourse | undefined): boolean {
  return active?.replay?.stages[active.run.stagesPlayed]?.end === 'given-up';
}

/**
 * A course replay's stages matched against the library: each stage's chart, or `undefined` when no loaded chart is the
 * stage's. `keysOf` gives a loaded chart's hashes and, when a stage is named by its fingerprint alone, its chart
 * fingerprint.
 */
export async function matchCourseReplayCharts(
  courseLog: Pick<BeMusicCourseReplay, 'stages'>,
  charts: readonly LibraryChart[],
  keysOf: (
    chartEntry: LibraryChart,
    needFingerprint: boolean,
  ) => Promise<{ sha256?: string; md5?: string; chartFingerprint?: string } | undefined>,
): Promise<Array<{ stage: CourseReplayStageChart; chart?: LibraryChart }>> {
  const stages = listCourseReplayStageCharts(courseLog);
  const needFingerprint = stages.some(
    (stage) => stage.sha256 === undefined && stage.md5 === undefined && stage.chartFingerprint !== undefined,
  );
  const found = new Map<number, LibraryChart>();
  for (const chartEntry of charts) {
    if (found.size === stages.length) break;
    const pending = stages.filter((stage) => !found.has(stage.index));
    const keys = await keysOf(chartEntry, needFingerprint);
    if (keys === undefined) continue;
    for (const stage of pending) {
      if (matchesCourseReplayStageChart(stage, keys)) found.set(stage.index, chartEntry);
    }
  }
  return stages.map((stage) => {
    const chart = found.get(stage.index);
    return chart !== undefined ? { stage, chart } : { stage };
  });
}

/** How the missing-chart dialog names a stage: its title, else the hash it was looked for by. */
export function describeCourseReplayStage(stage: CourseReplayStageChart): string {
  const name = stage.title ?? stage.sha256 ?? stage.md5 ?? stage.chartFingerprint ?? 'unknown chart';
  return `Stage ${stage.index + 1}: ${name}${stage.title !== undefined && stage.artist !== undefined ? ` / ${stage.artist}` : ''}`;
}

/**
 * The course a course replay was played on, rebuilt from the log and its stages' charts as found in the library: its
 * name, kind, constraints and trophies as recorded, a NONSTOP run's connections, and each stage by its hashes. No course
 * file stands behind it, so it reads as a beatoraja course (no LR2 GRADE resets: the stage replays carry their setup).
 * `charts` lists each stage's chart by stage index; a course with one missing is not playable.
 */
export function courseFromReplay(
  courseLog: BeMusicCourseReplay,
  charts: ReadonlyArray<LibraryChart | undefined>,
): LibraryCourse {
  const stages = listCourseReplayStageCharts(courseLog);
  const definition: CourseDefinition = {
    name: courseLog.course.name,
    kind: courseLog.course.kind,
    stages: stages.map((stage) => ({
      ...(stage.sha256 !== undefined ? { sha256: stage.sha256 } : {}),
      ...(stage.md5 !== undefined ? { md5: stage.md5 } : {}),
      ...(charts[stage.index]?.title !== undefined ? { title: charts[stage.index]!.title } : {}),
    })),
    constraints: courseLog.course.constraints as CourseConstraint[],
    trophies: courseLog.course.trophies.map((trophy) => ({ ...trophy })),
    release: courseLog.course.release !== false,
    ...(courseLog.nonstop !== undefined ? { connections: [...courseLog.nonstop.connections] } : {}),
    source: { format: 'beatoraja-json' },
  };
  return {
    id: `replay:${courseLog.course.name}`,
    definition,
    stages: stages.map((stage) => {
      const chart = charts[stage.index];
      return {
        title: chart?.title ?? stage.title ?? `Stage ${stage.index + 1}`,
        ...(chart !== undefined ? { chart } : {}),
      };
    }),
    playable: charts.length === stages.length && charts.every((chart) => chart !== undefined),
  };
}

/** The course as the skins show it at the stage last played (none before the first one). */
export function activeCourseInfo(active: ActiveCourse): CourseView {
  const played = active.run.stagesPlayed;
  return resolveCourseView(active.course, played > 0 ? played - 1 : undefined);
}

/** The graphs of every stage played, in order: a stage given up, or played without graphs, has empty ones. */
export function courseStageHistories(active: ActiveCourse): CourseStageHistory[] {
  return active.run.stageExtras.map((history) => history ?? EMPTY_COURSE_STAGE_HISTORY);
}

/**
 * The song the decide screen shows before a course's first stage. It names the selected bar, the course, as LR2's
 * splash does; the first stage's chart supplies the rest, without the stage's own subtitle, artist and genre.
 */
export function courseDecideSong(course: LibraryCourse, first: LibraryChart): LibraryChart {
  const { subtitle: _subtitle, artist: _artist, genre: _genre, ...stage } = first;
  return { ...stage, title: course.definition.name };
}

/** The status line for a course that cannot start because some of its stages are not in the collection. */
export function describeUnplayableCourse(course: LibraryCourse): string {
  const missing = course.stages.filter((stage) => stage.chart === undefined).length;
  return playerText().course.stageMissing(course.definition.name, missing);
}

/** The status line for a random course whose stages could not be drawn. */
export function describeRandomCourseDrawFailure(name: string, failure: RandomCourseDrawFailure): string {
  const copy = playerText().course;
  const stage = failure.stage + 1;
  return failure.reason === 'no-candidates'
    ? copy.randomNoChart(name, stage)
    : copy.randomBadFilter(name, stage, failure.error ?? '');
}

/** The status line for a NONSTOP course that could not be stitched. */
export function describeNonstopPrepareFailure(
  name: string,
  failure: { reason: NonstopPlayFailure; stage?: number },
): string {
  const copy = playerText().course;
  const stage = failure.stage !== undefined ? copy.stageNote(failure.stage + 1) : '';
  if (failure.reason === 'generic-layout-mismatch') return copy.nonstopLayout(name, stage);
  return copy.nonstopStitch(name, failure.reason, stage);
}

/**
 * The record a course run leaves under the course's `key`, kept under the judge ruleset the run was played on
 * (`resolveCoursePlayedRuleset`), or `undefined` when the run keeps none: an auto-played run, one at another tempo,
 * which is practice (and the Leaderboard refuses it as `tempo`), and one whose stages were judged under different
 * rulesets.
 */
export function resolveCourseBestRecordUpdate(
  courseLog: Pick<BeMusicCourseReplay, 'stages' | 'nonstop'>,
  result: ReplayCourseResult,
  key: string,
): { key: string; play: RecordPlay } | undefined {
  const ruleset = resolveCoursePlayedRuleset(courseLog);
  if (ruleset === undefined || !courseRunKeepsRecord(courseLog)) return undefined;
  return { key: rulesetRecordKey(ruleset, key), play: courseRunRecordPlay(result) };
}

/**
 * The dan rank a course run certifies and the key it is kept under (`resolveDanRankUpdate`), or `undefined`: only a run
 * that keeps a best record ({@link resolveCourseBestRecordUpdate}) can certify one, under the judge ruleset it was played
 * on, in the key mode the course names or its stages' charts share. Existing records are never read back into ranks: a
 * rank comes from runs played from now on.
 */
export function resolveCourseDanRankUpdate(
  course: Pick<LibraryCourse, 'definition' | 'stages'>,
  courseLog: Pick<BeMusicCourseReplay, 'stages' | 'nonstop'>,
  result: Pick<ReplayCourseResult, 'lamp'>,
): { key: string; rank: DanRank } | undefined {
  const ruleset = resolveCoursePlayedRuleset(courseLog);
  if (ruleset === undefined || !courseRunKeepsRecord(courseLog)) return undefined;
  return resolveDanRankUpdate(
    {
      definition: course.definition,
      stageKeyModes: course.stages.map((stage) =>
        stage.chart !== undefined ? resolveLibraryChartKeyMode(stage.chart) : undefined,
      ),
      lamp: result.lamp,
    },
    ruleset,
  );
}

/** What a play is, for the gameplay exits below. */
export interface CoursePlayKind {
  /** A stage of a running EXPERT / GRADE course. */
  courseStage: boolean;
  /** A NONSTOP course's stitched play. */
  nonstop: boolean;
}

/**
 * Where ESC leads: a running course is given up and ends as a failed run (its course result shows), a NONSTOP run shows
 * its result as it stands, and a single chart goes back to the select screen.
 */
export function resolveGameplayExit(play: CoursePlayKind): 'give-up-course' | 'nonstop-result' | 'select' {
  if (play.courseStage) return 'give-up-course';
  return play.nonstop ? 'nonstop-result' : 'select';
}

/**
 * Where F5 (restart) leads: a NONSTOP course is stitched and played again, as LR2 allows quick retry there; in a course
 * stage it gives the course up, since quick retry is off there; a single chart plays again.
 */
export function resolveGameplayRestart(play: CoursePlayKind): 'restitch' | 'abandon-course' | 'replay' {
  if (play.nonstop) return 'restitch';
  return play.courseStage ? 'abandon-course' : 'replay';
}

/**
 * The overrides a single chart plays again with (F5): the play's own AUTO and replay, not the Debug Menu's. Without
 * them an AUTO play started from a skin's AUTO button would start again as a manual play, and a replay as a live play
 * that keeps a record.
 */
export function playAgainOverrides<L>(play: { autoPlay: boolean; replay?: L | undefined }): {
  autoPlay: boolean;
  replay?: L;
} {
  return { autoPlay: play.autoPlay, ...(play.replay !== undefined ? { replay: play.replay } : {}) };
}

/**
 * What R on the result does: a NONSTOP run is stitched and played again; a single chart plays again when the last
 * play started is this chart's; a course stage or a course result offers no retry, as LR2 and beatoraja disable quick
 * retry there.
 */
export function resolveResultRetry<T>(options: {
  /** Whether the result offers quick retry at all (`resolveResultPresentation`). */
  quickRetry: boolean;
  nonstopRetry?: () => void;
  chartId: string;
  lastPlay?: { chartId: string; play: T };
}): { kind: 'nonstop'; retry: () => void } | { kind: 'replay'; play: T } | undefined {
  if (options.nonstopRetry !== undefined) return { kind: 'nonstop', retry: options.nonstopRetry };
  if (!options.quickRetry || options.lastPlay?.chartId !== options.chartId) return undefined;
  return { kind: 'replay', play: options.lastPlay.play };
}
