import type { PlayerSummary } from '@be-music/player/core/engine';
import { resolveLr2MoneyScore } from '@be-music/player/core/scoring';
import {
  createCoursePlaylog,
  resolveCourseTrophy,
  type RulesetChartFacts,
  type BeMusicCoursePlaylog,
  type BeMusicPlaylog,
  type PlaylogCourseResult,
  type PlaylogCourseStage,
  type PlaylogCourseStageEntry,
} from '@be-music/player/playlog';
import { resolveSceneCourseInfo, type PixiGameplayResultData, type SceneCourseInfo } from '@be-music/player-web/scenes';
import {
  applyCourseLongNoteConstraint,
  isCourseHiSpeedLocked,
  resolveCourseLaneOptions,
  resolveLr2GradeCoursePlaySettings,
  resolveCourseStageSettings,
  type CourseLaneOptions,
  type Lr2GradeResetSettings,
} from '@be-music/player-web/collection';
import type { BrowserCourseEntry, BrowserSongEntry } from '@be-music/player-web/collection';
import type {
  BeMusicCourseRecord,
  BeMusicSongRecord,
  GaugeHistorySample,
  ScoreHistorySample,
} from '@be-music/player-web/skin';

const EMPTY_HISTORY: CourseStageHistory = { gaugeHistory: [], scoreHistory: [] };

/** A stage's gauge and EX-score polylines (`progress` 0..1 over the stage), as its result shows them. */
export interface CourseStageHistory {
  gaugeHistory: readonly GaugeHistorySample[];
  scoreHistory: readonly ScoreHistorySample[];
  /** The stage's play time in seconds (its result's `playSeconds`), when known. */
  playSeconds?: number;
}

/** The player's picks a course may override for a stage (see {@link CourseSession.playSettings}). */
export interface CourseStagePlaySettings extends CourseLaneOptions, Lr2GradeResetSettings {}

/** What the next stage of a running course plays: its chart (with the course's long-note constraint applied) and settings. */
export interface CourseStagePlan {
  /** Zero-based stage index. */
  index: number;
  stageCount: number;
  song: BrowserSongEntry;
  /** `PlayerOptions.course` for the stage, with the state the previous stage left. */
  course: PlaylogCourseStage;
  /** The course and this stage as the skins show them. */
  courseInfo: SceneCourseInfo;
  hiSpeedLocked: boolean;
}

/**
 * One course run in the demo: plays the stages in order, carrying each stage's gauge value and course combo into the
 * next, and ends the course when a stage fails or the last stage is done. The stage play logs it collects make the
 * course play log.
 */
export class CourseSession {
  readonly course: BrowserCourseEntry;
  private readonly logs: BeMusicPlaylog[] = [];
  /** Each played stage's polylines, in order (empty for a stage given up or played without them). */
  private readonly histories: CourseStageHistory[] = [];
  private ended = false;

  constructor(course: BrowserCourseEntry) {
    if (!course.playable) {
      throw new Error(`course "${course.definition.name}" has a stage that is not in the collection`);
    }
    this.course = course;
  }

  /** Stages played so far. */
  get stagesPlayed(): number {
    return this.logs.length;
  }

  /** The course as the skins show it, at the stage last played (none before the first one). */
  get courseInfo(): SceneCourseInfo {
    return resolveSceneCourseInfo(this.course, this.logs.length > 0 ? this.logs.length - 1 : undefined);
  }

  /** True once a stage failed or the last stage was played. */
  get finished(): boolean {
    return this.ended;
  }

  /** The next stage to play, or `undefined` when the course is over. */
  nextStage(): CourseStagePlan | undefined {
    if (this.ended) return undefined;
    const index = this.logs.length;
    const course: PlaylogCourseStage = resolveCourseStageSettings(this.course.definition);
    const previous = this.logs.at(-1)?.results?.native;
    if (previous !== undefined) {
      course.carryIn = {
        gauge: previous.gauge.final,
        combo: previous.course?.combo ?? 0,
        maxCombo: previous.course?.maxCombo ?? previous.maxCombo,
      };
    }
    const constraints = this.course.definition.constraints;
    return {
      index,
      stageCount: this.course.stages.length,
      song: this.stageSong(index),
      course,
      courseInfo: resolveSceneCourseInfo(this.course, index),
      hiSpeedLocked: isCourseHiSpeedLocked(constraints),
    };
  }

  /** Every stage's song as the course plays it, in order (what a played stage's fingerprints describe). */
  stageSongs(): BrowserSongEntry[] {
    return this.course.stages.map((_stage, index) => this.stageSong(index));
  }

  /** A stage's song as the course plays it: its chart with the course's long-note constraint applied. */
  private stageSong(index: number): BrowserSongEntry {
    const song = this.course.stages[index]!.song!;
    const chart = applyCourseLongNoteConstraint(song.chart, this.course.definition.constraints);
    return chart === song.chart ? song : { ...song, chart };
  }

  /** The lane options (both sides and DP FLIP) the course lets a stage play with, in place of the player's picks. */
  laneOptions(picked: CourseLaneOptions): CourseLaneOptions {
    return resolveCourseLaneOptions(this.course.definition.constraints, picked);
  }

  /**
   * The settings a stage plays with in place of the player's picks: the lane options the course allows
   * ({@link laneOptions}), then, on an LR2 GRADE course, LR2's resets (EASY gauge to GROOVE; HIDDEN / SUDDEN, auto
   * scratch, FLIP and the tempo off; `resolveLr2GradeCoursePlaySettings`). The player's own settings are left as they
   * are, so they come back after the course.
   */
  playSettings(picked: CourseStagePlaySettings): CourseStagePlaySettings {
    const { definition } = this.course;
    return resolveLr2GradeCoursePlaySettings(definition, { ...picked, ...this.laneOptions(picked) });
  }

  /**
   * Records a finished stage's play log. Returns whether the course goes on: it ends when the stage's gauge emptied,
   * when it was the last stage, or when the stage left no play log (nothing to carry on from).
   */
  recordStage(playlog: BeMusicPlaylog | undefined, history?: CourseStageHistory): 'next' | 'finished' {
    if (this.ended) return 'finished';
    const goesOn = this.goesOnAfter(playlog);
    if (playlog?.results?.native !== undefined) {
      this.logs.push(playlog);
      this.histories.push(history ?? EMPTY_HISTORY);
    }
    if (!goesOn) {
      this.ended = true;
      return 'finished';
    }
    return 'next';
  }

  /** Whether the course would go on after recording `playlog` as the next stage ({@link recordStage} returning `next`). */
  goesOnAfter(playlog: BeMusicPlaylog | undefined): boolean {
    if (this.ended) return false;
    const native = playlog?.results?.native;
    if (native === undefined) return false;
    const failed = native.gauge.failedMidPlay === true || native.gauge.final <= 0;
    return !failed && this.logs.length + 1 < this.course.stages.length;
  }

  /**
   * Records the stage the player gave up with ESC (its play log is marked `play.aborted`) and ends the course: a course
   * given up is a failed run, as LR2 records it. A stage without a play log just ends the course.
   */
  giveUp(playlog: BeMusicPlaylog | undefined): void {
    if (this.ended) return;
    if (playlog?.results?.native !== undefined) {
      this.logs.push(playlog);
      // No polylines for a stage given up, but its play time runs up to where it was left.
      const abortedAtUs = playlog.play?.abortedAtUs;
      this.histories.push(
        abortedAtUs !== undefined ? { ...EMPTY_HISTORY, playSeconds: abortedAtUs / 1e6 } : EMPTY_HISTORY,
      );
    }
    this.ended = true;
  }

  /** The play time of every stage played, in seconds: what the course result shows as its PLAY TIME. */
  get playSeconds(): number {
    return this.histories.reduce((sum, history) => sum + Math.max(0, history.playSeconds ?? 0), 0);
  }

  /** The polylines of every stage played, in order (a stage given up has none). */
  get stageHistories(): readonly CourseStageHistory[] {
    return this.histories;
  }

  /**
   * The course play log: the stages played, then every stage the run never reached with its chart facts (`factsOf`,
   * e.g. `resolveChartRulesetFacts`) and its chart fingerprint (`chartFingerprintOf`, which keys the course on the
   * Leaderboard). Both read the stage's song as the course plays it (its long-note constraint applied), as a played
   * stage's log does.
   */
  buildPlaylog(
    factsOf: (song: BrowserSongEntry) => RulesetChartFacts,
    options: {
      createdAt?: string;
      recorder?: BeMusicPlaylog['recorder'];
      chartFingerprintOf?: (song: BrowserSongEntry) => string | undefined;
    } = {},
  ): BeMusicCoursePlaylog {
    const { definition } = this.course;
    const stages: PlaylogCourseStageEntry[] = this.course.stages.map((_stage, index) => {
      const playlog = this.logs[index];
      if (playlog !== undefined) return { played: true, playlog };
      const ref = definition.stages[index];
      const song = this.stageSong(index);
      const chartFingerprint = options.chartFingerprintOf?.(song);
      return {
        played: false,
        facts: factsOf(song),
        ...(ref?.sha256 !== undefined ? { sha256: ref.sha256 } : {}),
        ...(ref?.md5 !== undefined ? { md5: ref.md5 } : {}),
        ...(chartFingerprint !== undefined ? { chartFingerprint } : {}),
      };
    });
    return createCoursePlaylog({
      course: {
        name: definition.name,
        kind: definition.kind,
        constraints: [...definition.constraints],
        trophies: definition.trophies.map((trophy) => ({ ...trophy })),
        ...(definition.release === false ? { release: false as const } : {}),
      },
      stages,
      ...(options.createdAt !== undefined ? { createdAt: options.createdAt } : {}),
      ...(options.recorder !== undefined ? { recorder: options.recorder } : {}),
    });
  }
}

/**
 * Whether a finished course stage goes straight on to the next stage without showing its result: always with stage
 * results skipped (the Debug Menu's **Skip stage results**), and, as LR2 does (OpenLR2 `Main.cpp` M1381-M1384), when the
 * course plays itself and goes on after the stage. The last stage's result (or a failed one's) still shows then.
 */
export function skipsCourseStageResult(options: {
  skipStageResults: boolean;
  autoPlay: boolean;
  courseGoesOn: boolean;
}): boolean {
  return options.skipStageResults || (options.autoPlay && options.courseGoesOn);
}

/** Which result a result screen shows: a single play, a course stage, a course run, or a NONSTOP run. */
export type ResultRun = 'single' | 'stage' | 'course' | 'nonstop';

/**
 * How a result screen presents its run, as LR2 does. A course run (EXPERT / GRADE) ends on the course result: the
 * course-result skin (falling back to the result skin) with the course jingles, and no quick retry. A NONSTOP run has no
 * course-result step (OpenLR2 `Main.cpp` M1406-M1412 only moves EXPERT / GRADE on to it), so it shows on the result
 * skin with the clear / fail jingles, and R retries it as for a single play (L2854 allows the result's quick retry
 * outside a course and on NONSTOP). A course stage's result offers no retry.
 */
export function resolveResultPresentation(run: ResultRun): {
  courseResultSkin: boolean;
  courseJingles: boolean;
  quickRetry: boolean;
} {
  const course = run === 'course';
  return { courseResultSkin: course, courseJingles: course, quickRetry: run === 'single' || run === 'nonstop' };
}

/**
 * The key a course's best record is kept under: the course kind, its constraints and its stages' chart hashes in
 * order (SHA-256 when the course names one, else MD5), like beatoraja keys course scores on the stage hashes.
 */
export function courseRecordKey(course: BrowserCourseEntry, placement: 'intended' | 'lr2' = 'intended'): string {
  const { definition } = course;
  const stages = definition.stages.map((stage) => stage.sha256 ?? stage.md5 ?? '').join(',');
  const key = `course:${definition.kind}:${[...definition.constraints].sort().join('+')}:${stages}`;
  if (definition.kind !== 'nonstop') return key;
  // A NONSTOP course's connections and placement decide the chart that is played, as in its course fingerprint.
  const connections = (definition.connections ?? []).slice(0, Math.max(0, definition.stages.length - 1));
  return `${key}:${connections.join('+')}:${placement}`;
}

/**
 * The player's best record on a course bar, read from the records under {@link courseRecordKey}, with the trophy its
 * bests earn: beatoraja's `GradeBar.getTrophy` takes the best EX score and the fewest BP (which may come from different
 * runs) over the course's notes, whether the run cleared or not. A random course bar (its stages are drawn on start)
 * and a NEW COURSE bar have no record. A NONSTOP course reads the record of the placement it would be played with.
 */
export function lookupCourseRecord(
  course: BrowserCourseEntry,
  records: { get(key: string): BeMusicSongRecord | undefined },
  placement: 'intended' | 'lr2' = 'intended',
): BeMusicCourseRecord | undefined {
  if (course.random !== undefined || course.newCourse === true) return undefined;
  const record = records.get(courseRecordKey(course, placement));
  if (record === undefined) return undefined;
  const noteCount = course.stages.reduce((sum, stage) => sum + (stage.song?.totalNotes ?? 0), 0);
  if (record.exScore === undefined || record.missCount === undefined || noteCount <= 0) return record;
  const trophy = resolveCourseTrophy(course.definition.trophies, {
    exScore: record.exScore,
    missCount: record.missCount,
    noteCount,
  });
  return trophy !== undefined ? { ...record, trophy } : record;
}

/**
 * Every stage's polylines joined into one over the whole course, as beatoraja's course result draws its graphs
 * (`CourseResult.create`): each stage takes a share of the width by its `weights` (its length), the EX score runs on
 * from the stages before it, and a stage the run never reached reads a gauge of 0 (beatoraja fills it with zeros) with
 * the EX score where the run left it.
 */
export function joinCourseStageHistories(
  stages: readonly CourseStageHistory[],
  weights: readonly number[],
): CourseStageHistory {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  const share = (index: number): number =>
    total > 0 ? Math.max(0, weights[index] ?? 0) / total : 1 / Math.max(1, weights.length);
  const gaugeHistory: GaugeHistorySample[] = [];
  const scoreHistory: ScoreHistorySample[] = [];
  let start = 0;
  let exScore = 0;
  weights.forEach((_weight, index) => {
    const width = share(index);
    const stage = stages[index];
    if (stage === undefined) {
      gaugeHistory.push({ progress: start, value: 0 }, { progress: start + width, value: 0 });
      scoreHistory.push({ progress: start, exScore }, { progress: start + width, exScore });
    } else {
      for (const sample of stage.gaugeHistory) {
        gaugeHistory.push({ progress: start + sample.progress * width, value: sample.value });
      }
      for (const sample of stage.scoreHistory) {
        scoreHistory.push({ progress: start + sample.progress * width, exScore: exScore + sample.exScore });
      }
      exScore += stage.scoreHistory.at(-1)?.exScore ?? 0;
    }
    start += width;
  });
  return { gaugeHistory, scoreHistory };
}

/**
 * The course result as the result scene shows one run: the course's summed judgments, BP, course max combo and final
 * gauge, under the course's name (the first stage's chart supplies the song images). `history` is the graph it draws:
 * LR2 shows the last stage's (its result clears the graph at each stage start, OpenLR2 L24151).
 *
 * SCORE reads on the stage results' scale: LR2's money score over the course's notes (out of 200000, as LR2 keeps a
 * course's best), else the EX score. PLAY TIME is `playSeconds` (the stages' play time, {@link CourseSession.playSeconds}),
 * else `history.playSeconds` (a NONSTOP run passes its stitched play's result). An EXPERT / GRADE course is marked
 * `courseResult` (its verdict reads COURSE CLEAR / COURSE FAILED); a NONSTOP run is one play on the result skin.
 */
export function buildCourseResultData(
  course: BrowserCourseEntry,
  result: PlaylogCourseResult,
  courseLog: BeMusicCoursePlaylog,
  history: CourseStageHistory = EMPTY_HISTORY,
  options: { playSeconds?: number } = {},
): PixiGameplayResultData {
  const first = course.stages[0]!.song!;
  const lastStage = [...courseLog.stages].reverse().find((entry) => entry.played);
  const judgeRuleset = lastStage?.played === true ? (lastStage.playlog.play.judgeRuleset ?? 'lr2') : 'lr2';
  const score =
    judgeRuleset === 'lr2'
      ? resolveLr2MoneyScore({
          total: result.noteCount,
          perfect: result.judge.pgreat,
          great: result.judge.great,
          good: result.judge.good,
        })
      : result.exScore;
  return {
    score: {
      total: result.noteCount,
      perfect: result.judge.pgreat,
      great: result.judge.great,
      good: result.judge.good,
      bad: result.judge.bad,
      poor: result.judge.poor,
      emptyPoor: result.judge.emptyPoor,
      exScore: result.exScore,
      score,
    },
    maxCombo: result.maxCombo,
    gauge: result.gauge.final,
    cleared: result.gauge.cleared,
    playSeconds: options.playSeconds ?? history.playSeconds ?? 0,
    song: {
      ...first,
      id: `course:${course.id}`,
      title: course.definition.name,
      subtitle: `${result.stagesPlayed} / ${course.stages.length} STAGES${result.trophy !== undefined ? ` · ${result.trophy}` : ''}`,
      totalNotes: result.noteCount,
    },
    gaugeHistory: [...history.gaugeHistory],
    scoreHistory: [...history.scoreHistory],
    lamp: result.lamp,
    gaugeType: result.gauge.type,
    judgeRuleset,
    fast: result.fast,
    slow: result.slow,
    ...(course.definition.kind !== 'nonstop' ? { courseResult: true } : {}),
  };
}

/**
 * The course result as a beatoraja result skin reads one run (`PlayerSummary`): the course's summed judgments, its
 * EX score (beatoraja's score) and the gauge the course ended on. beatoraja keeps the course score the same way
 * (`CourseResult` sums the stage scores).
 */
export function buildCourseResultSummary(result: PlaylogCourseResult): PlayerSummary {
  return {
    total: result.noteCount,
    perfect: result.judge.pgreat,
    great: result.judge.great,
    good: result.judge.good,
    bad: result.judge.bad,
    poor: result.judge.poor,
    emptyPoor: result.judge.emptyPoor,
    fast: result.fast,
    slow: result.slow,
    exScore: result.exScore,
    score: result.exScore,
    gauge: {
      type: result.gauge.type,
      current: result.gauge.final,
      max: 100,
      initial: 100,
      clearThreshold: 0,
      effectiveTotal: 0,
      cleared: result.gauge.cleared,
      survival: true,
    },
    course: { combo: 0, maxCombo: result.maxCombo },
  };
}
