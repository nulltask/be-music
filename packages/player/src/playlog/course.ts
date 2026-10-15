import type { GrooveGaugeType } from '../core/groove-gauge.ts';
import { resolveIidxRankLabel } from '../core/scoring.ts';
import type { RulesetChartFacts } from '../ruleset/facts.ts';
import { resolveRuleset, type PlaylogRulesetId } from '../ruleset/index.ts';
import type { RulesetCourseKind } from '../ruleset/course.ts';
import {
  BE_MUSIC_PLAYLOG_VERSION,
  parsePlaylog,
  type BeMusicPlaylog,
  type PlaylogJudgeCounts,
  type PlaylogRecorderInfo,
  type PlaylogRulesetResult,
} from './format.ts';
import {
  expectFiniteNumber,
  expectRecord,
  expectString,
  optionalString,
  parseRecorder,
  parseResults,
  PlaylogParseError,
} from './parse.ts';
import { resolveRulesetConfig } from './rulesets.ts';
import { simulatePlaylog, type SimulatePlaylogOptions } from './simulate.ts';

/**
 * A course play log: one file for a whole course run, holding each stage's own play log in order. Every stage log is
 * complete on its own (its `play.course` carries the course kind, constraints and the state carried in), so a stage
 * can be extracted and replayed or re-simulated as a single-chart log. Stages the run never reached (after a failed
 * stage) are listed with their chart facts only, so the course result can still count their notes.
 */
export const BE_MUSIC_COURSE_PLAYLOG_FORMAT = 'be-music-course-playlog';
export const COURSE_PLAYLOG_FILE_SUFFIX = '.bmcourse.json';

export interface BeMusicCoursePlaylog {
  format: typeof BE_MUSIC_COURSE_PLAYLOG_FORMAT;
  /** Shares the play-log revision: course logs change together with the stage logs they hold. */
  version: number;
  createdAt?: string;
  recorder?: PlaylogRecorderInfo;
  course: PlaylogCourseInfo;
  /** One entry per course stage, in order. */
  stages: PlaylogCourseStageEntry[];
  /** Regenerable cache: the course result per ruleset id, plus `native` (the engine's own). */
  results?: Record<string, PlaylogCourseResult>;
}

/** What the course was: enough to identify it and to compute its trophy. */
export interface PlaylogCourseInfo {
  name: string;
  kind: RulesetCourseKind;
  /** The course's constraints, by their table-header names (`grade_mirror`, `gauge_lr2`, ...). */
  constraints: string[];
  trophies: Array<{ name: string; missRate: number; scoreRate: number }>;
}

export type PlaylogCourseStageEntry =
  | { played: true; playlog: BeMusicPlaylog }
  | {
      played: false;
      /** The stage chart's file hashes, when known. */
      sha256?: string;
      md5?: string;
      /** The facts a ruleset needs to count the stage's notes. */
      facts: RulesetChartFacts;
    };

/** The lamp a course run earns, on the same scale as single-chart lamps. */
export type CourseClearLamp = 'FAILED' | 'EASY' | 'NORMAL' | 'HARD' | 'EX_HARD' | 'FULL_COMBO' | 'PERFECT' | 'MAX';

export interface PlaylogCourseResult {
  ruleset: string;
  /** Judgments summed over the stages played. */
  judge: PlaylogJudgeCounts;
  fast: number;
  slow: number;
  exScore: number;
  /** Judgment notes over every stage of the course, reached or not. */
  noteCount: number;
  /** BP: BADs, POORs and empty POORs, plus every note the run never judged (failed or unreached stages). */
  missCount: number;
  /** The course-wide max combo. */
  maxCombo: number;
  djLevel: string;
  /** The gauge the course ended on. */
  gauge: { type: string; final: number; cleared: boolean };
  /** The number of stages the run reached. */
  stagesPlayed: number;
  lamp: CourseClearLamp;
  /** The best trophy the run earned, by name. */
  trophy?: string;
  /** Each played stage's own result, in order. */
  stages: PlaylogRulesetResult[];
}

/** Course gauges → the lamp a clear earns, before the full-combo upgrades. */
const COURSE_GAUGE_LAMPS: Readonly<Record<string, CourseClearLamp>> = {
  CLASS: 'NORMAL',
  EXCLASS: 'HARD',
  EXHARDCLASS: 'EX_HARD',
  'GRADE-HARD': 'HARD',
  'GRADE-DEATH': 'HARD',
  'COURSE-HARD': 'HARD',
  'COURSE-DEATH': 'HARD',
  'COURSE-EASY': 'EASY',
};

const TOP_LAMP: Readonly<Record<string, CourseClearLamp>> = { lr2: 'FULL_COMBO', beatoraja: 'MAX', iidx: 'FULL_COMBO' };
const LAMP_ORDER: readonly CourseClearLamp[] = [
  'FAILED',
  'EASY',
  'NORMAL',
  'HARD',
  'EX_HARD',
  'FULL_COMBO',
  'PERFECT',
  'MAX',
];

/**
 * The lamp of a course run.
 *
 * - FAILED when a stage ended with its gauge empty or a stage was never reached (LR2 `CheckCourseClear`, beatoraja
 *   `MusicResult`).
 * - A FULL COMBO when the course max combo covers every note (Σ notes == course max combo, as both check), a PERFECT
 *   without a GOOD and a MAX with only PGREATs, capped at the ruleset's top lamp.
 * - Otherwise the gauge's lamp. LR2's lamp follows the player's gauge pick (option 3 EASY → EASY, HARD and DEATH →
 *   HARD, else GROOVE / NORMAL); beatoraja's follows the class gauge (CLASS NORMAL, EXCLASS HARD, EXHARDCLASS EX-HARD).
 */
export function resolveCourseLamp(
  ruleset: string,
  result: Pick<PlaylogCourseResult, 'judge' | 'noteCount' | 'maxCombo' | 'gauge'>,
  pick: GrooveGaugeType,
): CourseClearLamp {
  if (!result.gauge.cleared) return 'FAILED';
  let lamp: CourseClearLamp =
    ruleset === 'lr2'
      ? pick === 'EASY'
        ? 'EASY'
        : pick === 'HARD' || pick === 'DEATH'
          ? 'HARD'
          : 'NORMAL'
      : (COURSE_GAUGE_LAMPS[result.gauge.type] ?? 'NORMAL');
  if (result.noteCount > 0 && result.maxCombo >= result.noteCount) {
    const { great, good } = result.judge;
    lamp = good > 0 ? 'FULL_COMBO' : great > 0 ? 'PERFECT' : 'MAX';
  }
  const top = TOP_LAMP[ruleset] ?? 'FULL_COMBO';
  return LAMP_ORDER.indexOf(lamp) > LAMP_ORDER.indexOf(top) ? top : lamp;
}

/**
 * The trophy a course result earns (beatoraja `GradeBar.getTrophy`): the last trophy whose `missRate` is at least the
 * BP rate (`missCount × 100 / notes`) and whose `scoreRate` is at most the score rate (`exScore × 100 / (2 × notes)`).
 * Trophies are listed easiest first, so the last one that qualifies is the best.
 */
export function resolveCourseTrophy(
  trophies: PlaylogCourseInfo['trophies'],
  result: Pick<PlaylogCourseResult, 'missCount' | 'exScore' | 'noteCount'>,
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
  course: PlaylogCourseInfo,
  stageResults: readonly PlaylogRulesetResult[],
  stageNoteCounts: readonly number[],
  pick: GrooveGaugeType,
): PlaylogCourseResult {
  const judge: PlaylogJudgeCounts = { pgreat: 0, great: 0, good: 0, bad: 0, poor: 0, emptyPoor: 0 };
  let fast = 0;
  let slow = 0;
  let exScore = 0;
  let judged = 0;
  for (const stage of stageResults) {
    for (const key of Object.keys(judge) as Array<keyof PlaylogJudgeCounts>) judge[key] += stage.judge[key];
    fast += stage.fast;
    slow += stage.slow;
    exScore += stage.exScore;
    judged += stage.judge.pgreat + stage.judge.great + stage.judge.good + stage.judge.bad + stage.judge.poor;
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
  const missCount = judge.bad + judge.poor + judge.emptyPoor + Math.max(0, noteCount - judged);
  const result: PlaylogCourseResult = {
    ruleset,
    judge,
    fast,
    slow,
    exScore,
    noteCount,
    missCount,
    maxCombo: partial.maxCombo,
    djLevel: resolveIidxRankLabel(exScore, noteCount),
    gauge,
    stagesPlayed: stageResults.length,
    lamp: resolveCourseLamp(ruleset.split('/')[0]!, partial, pick),
    stages: [...stageResults],
  };
  const trophy = gauge.cleared ? resolveCourseTrophy(course.trophies, result) : undefined;
  if (trophy !== undefined) result.trophy = trophy;
  return result;
}

/** The gauge a stage hands on: a stage that ended with its survival gauge empty ends the course. */
function stageFailed(result: PlaylogRulesetResult): boolean {
  return result.gauge.failedMidPlay === true || result.gauge.final <= 0;
}

/** The judgment notes one stage counts under a ruleset, from a stage log or from an unreached stage's facts. */
function stageNoteCount(entry: PlaylogCourseStageEntry, rulesetId: PlaylogRulesetId): number {
  return entry.played
    ? resolveRulesetConfig(entry.playlog, rulesetId).noteCount
    : resolveRuleset(entry.facts, rulesetId).noteCount;
}

/**
 * Re-simulates a whole course under one ruleset. Each stage after the first starts from the state the SIMULATED
 * previous stage left (its gauge value and course combo replace the recorded carry-in), so the result never trusts the
 * recording; the course stops at the first stage whose gauge emptied, as the live run did.
 */
export function simulateCoursePlaylog(
  courseLog: BeMusicCoursePlaylog,
  options: Omit<SimulatePlaylogOptions, 'course'>,
): PlaylogCourseResult {
  const stageResults: PlaylogRulesetResult[] = [];
  let pick: GrooveGaugeType = 'GROOVE';
  let previous: PlaylogRulesetResult | undefined;
  for (const entry of courseLog.stages) {
    if (!entry.played || (previous !== undefined && stageFailed(previous))) break;
    const stageLog = structuredClone(entry.playlog);
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
    previous = simulatePlaylog(stageLog, options);
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

/** A course stage's own play log, ready to replay or re-simulate as a single-chart log. `undefined` for an unreached stage. */
export function extractCourseStage(courseLog: BeMusicCoursePlaylog, index: number): BeMusicPlaylog | undefined {
  const entry = courseLog.stages[index];
  return entry?.played === true ? structuredClone(entry.playlog) : undefined;
}

/**
 * Assembles a course play log from the stages a host played (their own play logs, in order) and the facts of the
 * stages it never reached. The native course result is aggregated from the stage logs' native results.
 */
export function createCoursePlaylog(options: {
  course: PlaylogCourseInfo;
  stages: readonly PlaylogCourseStageEntry[];
  recorder?: PlaylogRecorderInfo;
  createdAt?: string;
}): BeMusicCoursePlaylog {
  const log: BeMusicCoursePlaylog = {
    format: BE_MUSIC_COURSE_PLAYLOG_FORMAT,
    version: BE_MUSIC_PLAYLOG_VERSION,
    course: structuredClone(options.course),
    stages: options.stages.map((entry) => structuredClone(entry)),
  };
  if (options.createdAt !== undefined) log.createdAt = options.createdAt;
  if (options.recorder !== undefined) log.recorder = { ...options.recorder };
  const played = options.stages.filter((entry) => entry.played);
  const native = played.map((entry) => entry.playlog.results?.native);
  if (played.length > 0 && native.every((result) => result !== undefined)) {
    const ruleset = played[0]!.playlog.play.judgeRuleset ?? 'lr2';
    const noteCounts = options.stages.map((entry, index) =>
      index < native.length ? native[index]!.noteCount : stageNoteCount(entry, ruleset),
    );
    log.results = {
      native: aggregateCourseResult(
        native[0]!.ruleset,
        options.course,
        native as PlaylogRulesetResult[],
        noteCounts,
        played.at(-1)!.playlog.play.gauge,
      ),
    };
  }
  return log;
}

export function serializeCoursePlaylog(courseLog: BeMusicCoursePlaylog): string {
  return JSON.stringify(courseLog);
}

const COURSE_KINDS: ReadonlySet<string> = new Set(['grade', 'expert', 'nonstop']);
const COURSE_LAMPS: ReadonlySet<string> = new Set(LAMP_ORDER);

function parseJudgeRankFacts(judgeRank: Record<string, unknown>, path: string): RulesetChartFacts['judgeRank'] {
  const parsed: RulesetChartFacts['judgeRank'] = { percent: expectFiniteNumber(judgeRank.percent, `${path}.percent`) };
  if (judgeRank.sourceRank !== undefined)
    parsed.sourceRank = expectFiniteNumber(judgeRank.sourceRank, `${path}.sourceRank`);
  if (judgeRank.sourceExRank !== undefined) {
    parsed.sourceExRank = expectFiniteNumber(judgeRank.sourceExRank, `${path}.sourceExRank`);
  }
  if (judgeRank.timeline !== undefined) {
    if (!Array.isArray(judgeRank.timeline)) throw new PlaylogParseError(`${path}.timeline: expected an array`);
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
    throw new PlaylogParseError(`${path}.sourceFormat: expected 'bms' | 'bmson'`);
  }
  const lnMode = facts.lnMode;
  if (lnMode !== 1 && lnMode !== 2 && lnMode !== 3) {
    throw new PlaylogParseError(`${path}.lnMode: expected 1 | 2 | 3`);
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
 * Parses (and validates) a course play log, JSON text or an already-parsed value. Each played stage goes through
 * `parsePlaylog`; errors name the stage (`stages[1].playlog: ...`).
 */
export function parseCoursePlaylog(source: unknown): BeMusicCoursePlaylog {
  let value: unknown = source;
  if (typeof source === 'string') {
    try {
      value = JSON.parse(source);
    } catch (error) {
      throw new PlaylogParseError(`invalid JSON: ${(error as Error).message}`);
    }
  }
  const root = expectRecord(value, 'course playlog');
  if (root.format !== BE_MUSIC_COURSE_PLAYLOG_FORMAT) {
    throw new PlaylogParseError(
      `format: expected '${BE_MUSIC_COURSE_PLAYLOG_FORMAT}', got ${JSON.stringify(root.format)}`,
    );
  }
  if (root.version !== BE_MUSIC_PLAYLOG_VERSION) {
    throw new PlaylogParseError(`version: unsupported version ${JSON.stringify(root.version)}`);
  }
  const course = expectRecord(root.course, 'course');
  if (typeof course.kind !== 'string' || !COURSE_KINDS.has(course.kind)) {
    throw new PlaylogParseError(`course.kind: expected 'grade' | 'expert' | 'nonstop'`);
  }
  if (!Array.isArray(course.constraints) || !course.constraints.every((name) => typeof name === 'string')) {
    throw new PlaylogParseError('course.constraints: expected an array of strings');
  }
  if (!Array.isArray(course.trophies)) {
    throw new PlaylogParseError('course.trophies: expected an array');
  }
  const info: PlaylogCourseInfo = {
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
  if (!Array.isArray(root.stages) || root.stages.length === 0) {
    throw new PlaylogParseError('stages: expected a non-empty array');
  }
  const stages = root.stages.map((raw, index): PlaylogCourseStageEntry => {
    const path = `stages[${index}]`;
    const entry = expectRecord(raw, path);
    if (entry.played === true) {
      try {
        return { played: true, playlog: parsePlaylog(entry.playlog) };
      } catch (error) {
        if (error instanceof PlaylogParseError) throw new PlaylogParseError(`${path}.playlog: ${error.message}`);
        throw error;
      }
    }
    if (entry.played !== false) {
      throw new PlaylogParseError(`${path}.played: expected a boolean`);
    }
    const unreached: PlaylogCourseStageEntry = { played: false, facts: parseFacts(entry.facts, `${path}.facts`) };
    const sha256 = optionalString(entry.sha256, `${path}.sha256`);
    const md5 = optionalString(entry.md5, `${path}.md5`);
    if (sha256 !== undefined) unreached.sha256 = sha256;
    if (md5 !== undefined) unreached.md5 = md5;
    return unreached;
  });
  const parsed: BeMusicCoursePlaylog = {
    format: BE_MUSIC_COURSE_PLAYLOG_FORMAT,
    version: BE_MUSIC_PLAYLOG_VERSION,
    course: info,
    stages,
  };
  const createdAt = optionalString(root.createdAt, 'createdAt');
  if (createdAt !== undefined) parsed.createdAt = createdAt;
  if (root.recorder !== undefined) parsed.recorder = parseRecorder(expectRecord(root.recorder, 'recorder'));
  if (root.results !== undefined) {
    parsed.results = parseCourseResults(expectRecord(root.results, 'results'));
  }
  return parsed;
}

function parseCourseResults(results: Record<string, unknown>): Record<string, PlaylogCourseResult> {
  const parsed: Record<string, PlaylogCourseResult> = {};
  for (const [key, raw] of Object.entries(results)) {
    const path = `results.${key}`;
    const record = expectRecord(raw, path);
    // The per-ruleset fields share the stage result shape; the stage list is parsed like a results map.
    const [base] = Object.values(parseResults({ [key]: record }));
    const lamp = expectString(record.lamp, `${path}.lamp`);
    if (!COURSE_LAMPS.has(lamp)) throw new PlaylogParseError(`${path}.lamp: unknown lamp ${JSON.stringify(lamp)}`);
    if (!Array.isArray(record.stages)) throw new PlaylogParseError(`${path}.stages: expected an array`);
    const stageMap = Object.fromEntries(record.stages.map((stage, index) => [String(index), stage]));
    const result: PlaylogCourseResult = {
      ruleset: base!.ruleset,
      judge: base!.judge,
      fast: base!.fast,
      slow: base!.slow,
      exScore: base!.exScore,
      noteCount: base!.noteCount,
      missCount: expectFiniteNumber(record.missCount, `${path}.missCount`),
      maxCombo: base!.maxCombo,
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
