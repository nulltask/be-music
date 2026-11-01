import type { CourseKind } from '../course/definition.ts';
import { clearLampRank, type ClearLamp } from '../ruleset/clear-lamp.ts';

/**
 * The dan ranks (段位) a player can hold in one key mode, lowest first: the kyu grades (十級 … 一級), the dan grades
 * (初段 … 十段), 中伝 and 皆伝, then the insane ladder (発狂初段 … 発狂十段, 発狂皆伝) and Overjoy. A rank's index is its
 * order ({@link danRankOrder}): a higher rank comes later.
 *
 * Neither LR2 nor beatoraja derives a dan rank from a course clear on the player's side (see `docs/course.md`, "The
 * player's dan rank"), so this ladder is be-music's own. It follows the dan courses difficulty tables publish, and puts
 * the insane ladder above 皆伝, as LR2IR shows ☆ (normal) ranks below ★ (insane) ones (community knowledge, unverified).
 */
export const DAN_RANKS = [
  'KYU_10',
  'KYU_9',
  'KYU_8',
  'KYU_7',
  'KYU_6',
  'KYU_5',
  'KYU_4',
  'KYU_3',
  'KYU_2',
  'KYU_1',
  'DAN_1',
  'DAN_2',
  'DAN_3',
  'DAN_4',
  'DAN_5',
  'DAN_6',
  'DAN_7',
  'DAN_8',
  'DAN_9',
  'DAN_10',
  'CHUUDEN',
  'KAIDEN',
  'INSANE_1',
  'INSANE_2',
  'INSANE_3',
  'INSANE_4',
  'INSANE_5',
  'INSANE_6',
  'INSANE_7',
  'INSANE_8',
  'INSANE_9',
  'INSANE_10',
  'INSANE_KAIDEN',
  'OVERJOY',
] as const;

/** One dan rank of {@link DAN_RANKS}. */
export type DanRank = (typeof DAN_RANKS)[number];

/** Whether `value` names a dan rank. */
export function isDanRank(value: unknown): value is DanRank {
  return typeof value === 'string' && (DAN_RANKS as readonly string[]).includes(value);
}

/** The order of `rank` in {@link DAN_RANKS}: `KYU_10` 0 up to `OVERJOY`, higher is better. */
export function danRankOrder(rank: DanRank): number {
  return DAN_RANKS.indexOf(rank);
}

/** The higher of two ranks; `current` on a tie, and `candidate` when there is no `current`. */
export function betterDanRank(current: DanRank | undefined, candidate: DanRank): DanRank {
  return current !== undefined && danRankOrder(current) >= danRankOrder(candidate) ? current : candidate;
}

/** The kanji numerals a dan or kyu grade is written with (初 for the first dan); digits are read as numbers. */
const NUMERALS: Readonly<Record<string, number>> = {
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

/** The value of a dan or kyu numeral (`初`, `七`, `十`, `7`, `10`), or `undefined` outside 1-10. */
function numeralValue(text: string): number | undefined {
  const kanji = NUMERALS[text];
  if (kanji !== undefined) return kanji;
  if (!/^[0-9]{1,2}$/u.test(text)) return undefined;
  const value = Number(text);
  return value >= 1 && value <= 10 ? value : undefined;
}

const NUMERAL = '(?<![0-9])(初|一|二|三|四|五|六|七|八|九|十|[0-9]{1,2})';
const INSANE_DAN = new RegExp(`発狂\\s*${NUMERAL}\\s*段(?!位)`, 'gu');
const DAN = new RegExp(`${NUMERAL}\\s*段(?!位)`, 'gu');
const KYU = new RegExp(`${NUMERAL}\\s*級`, 'gu');

/** The value of the first match of `pattern` in `name` whose numeral is a grade (1-10, 初 only for a dan). */
function firstGrade(name: string, pattern: RegExp, allowFirst: boolean): number | undefined {
  for (const match of name.matchAll(pattern)) {
    const numeral = match[1]!;
    if (numeral === '初' && !allowFirst) continue;
    const value = numeralValue(numeral);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * The dan rank a course's name names, or `undefined` when it names none: `発狂N段` / `発狂皆伝`, `Overjoy`, `N段`,
 * `中伝` / `皆伝` and `N級`, read with kanji (初段, 十段), full-width or ASCII numerals, wherever they sit in the name
 * (`GENOSIDE 2018 段位認定 発狂初段`; the `段` of `段位` is not a grade). A name that names no rank on {@link DAN_RANKS}
 * (a skill analyzer such as Satellite's `sl5`) earns none.
 */
export function recognizeDanRank(courseName: string): DanRank | undefined {
  const name = courseName.normalize('NFKC');
  if (/overjoy/iu.test(name)) return 'OVERJOY';
  if (/発狂\s*皆伝/u.test(name)) return 'INSANE_KAIDEN';
  const insane = firstGrade(name, INSANE_DAN, true);
  if (insane !== undefined) return `INSANE_${insane}` as DanRank;
  if (name.includes('皆伝')) return 'KAIDEN';
  if (name.includes('中伝')) return 'CHUUDEN';
  const dan = firstGrade(name, DAN, true);
  if (dan !== undefined) return `DAN_${dan}` as DanRank;
  const kyu = firstGrade(name, KYU, false);
  return kyu === undefined ? undefined : (`KYU_${kyu}` as DanRank);
}

const KANJI_NUMERALS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'] as const;

/** The name a rank is shown by: `七級`, `初段`, `十段`, `中伝`, `皆伝`, `発狂初段`, `発狂皆伝`, `Overjoy`. */
export function formatDanRank(rank: DanRank): string {
  if (rank === 'CHUUDEN') return '中伝';
  if (rank === 'KAIDEN') return '皆伝';
  if (rank === 'INSANE_KAIDEN') return '発狂皆伝';
  if (rank === 'OVERJOY') return 'Overjoy';
  const [ladder, step] = rank.split('_') as [string, string];
  const value = Number(step);
  if (ladder === 'KYU') return `${KANJI_NUMERALS[value]}級`;
  const numeral = value === 1 ? '初' : KANJI_NUMERALS[value];
  return ladder === 'INSANE' ? `発狂${numeral}段` : `${numeral}段`;
}

/** The player's dan rank in one key mode under one judge ruleset, and the course that earned it. */
export interface DanRankRecord {
  rank: DanRank;
  /** The name of the course whose clear earned the rank. */
  course: string;
}

/** What a finished course run says about a dan rank. */
export interface DanRankCourseRun {
  kind: CourseKind;
  /** The course's name, which names the rank ({@link recognizeDanRank}). */
  name: string;
  /** The run's clear lamp (`resolveCourseClearLamp`). */
  lamp: ClearLamp;
}

/**
 * The dan rank a finished course run earns, or `undefined` when it earns none: a cleared GRADE course (any lamp above
 * `FAILED`) whose name names a rank ({@link recognizeDanRank}). An EXPERT or NONSTOP course earns none, and neither
 * does a failed run. Whether the run keeps a record at all (no AUTO, no other tempo) is the host's check, as for the
 * course's best record (`courseRunKeepsRecord`).
 */
export function resolveCourseRunDanRank(run: DanRankCourseRun): DanRank | undefined {
  if (run.kind !== 'grade' || clearLampRank(run.lamp) <= clearLampRank('FAILED')) return undefined;
  return recognizeDanRank(run.name);
}

/**
 * Merges a newly earned rank into the player's record: the higher rank is kept with the course that earned it, and
 * `previous` stays on a tie, so the record names the first course that reached the rank.
 */
export function mergeDanRankRecord(previous: DanRankRecord | undefined, earned: DanRankRecord): DanRankRecord {
  if (previous === undefined || danRankOrder(earned.rank) > danRankOrder(previous.rank)) return earned;
  return previous;
}
