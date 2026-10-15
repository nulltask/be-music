import type { PlayerSummary } from '@be-music/player/core/engine';
import {
  createCoursePlaylog,
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
  resolveCourseLaneOption,
  resolveCourseStageSettings,
  type CourseLaneOption,
} from '@be-music/player-web/collection';
import type { BrowserCourseEntry, BrowserSongEntry } from '@be-music/player-web/collection';

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
    const stage = this.course.stages[index]!;
    const song = stage.song!;
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
    const chart = applyCourseLongNoteConstraint(song.chart, constraints);
    return {
      index,
      stageCount: this.course.stages.length,
      song: chart === song.chart ? song : { ...song, chart },
      course,
      courseInfo: resolveSceneCourseInfo(this.course, index),
      hiSpeedLocked: isCourseHiSpeedLocked(constraints),
    };
  }

  /** The lane option the course lets a stage play with, in place of the player's pick. */
  laneOption(picked: CourseLaneOption): CourseLaneOption {
    return resolveCourseLaneOption(this.course.definition.constraints, picked);
  }

  /**
   * Records a finished stage's play log. Returns whether the course goes on: it ends when the stage's gauge emptied,
   * when it was the last stage, or when the stage left no play log (nothing to carry on from).
   */
  recordStage(playlog: BeMusicPlaylog | undefined): 'next' | 'finished' {
    if (this.ended) return 'finished';
    const native = playlog?.results?.native;
    if (playlog === undefined || native === undefined) {
      this.ended = true;
      return 'finished';
    }
    this.logs.push(playlog);
    const failed = native.gauge.failedMidPlay === true || native.gauge.final <= 0;
    if (failed || this.logs.length >= this.course.stages.length) {
      this.ended = true;
      return 'finished';
    }
    return 'next';
  }

  /**
   * The course play log: the stages played, then the facts of every stage the run never reached (`factsOf` resolves a
   * stage chart's ruleset facts, e.g. `resolveChartRulesetFacts`).
   */
  buildPlaylog(
    factsOf: (song: BrowserSongEntry) => RulesetChartFacts,
    options: { createdAt?: string; recorder?: BeMusicPlaylog['recorder'] } = {},
  ): BeMusicCoursePlaylog {
    const { definition } = this.course;
    const stages: PlaylogCourseStageEntry[] = this.course.stages.map((stage, index) => {
      const playlog = this.logs[index];
      if (playlog !== undefined) return { played: true, playlog };
      const ref = definition.stages[index];
      return {
        played: false,
        facts: factsOf(stage.song!),
        ...(ref?.sha256 !== undefined ? { sha256: ref.sha256 } : {}),
        ...(ref?.md5 !== undefined ? { md5: ref.md5 } : {}),
      };
    });
    return createCoursePlaylog({
      course: {
        name: definition.name,
        kind: definition.kind,
        constraints: [...definition.constraints],
        trophies: definition.trophies.map((trophy) => ({ ...trophy })),
      },
      stages,
      ...(options.createdAt !== undefined ? { createdAt: options.createdAt } : {}),
      ...(options.recorder !== undefined ? { recorder: options.recorder } : {}),
    });
  }
}

/**
 * The key a course's best record is kept under: the course kind, its constraints and its stages' chart hashes in
 * order (SHA-256 when the course names one, else MD5), like beatoraja keys course scores on the stage hashes.
 */
export function courseRecordKey(course: BrowserCourseEntry): string {
  const { definition } = course;
  const stages = definition.stages.map((stage) => stage.sha256 ?? stage.md5 ?? '').join(',');
  return `course:${definition.kind}:${[...definition.constraints].sort().join('+')}:${stages}`;
}

/**
 * The course result as the result scene shows one run: the course's summed judgments, BP, course max combo and final
 * gauge, under the course's name (the first stage's chart supplies the song images).
 */
export function buildCourseResultData(
  course: BrowserCourseEntry,
  result: PlaylogCourseResult,
  courseLog: BeMusicCoursePlaylog,
): PixiGameplayResultData {
  const first = course.stages[0]!.song!;
  const lastStage = [...courseLog.stages].reverse().find((entry) => entry.played);
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
      score: result.exScore,
    },
    maxCombo: result.maxCombo,
    gauge: result.gauge.final,
    cleared: result.gauge.cleared,
    playSeconds: 0,
    song: {
      ...first,
      id: `course:${course.id}`,
      title: course.definition.name,
      subtitle: `${result.stagesPlayed} / ${course.stages.length} STAGES${result.trophy !== undefined ? ` · ${result.trophy}` : ''}`,
      totalNotes: result.noteCount,
    },
    gaugeHistory: [],
    scoreHistory: [],
    lamp: result.lamp,
    gaugeType: result.gauge.type,
    judgeRuleset: lastStage?.played === true ? (lastStage.playlog.play.judgeRuleset ?? 'lr2') : 'lr2',
    fast: result.fast,
    slow: result.slow,
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
