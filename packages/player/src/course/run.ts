import type { BeMusicJSON } from '@be-music/json';
import { resolveChartRulesetFacts } from '../core/play-chart.ts';
import { createCourseReplay, type BeMusicCourseReplay, type ReplayCourseStageEntry } from '../replay/course.ts';
import type { BeMusicReplay, ReplayCourseStage, ReplayRecorderInfo } from '../replay/format.ts';
import { computeStageChartFingerprint, resolveReplayCourseInfo } from './course-replay.ts';
import type { CourseDefinition } from './definition.ts';
import { applyCourseLongNoteConstraint } from './long-note.ts';
import {
  isCourseHiSpeedLocked,
  resolveCourseStagePlaySettings,
  resolveCourseStageSettings,
  type CourseStagePlaySettings,
} from './stage-rules.ts';

/**
 * What a course run needs of a stage: its chart and the chart's path. A host passes its own entries (a song entry, a
 * chart file) that carry them, and gets them back with the chart as the course plays it.
 */
export interface CourseRunStage {
  /** The stage chart as loaded (`#RANDOM` / `#SWITCH` still in). */
  chart: BeMusicJSON;
  /** The chart's path, or only its extension: the lane-mode input (a `.pms` chart plays as 9 KEY). */
  chartPath?: string;
}

/** What a host keeps of a played stage besides its replay, such as its result graphs. */
export interface CourseRunStageExtras {
  /** The stage's play time in seconds, when known. It adds up to {@link CourseRun.playSeconds}. */
  playSeconds?: number;
}

/** The next stage of a course run: what it plays and the course settings it plays under. */
export interface CourseRunStagePlan<S extends CourseRunStage = CourseRunStage> {
  /** Zero-based stage index. */
  index: number;
  stageCount: number;
  /** The stage, its chart as the course plays it (the course's long-note constraint applied). */
  stage: S;
  /** `PlayerOptions.course` for the stage, with the state the previous stage left (`carryIn`). */
  course: ReplayCourseStage;
  /** Whether the course forbids changing the hi-speed during the stage (`no_speed`). */
  hiSpeedLocked: boolean;
}

interface PlayedStage<H> {
  replay: BeMusicReplay;
  playSeconds?: number;
  extras?: H;
}

/**
 * One run of an EXPERT or GRADE course: plays the stages in order, carrying each stage's gauge value, course combo and
 * course max combo into the next, and ends when a stage fails, when the player gives up, or after the last stage. The
 * stage replays it collects make the course replay. A NONSTOP course is played as one stitched chart instead
 * (`prepareNonstopCourse`).
 *
 * Runtime-neutral and chart-agnostic: `S` is the host's stage entry (anything with a chart, {@link CourseRunStage}) and
 * `H` what the host keeps of each played stage ({@link CourseRunStageExtras}).
 */
export class CourseRun<
  S extends CourseRunStage = CourseRunStage,
  H extends CourseRunStageExtras = CourseRunStageExtras,
> {
  readonly definition: CourseDefinition;
  /**
   * Every stage as the course plays it, in order: its chart with the course's long-note constraint applied. A played
   * stage's fingerprints describe this chart.
   */
  readonly stages: readonly S[];
  private readonly played: PlayedStage<H>[] = [];
  private ended = false;

  /** Throws when a stage has no chart: a course with a missing stage cannot be started. */
  constructor(definition: CourseDefinition, stages: ReadonlyArray<S | undefined>) {
    const missing = stages.findIndex((stage) => stage === undefined);
    if (missing >= 0) {
      throw new Error(`course "${definition.name}" has no chart for stage ${missing + 1}`);
    }
    this.definition = definition;
    this.stages = (stages as readonly S[]).map((stage) => {
      const chart = applyCourseLongNoteConstraint(stage.chart, definition.constraints);
      return chart === stage.chart ? stage : { ...stage, chart };
    });
  }

  get stageCount(): number {
    return this.stages.length;
  }

  /** Stages played so far, the one given up included. */
  get stagesPlayed(): number {
    return this.played.length;
  }

  /** True once a stage failed, the player gave up or the last stage was played. */
  get finished(): boolean {
    return this.ended;
  }

  /** The next stage to play, or `undefined` when the run is over. */
  nextStage(): CourseRunStagePlan<S> | undefined {
    const index = this.played.length;
    if (this.ended || index >= this.stages.length) return undefined;
    const course: ReplayCourseStage = resolveCourseStageSettings(this.definition);
    const previous = this.played.at(-1)?.replay.results?.native;
    if (previous !== undefined) {
      course.carryIn = {
        gauge: previous.gauge.final,
        combo: previous.course?.combo ?? 0,
        maxCombo: previous.course?.maxCombo ?? previous.maxCombo,
      };
    }
    return {
      index,
      stageCount: this.stages.length,
      stage: this.stages[index]!,
      course,
      hiSpeedLocked: isCourseHiSpeedLocked(this.definition.constraints),
    };
  }

  /** The settings a stage plays with in place of the player's picks ({@link resolveCourseStagePlaySettings}). */
  playSettings<T extends CourseStagePlaySettings>(picked: T): T {
    return resolveCourseStagePlaySettings(this.definition, picked);
  }

  /**
   * Records a finished stage's replay, with what the host keeps of it (`extras`). Returns whether the run goes on: it
   * ends when the stage's gauge emptied, when it was the last stage, or when the stage left no replay with a result
   * (nothing to carry on from).
   */
  recordStage(replay: BeMusicReplay | undefined, extras?: H): 'next' | 'finished' {
    if (this.ended) return 'finished';
    const goesOn = this.goesOnAfter(replay);
    if (replay?.results?.native !== undefined) {
      this.played.push({
        replay,
        ...(extras?.playSeconds !== undefined ? { playSeconds: extras.playSeconds } : {}),
        ...(extras !== undefined ? { extras } : {}),
      });
    }
    if (!goesOn) {
      this.ended = true;
      return 'finished';
    }
    return 'next';
  }

  /** Whether the run would go on after recording `replay` as the next stage ({@link recordStage} returning `next`). */
  goesOnAfter(replay: BeMusicReplay | undefined): boolean {
    if (this.ended) return false;
    const native = replay?.results?.native;
    if (native === undefined) return false;
    const failed = native.gauge.failedMidPlay === true || native.gauge.final <= 0;
    return !failed && this.played.length + 1 < this.stages.length;
  }

  /**
   * Records the stage the player gave up with ESC (its replay is marked `play.aborted`) and ends the run: a run given
   * up is a failed run, as LR2 records it. Its play time runs up to where it was left ({@link resolveGivenUpPlaySeconds}).
   * A stage without a replay just ends the run.
   */
  giveUp(replay: BeMusicReplay | undefined): void {
    if (this.ended) return;
    if (replay?.results?.native !== undefined) {
      const playSeconds = resolveGivenUpPlaySeconds(replay);
      this.played.push({ replay, ...(playSeconds !== undefined ? { playSeconds } : {}) });
    }
    this.ended = true;
  }

  /** The play time of every stage played, in seconds: what a course result shows as its PLAY TIME. */
  get playSeconds(): number {
    return this.played.reduce((sum, stage) => sum + Math.max(0, stage.playSeconds ?? 0), 0);
  }

  /** What the host kept of each stage played, in order (`undefined` for a stage given up or recorded without it). */
  get stageExtras(): ReadonlyArray<H | undefined> {
    return this.played.map((stage) => stage.extras);
  }

  /**
   * The course replay: the stages played, then every stage the run never reached, with its chart facts
   * (`resolveChartRulesetFacts`), its file hashes from the course definition and its chart fingerprint (which keys the
   * course on the Leaderboard), all read from the chart as the course plays it.
   */
  buildReplay(options: { createdAt?: string; recorder?: ReplayRecorderInfo } = {}): BeMusicCourseReplay {
    const stages = this.stages.map((stage, index): ReplayCourseStageEntry => {
      const replay = this.played[index]?.replay;
      if (replay !== undefined) return { played: true, replay };
      const ref = this.definition.stages[index];
      const chartFingerprint = computeStageChartFingerprint(stage.chart, stage.chartPath);
      return {
        played: false,
        facts: resolveChartRulesetFacts(stage.chart, { laneModeExtension: stage.chartPath }),
        ...(ref?.sha256 !== undefined ? { sha256: ref.sha256 } : {}),
        ...(ref?.md5 !== undefined ? { md5: ref.md5 } : {}),
        ...(chartFingerprint !== undefined ? { chartFingerprint } : {}),
      };
    });
    return createCourseReplay({
      course: resolveReplayCourseInfo(this.definition),
      stages,
      ...(options.createdAt !== undefined ? { createdAt: options.createdAt } : {}),
      ...(options.recorder !== undefined ? { recorder: options.recorder } : {}),
    });
  }
}

/**
 * The play time of a stage given up with ESC: up to where the engine stopped it (`play.abortedAtUs`), or, for a stage
 * left after its chart had settled (every note judged, the play complete), up to its last note. `undefined` when the log
 * says neither.
 */
export function resolveGivenUpPlaySeconds(replay: Partial<Pick<BeMusicReplay, 'play' | 'chart'>>): number | undefined {
  const abortedAtUs = replay.play?.abortedAtUs;
  if (abortedAtUs !== undefined) return Math.max(0, abortedAtUs) / 1e6;
  if (replay.play?.aborted === true) return undefined;
  let lastUs: number | undefined;
  for (const note of replay.chart?.notes ?? []) {
    const endUs = note.endTimeUs ?? note.timeUs;
    if (lastUs === undefined || endUs > lastUs) lastUs = endUs;
  }
  return lastUs !== undefined ? Math.max(0, lastUs) / 1e6 : undefined;
}
