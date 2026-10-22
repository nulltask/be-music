import type { RandomDraw } from '@be-music/chart-model';
import type { ReplayRecorderInfo, ReplayRulesetResult } from './format.ts';

/** Structural problem in a serialized replay (or course replay), with the field path in the message. */
export class ReplayParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayParseError';
  }
}

const RECORDER_KEYS = ['name', 'version', 'build', 'engine', 'platform'] as const;

export function parseRecorder(recorder: Record<string, unknown>): ReplayRecorderInfo {
  const parsed: ReplayRecorderInfo = {};
  for (const key of RECORDER_KEYS) {
    const value = optionalString(recorder[key], `recorder.${key}`);
    if (value !== undefined) parsed[key] = value;
  }
  return parsed;
}

export function parseResults(
  results: Record<string, unknown>,
  prefix = 'results',
): Record<string, ReplayRulesetResult> {
  const parsed: Record<string, ReplayRulesetResult> = {};
  for (const [key, raw] of Object.entries(results)) {
    const record = expectRecord(raw, `${prefix}.${key}`);
    const judge = expectRecord(record.judge, `${prefix}.${key}.judge`);
    const gauge = expectRecord(record.gauge, `${prefix}.${key}.gauge`);
    const result: ReplayRulesetResult = {
      ruleset: expectString(record.ruleset, `${prefix}.${key}.ruleset`),
      judge: {
        pgreat: expectFiniteNumber(judge.pgreat, `${prefix}.${key}.judge.pgreat`),
        great: expectFiniteNumber(judge.great, `${prefix}.${key}.judge.great`),
        good: expectFiniteNumber(judge.good, `${prefix}.${key}.judge.good`),
        bad: expectFiniteNumber(judge.bad, `${prefix}.${key}.judge.bad`),
        poor: expectFiniteNumber(judge.poor, `${prefix}.${key}.judge.poor`),
        emptyPoor: expectFiniteNumber(judge.emptyPoor, `${prefix}.${key}.judge.emptyPoor`),
      },
      fast: expectFiniteNumber(record.fast, `${prefix}.${key}.fast`),
      slow: expectFiniteNumber(record.slow, `${prefix}.${key}.slow`),
      exScore: expectFiniteNumber(record.exScore, `${prefix}.${key}.exScore`),
      noteCount: expectFiniteNumber(record.noteCount, `${prefix}.${key}.noteCount`),
      maxCombo: expectFiniteNumber(record.maxCombo, `${prefix}.${key}.maxCombo`),
      gauge: {
        type: expectString(gauge.type, `${prefix}.${key}.gauge.type`),
        final: expectFiniteNumber(gauge.final, `${prefix}.${key}.gauge.final`),
        cleared: gauge.cleared === true,
      },
    };
    if (record.minePoor !== undefined)
      result.minePoor = expectNonNegativeInteger(record.minePoor, `${prefix}.${key}.minePoor`);
    if (gauge.failedMidPlay !== undefined) result.gauge.failedMidPlay = gauge.failedMidPlay === true;
    const score = optionalFiniteNumber(record.score, `${prefix}.${key}.score`);
    if (score !== undefined) result.score = score;
    const djLevel = optionalString(record.djLevel, `${prefix}.${key}.djLevel`);
    if (djLevel !== undefined) result.djLevel = djLevel;
    if (record.course !== undefined) {
      const course = expectRecord(record.course, `${prefix}.${key}.course`);
      result.course = {
        combo: expectFiniteNumber(course.combo, `${prefix}.${key}.course.combo`),
        maxCombo: expectFiniteNumber(course.maxCombo, `${prefix}.${key}.course.maxCombo`),
      };
    }
    parsed[key] = result;
  }
  return parsed;
}

export function expectNonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ReplayParseError(`${path}: expected a non-negative integer`);
  }
  return value;
}

export function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReplayParseError(`${path}: expected an object`);
  }
  return value as Record<string, unknown>;
}

export function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new ReplayParseError(`${path}: expected a string`);
  }
  return value;
}

export function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return expectString(value, path);
}

export function expectFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ReplayParseError(`${path}: expected a finite number`);
  }
  return value;
}

export function optionalFiniteNumber(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  return expectFiniteNumber(value, path);
}

const RANDOM_DRAW_COMMANDS: ReadonlySet<string> = new Set(['RANDOM', 'SETRANDOM', 'SWITCH', 'SETSWITCH']);

/** Parses a list of `#RANDOM` / `#SWITCH` draws (`play.randomDraws`, a NONSTOP stage's `randomDraws`) at `at`. */
export function parseRandomDraws(value: unknown, at: string): RandomDraw[] {
  if (!Array.isArray(value)) {
    throw new ReplayParseError(`${at}: expected an array`);
  }
  return value.map((entry: unknown, index): RandomDraw => {
    const path = `${at}[${index}]`;
    const draw = expectRecord(entry, path);
    const { command, range, value: drawn } = draw;
    if (typeof command !== 'string' || !RANDOM_DRAW_COMMANDS.has(command)) {
      throw new ReplayParseError(`${path}.command: expected 'RANDOM' | 'SETRANDOM' | 'SWITCH' | 'SETSWITCH'`);
    }
    if (typeof range !== 'number' || !Number.isInteger(range) || range < 1) {
      throw new ReplayParseError(`${path}.range: expected a positive integer`);
    }
    const fixed = command === 'SETRANDOM' || command === 'SETSWITCH';
    if (typeof drawn !== 'number' || !Number.isInteger(drawn) || drawn < 1 || (fixed ? range !== 1 : drawn > range)) {
      throw new ReplayParseError(`${path}.value: expected an integer in 1..range (range 1 for a #SET… line)`);
    }
    return { command: command as RandomDraw['command'], range, value: drawn };
  });
}
