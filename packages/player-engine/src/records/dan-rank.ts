import type { CourseKind } from '../course/definition.ts';
import type { ClearLamp } from '../ruleset/clear-lamp.ts';

/**
 * be-music's dan ladder, lowest first: the kyu (級) ranks from 10th up to 1st, the dan (段) ranks from 1st (初段) up to
 * 10th, 中伝 and 皆伝, then the insane (発狂) dan ranks from 1st up to 10th, 発狂皆伝 and Overjoy. Neither LR2 nor beatoraja
 * defines a ladder (see `docs/research/dan-rank.md`); this one follows the course names of the common dan certification
 * sets, which a course is matched against by {@link resolveCourseDanRank}.
 */
export const DAN_RANKS = [
  'kyu-10',
  'kyu-9',
  'kyu-8',
  'kyu-7',
  'kyu-6',
  'kyu-5',
  'kyu-4',
  'kyu-3',
  'kyu-2',
  'kyu-1',
  'dan-1',
  'dan-2',
  'dan-3',
  'dan-4',
  'dan-5',
  'dan-6',
  'dan-7',
  'dan-8',
  'dan-9',
  'dan-10',
  'chuden',
  'kaiden',
  'insane-1',
  'insane-2',
  'insane-3',
  'insane-4',
  'insane-5',
  'insane-6',
  'insane-7',
  'insane-8',
  'insane-9',
  'insane-10',
  'insane-kaiden',
  'overjoy',
] as const;

/** One rank of the dan ladder ({@link DAN_RANKS}). */
export type DanRank = (typeof DAN_RANKS)[number];

/** Whether `value` names a rank of the dan ladder. */
export function isDanRank(value: unknown): value is DanRank {
  return typeof value === 'string' && (DAN_RANKS as readonly string[]).includes(value);
}

/** The position of `rank` on the dan ladder: `kyu-10` 0 up to `overjoy`, higher is harder. */
export function danRankOrder(rank: DanRank): number {
  return DAN_RANKS.indexOf(rank);
}

/** The higher of two ranks, `candidate` when there is no `current` one. */
export function higherDanRank(current: DanRank | undefined, candidate: DanRank): DanRank {
  return current !== undefined && danRankOrder(current) >= danRankOrder(candidate) ? current : candidate;
}

const KANJI_NUMERALS: Readonly<Record<string, number>> = {
  初: 1,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

const LABEL_NUMERALS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'] as const;

/** A numeral before 段 / 級: one kanji numeral (初 for dan 1) or 1-10 in digits (not the end of a longer number). */
const NUMERAL = '(?<![0-9])(10|[1-9]|[初一二三四五六七八九十])';
const DAN_PATTERN = new RegExp(`${NUMERAL}\\s*段(?!位)`, 'u');
const KYU_PATTERN = new RegExp(`${NUMERAL}\\s*級`, 'u');
/** English spellings: `7th dan`, `dan 7`, `1st kyu`. */
const EN_DAN_PATTERN = /\b(10|[1-9])(?:st|nd|rd|th)?\s*dan\b|\bdan\s*(10|[1-9])\b/iu;
const EN_KYU_PATTERN = /\b(10|[1-9])(?:st|nd|rd|th)?\s*kyu\b|\bkyu\s*(10|[1-9])\b/iu;

function numeralValue(token: string | undefined): number | undefined {
  if (token === undefined) return undefined;
  const value = KANJI_NUMERALS[token] ?? Number(token);
  return Number.isInteger(value) && value >= 1 && value <= 10 ? value : undefined;
}

function matchLevel(name: string, pattern: RegExp, english: RegExp): number | undefined {
  const japanese = pattern.exec(name);
  if (japanese !== null) return numeralValue(japanese[1]);
  const match = english.exec(name);
  return match === null ? undefined : numeralValue(match[1] ?? match[2]);
}

/**
 * The dan rank a course certifies, read from its name, or `undefined` for a name that names none. The name is
 * NFKC-normalised first (full-width digits and letters), then read as, in this order: Overjoy; 発狂 (or `insane`) with
 * 皆伝 or a dan; 皆伝 (`kaiden`); 中伝 (`chuden`); a dan (`七段`, `初段`, `7段`, `7th dan`); a kyu (`十級`, `1st kyu`).
 * 段位 (as in 段位認定) is not a dan. This is be-music's own reading: LR2 and beatoraja keep no dan rank of their own.
 */
export function resolveCourseDanRank(courseName: string): DanRank | undefined {
  const name = courseName.normalize('NFKC');
  if (/overjoy/iu.test(name)) return 'overjoy';
  const insane = /発狂|insane/iu.test(name);
  if (/皆伝|kaiden/iu.test(name)) return insane ? 'insane-kaiden' : 'kaiden';
  if (!insane && /中伝|chuden/iu.test(name)) return 'chuden';
  const dan = matchLevel(name, DAN_PATTERN, EN_DAN_PATTERN);
  if (dan !== undefined) return `${insane ? 'insane' : 'dan'}-${dan}` as DanRank;
  if (insane) return undefined;
  const kyu = matchLevel(name, KYU_PATTERN, EN_KYU_PATTERN);
  return kyu !== undefined ? (`kyu-${kyu}` as DanRank) : undefined;
}

/** The Japanese label of a rank, as dan courses are named: `十級`, `初段`, `七段`, `中伝`, `発狂皆伝`, `Overjoy`. */
export function formatDanRank(rank: DanRank): string {
  if (rank === 'overjoy') return 'Overjoy';
  if (rank === 'chuden') return '中伝';
  if (rank === 'kaiden') return '皆伝';
  if (rank === 'insane-kaiden') return '発狂皆伝';
  const [ladder, level] = rank.split('-') as [string, string];
  const value = Number(level);
  if (ladder === 'kyu') return `${LABEL_NUMERALS[value]}級`;
  const numeral = value === 1 ? '初' : LABEL_NUMERALS[value];
  return ladder === 'insane' ? `発狂${numeral}段` : `${numeral}段`;
}

/**
 * The key mode a dan course certifies: the one its source names (LR2 `line`, a table's `mode`), else the key mode all
 * its stages share, else `undefined` (stages of different key modes, or none known). LR2 keeps one dan per key mode
 * (`grade_7`, `grade_5`, `grade_14`, `grade_10`, `grade_9`).
 */
export function resolveDanCourseKeyMode(
  declared: number | undefined,
  stageKeyModes: readonly (number | undefined)[],
): number | undefined {
  if (declared !== undefined) return declared;
  const [first] = stageKeyModes;
  if (first === undefined) return undefined;
  return stageKeyModes.every((keyMode) => keyMode === first) ? first : undefined;
}

/** What a finished course run says about the player's dan rank. */
export interface DanCourseRun {
  kind: CourseKind;
  name: string;
  /** The run's clear lamp (`resolveCourseClearLamp`). */
  lamp: ClearLamp;
}

/**
 * The dan rank a course run certifies: the rank its name names ({@link resolveCourseDanRank}) when it is a GRADE course
 * and the run cleared (any lamp but `NO_PLAY` and `FAILED`), else `undefined`. An EXPERT or NONSTOP course certifies
 * nothing, whatever it is named.
 */
export function resolveCourseRunDanRank(run: DanCourseRun): DanRank | undefined {
  if (run.kind !== 'grade' || run.lamp === 'NO_PLAY' || run.lamp === 'FAILED') return undefined;
  return resolveCourseDanRank(run.name);
}
