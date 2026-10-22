import type { GaugeType } from '../ruleset/gauge-type.ts';
import { resolveIIDXRankLabel } from '../ruleset/score.ts';
import type { RulesetChartFacts } from '../ruleset/facts.ts';
import { resolveRuleset, type RulesetId } from '../ruleset/index.ts';
import { CLEAR_LAMPS, resolveCourseClearLamp, resolveMissCount, type ClearLamp } from '../ruleset/clear-lamp.ts';
import { resolveCourseGauge, resolveCourseGaugeId, type RulesetCourseKind } from '../ruleset/course.ts';
import {
  BE_MUSIC_REPLAY_VERSION,
  parseReplay,
  type BeMusicReplay,
  type ReplayCourseStage,
  type ReplayJudgmentCounts,
  type ReplayRecorderInfo,
  type ReplayRulesetResult,
} from './format.ts';
import {
  expectFiniteNumber,
  expectRecord,
  expectString,
  optionalString,
  parseRandomDraws,
  parseRecorder,
  parseResults,
  ReplayParseError,
} from './parse.ts';
import { courseStageRulesetOptions, resolveRulesetConfig } from './rulesets.ts';
import { simulateReplay, type SimulateReplayOptions } from './simulate.ts';
import type { ReplayNonstopRun } from './nonstop.ts';
import { LR2_NONSTOP_CONNECTIONS } from '../course/lr2crs.ts';

/**
 * A course replay: one file for a whole course run, holding each stage's own replay in order. Every stage log is
 * complete on its own (its `play.course` carries the course kind, constraints and the state carried in), so a stage
 * can be extracted and replayed or re-simulated as a single-chart log. Stages the run never reached (after a failed
 * stage) are listed with their chart facts only, so the course result can still count their notes.
 */
export const BE_MUSIC_COURSE_REPLAY_FORMAT = 'be-music-course-replay';
export const COURSE_REPLAY_FILE_SUFFIX = '.bmcourse.json';

export interface BeMusicCourseReplay {
  format: typeof BE_MUSIC_COURSE_REPLAY_FORMAT;
  /** Shares the replay revision: course logs change together with the stage logs they hold. */
  version: number;
  createdAt?: string;
  recorder?: ReplayRecorderInfo;
  course: ReplayCourseInfo;
  /** One entry per course stage, in order. For a NONSTOP run, the reached stages cut out of {@link nonstop}. */
  stages: ReplayCourseStageEntry[];
  /** A NONSTOP run: the stitched play that was judged. The course result comes from it. */
  nonstop?: ReplayNonstopRun;
  /** Regenerable cache: the course result per ruleset id, plus `native` (the engine's own). */
  results?: Record<string, ReplayCourseResult>;
}

/** What the course was: enough to identify it and to compute its trophy. */
export interface ReplayCourseInfo {
  name: string;
  kind: RulesetCourseKind;
  /** The course's constraints, by their table-header names (`grade_mirror`, `gauge_lr2`, ...). */
  constraints: string[];
  trophies: Array<{ name: string; missRate: number; scoreRate: number }>;
  /**
   * `false` for a course whose runs must not be ranked: beatoraja's `release: false`, which also marks a drawn random
   * course. Absent = released.
   */
  release?: false;
}

export type ReplayCourseStageEntry =
  | { played: true; replay: BeMusicReplay }
  | {
      played: false;
      /** The stage chart's file hashes, when known. */
      sha256?: string;
      md5?: string;
      /**
       * The stage chart's Be-Music chart fingerprint (`bmfp0:…`), as a played stage's `chart.chartFingerprint` would
       * be: it keys the course on the Leaderboard (`computeCourseReplayFingerprint`). Absent in logs from before it was
       * recorded.
       */
      chartFingerprint?: string;
      /** The facts a ruleset needs to count the stage's notes. */
      facts: RulesetChartFacts;
    };

/** The lamps a course run earns: every `ClearLamp` but NO PLAY and ASSIST EASY (no course gauge is an assist gauge). */
export type CourseClearLamp = Exclude<ClearLamp, 'NO_PLAY' | 'ASSIST_EASY'>;

export interface ReplayCourseResult {
  ruleset: string;
  /** Judgments summed over the stages played. */
  judge: ReplayJudgmentCounts;
  fast: number;
  slow: number;
  exScore: number;
  /** Judgment notes over every stage of the course, reached or not. */
  noteCount: number;
  /** BP: BADs, POORs and empty POORs, plus every note the run never judged (failed or unreached stages). */
  missCount: number;
  /** The course-wide max combo. */
  maxCombo: number;
  /** Mine POORs included in judge.poor, not consumed judgment notes. */
  minePoor?: number;
  djLevel: string;
  /** The gauge the course ended on. */
  gauge: { type: string; final: number; cleared: boolean };
  /** The number of stages the run reached. */
  stagesPlayed: number;
  lamp: CourseClearLamp;
  /** The best trophy the run earned, by name. */
  trophy?: string;
  /** Each played stage's own result, in order. */
  stages: ReplayRulesetResult[];
}

/**
 * The lamp of a course run, by the course clear-lamp rule (`resolveCourseClearLamp`): FAILED when a stage ended with its
 * gauge empty or a stage was never reached; FULL COMBO, PERFECT or MAX when the course max combo covers every note;
 * otherwise the gauge's lamp, LR2's by the player's gauge `pick` and beatoraja's by the class gauge.
 */
export function resolveCourseLamp(
  ruleset: string,
  result: Pick<ReplayCourseResult, 'judge' | 'noteCount' | 'maxCombo' | 'gauge'>,
  pick: GaugeType,
): CourseClearLamp {
  return resolveCourseClearLamp({
    ruleset,
    cleared: result.gauge.cleared,
    gauge: result.gauge.type,
    gaugeType: pick,
    noteCount: result.noteCount,
    maxCombo: result.maxCombo,
    judge: result.judge,
  }) as CourseClearLamp;
}

/** The gauge a course stage starts on (see {@link resolveCourseStageStartGauge}). */
export interface CourseStageStartGauge {
  /** The ruleset's course gauge id (`GRADE`, `COURSE-EASY`, `CLASS`, …), as the engine reports it. */
  type: string;
  /** The value the stage starts from: the gauge carried in, or the gauge's start (100) on the first stage. */
  initial: number;
  max: number;
  /** The clear border (0: a course gauge clears unless it empties). */
  border: number;
  survival: boolean;
}

/**
 * The gauge a course stage starts on, before the engine has run a frame: its course gauge id and the value carried in
 * from the previous stage. A host shows it during the stage's READY phase and seeds the result graph with it, so
 * neither starts on the single-chart gauge. The judging values, which depend on the chart, are left out.
 */
export function resolveCourseStageStartGauge(
  rulesetId: RulesetId,
  course: ReplayCourseStage,
  selectedGauge: string,
): CourseStageStartGauge {
  const gaugeId = resolveCourseGaugeId(rulesetId, course.kind, selectedGauge);
  // The lane mode and the HARD damage multiplier only pick the judging values, which this leaves out.
  const spec = resolveCourseGauge(rulesetId, gaugeId, courseStageRulesetOptions(course), '7', 1);
  return { type: spec.id, initial: spec.initial, max: spec.max, border: spec.border, survival: spec.survival };
}

/**
 * The trophy a course result earns (beatoraja `GradeBar.getTrophy`): the last trophy whose `missRate` is at least the
 * BP rate (`missCount × 100 / notes`) and whose `scoreRate` is at most the score rate (`exScore × 100 / (2 × notes)`).
 * Trophies are listed easiest first, so the last one that qualifies is the best.
 */
export function resolveCourseTrophy(
  trophies: ReplayCourseInfo['trophies'],
  result: Pick<ReplayCourseResult, 'missCount' | 'exScore' | 'noteCount'>,
): string | undefined {
  if (result.noteCount <= 0) return undefined;
  const missRate = (result.missCount * 100) / result.noteCount;
  const scoreRate = (result.exScore * 100) / (2 * result.noteCount);
  let earned: string | undefined;
  for (const trophy of trophies) {
    if (trophy.missRate >= missRate && trophy.scoreRate <= scoreRate) earned = trophy.name;
  }
  return earned;
}

/**
 * Sums a course run from its stage results: judgments, fast / slow and EX-SCORE over the stages played; notes over every
 * stage (`stageNoteCounts`, reached or not); BP with every note the run never judged; the course max combo and the gauge
 * from the last stage played. The run is cleared when every stage was reached and the last one cleared.
 */
export function aggregateCourseResult(
  ruleset: string,
  course: ReplayCourseInfo,
  stageResults: readonly ReplayRulesetResult[],
  stageNoteCounts: readonly number[],
  pick: GaugeType,
): ReplayCourseResult {
  const judge: ReplayJudgmentCounts = { pgreat: 0, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 0 };
  let fast = 0;
  let slow = 0;
  let exScore = 0;
  let judged = 0;
  let minePoor = 0;
  for (const stage of stageResults) {
    for (const key of Object.keys(judge) as Array<keyof ReplayJudgmentCounts>) judge[key] += stage.judge[key];
    fast += stage.fast;
    slow += stage.slow;
    exScore += stage.exScore;
    minePoor += stage.minePoor ?? 0;
    judged +=
      stage.judge.pgreat +
      stage.judge.great +
      stage.judge.good +
      stage.judge.bad +
      stage.judge.poor -
      (stage.minePoor ?? 0);
  }
  const noteCount = stageNoteCounts.reduce((sum, count) => sum + count, 0);
  const last = stageResults.at(-1);
  const reachedAll = stageResults.length === stageNoteCounts.length;
  const gauge = {
    type: last?.gauge.type ?? '',
    final: last?.gauge.final ?? 0,
    cleared: reachedAll && last !== undefined && last.gauge.cleared,
  };
  const partial = {
    judge,
    noteCount,
    maxCombo: last?.course?.maxCombo ?? last?.maxCombo ?? 0,
    gauge,
  };
  const missCount = resolveMissCount(judge, noteCount - judged);
  const result: ReplayCourseResult = {
    ruleset,
    judge,
    fast,
    slow,
    exScore,
    noteCount,
    missCount,
    maxCombo: partial.maxCombo,
    ...(minePoor > 0 ? { minePoor } : {}),
    djLevel: resolveIIDXRankLabel(exScore, noteCount),
    gauge,
    stagesPlayed: stageResults.length,
    lamp: resolveCourseLamp(ruleset.split('/')[0]!, partial, pick),
    stages: [...stageResults],
  };
  const trophy = gauge.cleared ? resolveCourseTrophy(course.trophies, result) : undefined;
  if (trophy !== undefined) result.trophy = trophy;
  return result;
}

/**
 * A stage the player gave up (ESC, `play.aborted`) did not clear, whatever its gauge stood at: a course given up is
 * recorded as a failed run, as LR2 does.
 */
function givenUpResult(stageLog: BeMusicReplay, result: ReplayRulesetResult): ReplayRulesetResult {
  return stageLog.play.aborted === true && result.gauge.cleared
    ? { ...result, gauge: { ...result.gauge, cleared: false } }
    : result;
}

/** The gauge a stage hands on: a stage that ended with its survival gauge empty ends the course. */
function stageFailed(result: ReplayRulesetResult): boolean {
  return result.gauge.failedMidPlay === true || result.gauge.final <= 0;
}

/** The judgment notes one stage counts under a ruleset, from a stage log or from an unreached stage's facts. */
function stageNoteCount(entry: ReplayCourseStageEntry, rulesetId: RulesetId): number {
  return entry.played
    ? resolveRulesetConfig(entry.replay, rulesetId).noteCount
    : resolveRuleset(entry.facts, rulesetId).noteCount;
}

/**
 * Re-simulates a whole course under one ruleset. Each stage after the first starts from the state the SIMULATED
 * previous stage left (its gauge value and course combo replace the recorded carry-in), so the result never trusts the
 * recording; the course stops at the first stage whose gauge emptied, as the live run did.
 */
export function simulateCourseReplay(
  courseLog: BeMusicCourseReplay,
  options: Omit<SimulateReplayOptions, 'course'>,
): ReplayCourseResult {
  if (courseLog.nonstop !== undefined) {
    const stageResults = courseLog.stages.flatMap((entry) =>
      entry.played ? [simulateReplay(entry.replay, options)] : [],
    );
    return nonstopCourseResult(courseLog, simulateReplay(courseLog.nonstop.replay, options), stageResults);
  }
  const stageResults: ReplayRulesetResult[] = [];
  let pick: GaugeType = 'GROOVE';
  let previous: ReplayRulesetResult | undefined;
  for (const entry of courseLog.stages) {
    if (!entry.played || (previous !== undefined && stageFailed(previous))) break;
    const stageLog = structuredClone(entry.replay);
    pick = stageLog.play.gauge;
    const course = stageLog.play.course ?? { kind: courseLog.course.kind };
    if (previous === undefined) {
      delete course.carryIn;
    } else {
      course.carryIn = {
        gauge: previous.gauge.final,
        combo: previous.course?.combo ?? 0,
        maxCombo: previous.course?.maxCombo ?? previous.maxCombo,
      };
    }
    stageLog.play.course = course;
    previous = givenUpResult(stageLog, simulateReplay(stageLog, options));
    stageResults.push(previous);
  }
  const stageNoteCounts = courseLog.stages.map((entry, index) =>
    index < stageResults.length ? stageResults[index]!.noteCount : stageNoteCount(entry, options.ruleset),
  );
  return aggregateCourseResult(
    stageResults[0]?.ruleset ?? options.ruleset,
    courseLog.course,
    stageResults,
    stageNoteCounts,
    pick,
  );
}

/**
 * A NONSTOP course result: the stitched play's own judgments, gauge and max combo (it was one play), BP with every note
 * it never judged, and the cut-out stages' results listed alongside.
 */
function nonstopCourseResult(
  courseLog: BeMusicCourseReplay,
  run: ReplayRulesetResult,
  stageResults: readonly ReplayRulesetResult[],
): ReplayCourseResult {
  const { judge, noteCount } = run;
  const judged = judge.pgreat + judge.great + judge.good + judge.bad + judge.poor - (run.minePoor ?? 0);
  // A NONSTOP play given up with ESC is a failed run.
  const gauge = {
    type: run.gauge.type,
    final: run.gauge.final,
    cleared: run.gauge.cleared && courseLog.nonstop?.replay.play.aborted !== true,
  };
  const result: ReplayCourseResult = {
    ruleset: run.ruleset,
    judge: { ...judge },
    fast: run.fast,
    slow: run.slow,
    exScore: run.exScore,
    noteCount,
    missCount: resolveMissCount(judge, noteCount - judged),
    maxCombo: run.maxCombo,
    ...(run.minePoor !== undefined ? { minePoor: run.minePoor } : {}),
    djLevel: resolveIIDXRankLabel(run.exScore, noteCount),
    gauge,
    stagesPlayed: courseLog.stages.filter((entry) => entry.played).length,
    lamp: resolveCourseLamp(
      run.ruleset.split('/')[0]!,
      { judge, noteCount, maxCombo: run.maxCombo, gauge },
      courseLog.nonstop!.replay.play.gauge,
    ),
    stages: [...stageResults],
  };
  const trophy = gauge.cleared ? resolveCourseTrophy(courseLog.course.trophies, result) : undefined;
  if (trophy !== undefined) result.trophy = trophy;
  return result;
}

/** A course stage's own replay, ready to replay or re-simulate as a single-chart log. `undefined` for an unreached stage. */
export function extractCourseStage(courseLog: BeMusicCourseReplay, index: number): BeMusicReplay | undefined {
  const entry = courseLog.stages[index];
  return entry?.played === true ? structuredClone(entry.replay) : undefined;
}

/**
 * Assembles a course replay from the stages a host played (their own replays, in order) and the facts of the
 * stages it never reached. The native course result is aggregated from the stage logs' native results and lamped under
 * the judge ruleset the stages were played on.
 */
export function createCourseReplay(options: {
  course: ReplayCourseInfo;
  stages: readonly ReplayCourseStageEntry[];
  recorder?: ReplayRecorderInfo;
  createdAt?: string;
  /** A NONSTOP run's stitched play; `stages` then hold its cut-out stages (`splitNonstopReplay`). */
  nonstop?: ReplayNonstopRun;
}): BeMusicCourseReplay {
  const log: BeMusicCourseReplay = {
    format: BE_MUSIC_COURSE_REPLAY_FORMAT,
    version: BE_MUSIC_REPLAY_VERSION,
    course: structuredClone(options.course),
    stages: options.stages.map((entry) => structuredClone(entry)),
  };
  if (options.createdAt !== undefined) log.createdAt = options.createdAt;
  if (options.recorder !== undefined) log.recorder = { ...options.recorder };
  if (options.nonstop !== undefined) {
    log.nonstop = structuredClone(options.nonstop);
    const native = options.nonstop.replay.results?.native;
    if (native !== undefined) {
      const stageNative = options.stages.flatMap((entry) =>
        entry.played && entry.replay.results?.native !== undefined ? [entry.replay.results.native] : [],
      );
      const result = nonstopCourseResult(log, native, stageNative);
      // The engine judged the run under its judge ruleset: lamp it by that ruleset's lamps, as a re-simulation does.
      const judgeRuleset = options.nonstop.replay.play.judgeRuleset ?? 'lr2';
      const lamp = resolveCourseLamp(judgeRuleset, result, options.nonstop.replay.play.gauge);
      log.results = { native: { ...result, lamp } };
    }
    return log;
  }
  const played = options.stages.filter((entry) => entry.played);
  const native = played.map((entry) => {
    const result = entry.replay.results?.native;
    return result !== undefined ? givenUpResult(entry.replay, result) : undefined;
  });
  if (played.length > 0 && native.every((result) => result !== undefined)) {
    const ruleset = played[0]!.replay.play.judgeRuleset ?? 'lr2';
    const noteCounts = options.stages.map((entry, index) =>
      index < native.length ? native[index]!.noteCount : stageNoteCount(entry, ruleset),
    );
    const pick = played.at(-1)!.replay.play.gauge;
    const result = aggregateCourseResult(
      native[0]!.ruleset,
      options.course,
      native as ReplayRulesetResult[],
      noteCounts,
      pick,
    );
    // The engine judged the run under its judge ruleset: lamp it by that ruleset's lamps, as a re-simulation does.
    log.results = { native: { ...result, lamp: resolveCourseLamp(ruleset, result, pick) } };
  }
  return log;
}

export function serializeCourseReplay(courseLog: BeMusicCourseReplay): string {
  return JSON.stringify(courseLog);
}

/**
 * Suggested filename for a course replay: `<course name>-<timestamp>.bmcourse.json`, with filesystem-hostile
 * characters stripped. `when` defaults to the log's own `createdAt`.
 */
export function resolveCourseReplayFilename(courseLog: BeMusicCourseReplay, when?: Date): string {
  const stem =
    courseLog.course.name
      .normalize('NFKC')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'course';
  const source = when ?? (courseLog.createdAt !== undefined ? new Date(courseLog.createdAt) : undefined);
  const timestamp =
    source !== undefined && Number.isFinite(source.getTime())
      ? source.toISOString().replace(/[:.]/g, '-')
      : 'unknown-time';
  return `${stem}-${timestamp}${COURSE_REPLAY_FILE_SUFFIX}`;
}

const COURSE_KINDS: ReadonlySet<string> = new Set(['grade', 'expert', 'nonstop']);
/** The lamps a course run can earn ({@link CourseClearLamp}). */
const COURSE_LAMPS: ReadonlySet<string> = new Set(
  CLEAR_LAMPS.filter((lamp) => lamp !== 'NO_PLAY' && lamp !== 'ASSIST_EASY'),
);

function parseJudgeRankFacts(judgeRank: Record<string, unknown>, path: string): RulesetChartFacts['judgeRank'] {
  const parsed: RulesetChartFacts['judgeRank'] = { percent: expectFiniteNumber(judgeRank.percent, `${path}.percent`) };
  if (judgeRank.sourceRank !== undefined)
    parsed.sourceRank = expectFiniteNumber(judgeRank.sourceRank, `${path}.sourceRank`);
  if (judgeRank.sourceExRank !== undefined) {
    parsed.sourceExRank = expectFiniteNumber(judgeRank.sourceExRank, `${path}.sourceExRank`);
  }
  if (judgeRank.timeline !== undefined) {
    if (!Array.isArray(judgeRank.timeline)) throw new ReplayParseError(`${path}.timeline: expected an array`);
    parsed.timeline = judgeRank.timeline.map((raw, index) => {
      const change = expectRecord(raw, `${path}.timeline[${index}]`);
      return {
        timeUs: expectFiniteNumber(change.timeUs, `${path}.timeline[${index}].timeUs`),
        exRankValue: expectFiniteNumber(change.exRankValue, `${path}.timeline[${index}].exRankValue`),
      };
    });
  }
  return parsed;
}

function parseFacts(value: unknown, path: string): RulesetChartFacts {
  const facts = expectRecord(value, path);
  if (facts.sourceFormat !== 'bms' && facts.sourceFormat !== 'bmson') {
    throw new ReplayParseError(`${path}.sourceFormat: expected 'bms' | 'bmson'`);
  }
  const lnMode = facts.lnMode;
  if (lnMode !== 1 && lnMode !== 2 && lnMode !== 3) {
    throw new ReplayParseError(`${path}.lnMode: expected 1 | 2 | 3`);
  }
  const judgeRank = expectRecord(facts.judgeRank, `${path}.judgeRank`);
  const notes = expectRecord(facts.notes, `${path}.notes`);
  const long = expectRecord(notes.long, `${path}.notes.long`);
  const parsed: RulesetChartFacts = {
    sourceFormat: facts.sourceFormat,
    laneMode: expectString(facts.laneMode, `${path}.laneMode`),
    lnMode,
    judgeRank: parseJudgeRankFacts(judgeRank, `${path}.judgeRank`),
    notes: {
      normal: expectFiniteNumber(notes.normal, `${path}.notes.normal`),
      long: {
        1: expectFiniteNumber(long[1], `${path}.notes.long.1`),
        2: expectFiniteNumber(long[2], `${path}.notes.long.2`),
        3: expectFiniteNumber(long[3], `${path}.notes.long.3`),
      },
    },
  };
  if (facts.total !== undefined) parsed.total = expectFiniteNumber(facts.total, `${path}.total`);
  return parsed;
}

/**
 * Parses (and validates) a course replay, JSON text or an already-parsed value. Each played stage goes through
 * `parseReplay`; errors name the stage (`stages[1].replay: ...`).
 */
export function parseCourseReplay(source: unknown): BeMusicCourseReplay {
  let value: unknown = source;
  if (typeof source === 'string') {
    try {
      value = JSON.parse(source);
    } catch (error) {
      throw new ReplayParseError(`invalid JSON: ${(error as Error).message}`);
    }
  }
  const root = expectRecord(value, 'course replay');
  if (root.format !== BE_MUSIC_COURSE_REPLAY_FORMAT) {
    throw new ReplayParseError(
      `format: expected '${BE_MUSIC_COURSE_REPLAY_FORMAT}', got ${JSON.stringify(root.format)}`,
    );
  }
  if (root.version !== BE_MUSIC_REPLAY_VERSION) {
    throw new ReplayParseError(`version: unsupported version ${JSON.stringify(root.version)}`);
  }
  const course = expectRecord(root.course, 'course');
  if (typeof course.kind !== 'string' || !COURSE_KINDS.has(course.kind)) {
    throw new ReplayParseError(`course.kind: expected 'grade' | 'expert' | 'nonstop'`);
  }
  if (!Array.isArray(course.constraints) || !course.constraints.every((name) => typeof name === 'string')) {
    throw new ReplayParseError('course.constraints: expected an array of strings');
  }
  if (!Array.isArray(course.trophies)) {
    throw new ReplayParseError('course.trophies: expected an array');
  }
  const info: ReplayCourseInfo = {
    name: expectString(course.name, 'course.name'),
    kind: course.kind as RulesetCourseKind,
    constraints: [...(course.constraints as string[])],
    trophies: course.trophies.map((raw, index) => {
      const trophy = expectRecord(raw, `course.trophies[${index}]`);
      return {
        name: expectString(trophy.name, `course.trophies[${index}].name`),
        missRate: expectFiniteNumber(trophy.missRate, `course.trophies[${index}].missRate`),
        scoreRate: expectFiniteNumber(trophy.scoreRate, `course.trophies[${index}].scoreRate`),
      };
    }),
  };
  if (course.release !== undefined) {
    if (typeof course.release !== 'boolean') throw new ReplayParseError('course.release: expected a boolean');
    if (!course.release) info.release = false;
  }
  if (!Array.isArray(root.stages) || root.stages.length === 0) {
    throw new ReplayParseError('stages: expected a non-empty array');
  }
  const stages = root.stages.map((raw, index): ReplayCourseStageEntry => {
    const path = `stages[${index}]`;
    const entry = expectRecord(raw, path);
    if (entry.played === true) {
      try {
        return { played: true, replay: parseReplay(entry.replay) };
      } catch (error) {
        if (error instanceof ReplayParseError) throw new ReplayParseError(`${path}.replay: ${error.message}`);
        throw error;
      }
    }
    if (entry.played !== false) {
      throw new ReplayParseError(`${path}.played: expected a boolean`);
    }
    const unreached: ReplayCourseStageEntry = { played: false, facts: parseFacts(entry.facts, `${path}.facts`) };
    const sha256 = optionalString(entry.sha256, `${path}.sha256`);
    const md5 = optionalString(entry.md5, `${path}.md5`);
    const chartFingerprint = optionalString(entry.chartFingerprint, `${path}.chartFingerprint`);
    if (sha256 !== undefined) unreached.sha256 = sha256;
    if (md5 !== undefined) unreached.md5 = md5;
    if (chartFingerprint !== undefined) unreached.chartFingerprint = chartFingerprint;
    return unreached;
  });
  const parsed: BeMusicCourseReplay = {
    format: BE_MUSIC_COURSE_REPLAY_FORMAT,
    version: BE_MUSIC_REPLAY_VERSION,
    course: info,
    stages,
  };
  const createdAt = optionalString(root.createdAt, 'createdAt');
  if (createdAt !== undefined) parsed.createdAt = createdAt;
  if (root.nonstop !== undefined) parsed.nonstop = parseNonstopRun(expectRecord(root.nonstop, 'nonstop'));
  if (root.recorder !== undefined) parsed.recorder = parseRecorder(expectRecord(root.recorder, 'recorder'));
  if (root.results !== undefined) {
    parsed.results = parseCourseResults(expectRecord(root.results, 'results'));
  }
  return parsed;
}

const NONSTOP_CONNECTIONS: ReadonlySet<string> = new Set(LR2_NONSTOP_CONNECTIONS);

function parseNonstopRun(run: Record<string, unknown>): ReplayNonstopRun {
  if (!Array.isArray(run.connections) || !run.connections.every((value) => NONSTOP_CONNECTIONS.has(value as string))) {
    throw new ReplayParseError('nonstop.connections: expected an array of NONSTOP connections');
  }
  if (run.placement !== 'intended' && run.placement !== 'lr2') {
    throw new ReplayParseError(`nonstop.placement: expected 'intended' | 'lr2'`);
  }
  if (run.stitch !== undefined && !(Number.isInteger(run.stitch) && (run.stitch as number) >= 1)) {
    throw new ReplayParseError('nonstop.stitch: expected a positive integer');
  }
  let replay: BeMusicReplay;
  try {
    replay = parseReplay(run.replay);
  } catch (error) {
    if (error instanceof ReplayParseError) throw new ReplayParseError(`nonstop.replay: ${error.message}`);
    throw error;
  }
  if (!Array.isArray(run.stages) || run.stages.length === 0) {
    throw new ReplayParseError('nonstop.stages: expected a non-empty array');
  }
  const stages = run.stages.map((raw, index) => {
    const path = `nonstop.stages[${index}]`;
    const stage = expectRecord(raw, path);
    const parsed: ReplayNonstopRun['stages'][number] = {
      offsetUs: expectFiniteNumber(stage.offsetUs, `${path}.offsetUs`),
      windowStartUs: expectFiniteNumber(stage.windowStartUs, `${path}.windowStartUs`),
      rate: expectFiniteNumber(stage.rate, `${path}.rate`),
    };
    if (stage.windowEndUs !== undefined) {
      parsed.windowEndUs = expectFiniteNumber(stage.windowEndUs, `${path}.windowEndUs`);
    }
    if (stage.randomDraws !== undefined) {
      parsed.randomDraws = parseRandomDraws(stage.randomDraws, `${path}.randomDraws`);
    }
    return parsed;
  });
  const noteStages = run.noteStages;
  if (
    !Array.isArray(noteStages) ||
    noteStages.length !== replay.chart.notes.length ||
    !noteStages.every((stage) => Number.isInteger(stage) && stage >= 0 && stage < stages.length)
  ) {
    throw new ReplayParseError('nonstop.noteStages: expected a stage index per note of nonstop.replay');
  }
  return {
    connections: [...(run.connections as ReplayNonstopRun['connections'])],
    placement: run.placement,
    ...(run.stitch !== undefined ? { stitch: run.stitch as number } : {}),
    replay,
    stages,
    noteStages: [...(noteStages as number[])],
  };
}

function parseCourseResults(results: Record<string, unknown>): Record<string, ReplayCourseResult> {
  const parsed: Record<string, ReplayCourseResult> = {};
  for (const [key, raw] of Object.entries(results)) {
    const path = `results.${key}`;
    const record = expectRecord(raw, path);
    // The per-ruleset fields share the stage result shape; the stage list is parsed like a results map.
    const [base] = Object.values(parseResults({ [key]: record }));
    const lamp = expectString(record.lamp, `${path}.lamp`);
    if (!COURSE_LAMPS.has(lamp)) throw new ReplayParseError(`${path}.lamp: unknown lamp ${JSON.stringify(lamp)}`);
    if (!Array.isArray(record.stages)) throw new ReplayParseError(`${path}.stages: expected an array`);
    const stageMap = Object.fromEntries(record.stages.map((stage, index) => [String(index), stage]));
    const result: ReplayCourseResult = {
      ruleset: base!.ruleset,
      judge: base!.judge,
      fast: base!.fast,
      slow: base!.slow,
      exScore: base!.exScore,
      noteCount: base!.noteCount,
      missCount: expectFiniteNumber(record.missCount, `${path}.missCount`),
      maxCombo: base!.maxCombo,
      ...(base!.minePoor !== undefined ? { minePoor: base!.minePoor } : {}),
      djLevel: expectString(record.djLevel, `${path}.djLevel`),
      gauge: { type: base!.gauge.type, final: base!.gauge.final, cleared: base!.gauge.cleared },
      stagesPlayed: expectFiniteNumber(record.stagesPlayed, `${path}.stagesPlayed`),
      lamp: lamp as CourseClearLamp,
      stages: Object.values(parseResults(stageMap, `${path}.stages`)),
    };
    const trophy = optionalString(record.trophy, `${path}.trophy`);
    if (trophy !== undefined) result.trophy = trophy;
    parsed[key] = result;
  }
  return parsed;
}
