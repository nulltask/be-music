/**
 * One course model for every source be-music reads: LR2 `.lr2crs` files, beatoraja `course/*.json` files and the
 * `course` / `grade` lists of difficulty-table headers. Parsers normalise into it; nothing downstream needs to know
 * which format a course came from.
 */

/**
 * How a course is played.
 *
 * - `grade`: dan certification (段位認定). Stages back to back on one carried class gauge.
 * - `expert`: the same chaining on the course gauge of the player's choice (LR2's EXPERT course).
 * - `nonstop`: stages stitched into one continuous play (LR2's NONSTOP course).
 */
export type CourseKind = 'grade' | 'expert' | 'nonstop';

/**
 * beatoraja's `CourseDataConstraint`, by its table-header name. At most one constraint per {@link CourseConstraintGroup}
 * is kept: the first one listed wins, as in `CourseData.validate`.
 */
export type CourseConstraint =
  | 'grade'
  | 'grade_mirror'
  | 'grade_random'
  | 'no_speed'
  | 'no_good'
  | 'no_great'
  | 'gauge_lr2'
  | 'gauge_5k'
  | 'gauge_7k'
  | 'gauge_9k'
  | 'gauge_24k'
  | 'ln'
  | 'cn'
  | 'hcn';

/** The groups of `CourseDataConstraint.type`: lane option, hi-speed, judge, gauge set, long-note mode. */
export type CourseConstraintGroup = 'option' | 'speed' | 'judge' | 'gauge' | 'longNote';

/** One stage, referenced by chart file hash. At least one of `md5` / `sha256` is set; both are lower-case hex. */
export interface CourseStageRef {
  md5?: string;
  sha256?: string;
  /** Display title for a stage not found locally. */
  title?: string;
  artist?: string;
}

/** A beatoraja trophy: earned when the BP rate is at most `missRate` % and the score rate at least `scoreRate` %. */
export interface CourseTrophy {
  name: string;
  missRate: number;
  scoreRate: number;
}

/**
 * How a NONSTOP course goes from one stage to the next (LR2's `courseKeys`, the first ten characters of a `.lr2crs`
 * hash, `0`-`5` in this order): the sound fades out over 10 s / in over 5 s (`fade`) or cuts over 0.2 s (`cut`), the
 * `-fit` forms also time-stretch the next stage to the previous one's BPM, and `blank1` / `blank2` leave a gap.
 */
export type NonstopConnection = 'fade' | 'fade-fit' | 'cut' | 'cut-fit' | 'blank1' | 'blank2';

/** Where a course definition came from. */
export type CourseSource =
  | { format: 'lr2crs'; type: number; header: string; hash: string }
  | { format: 'beatoraja-json' }
  | { format: 'beatoraja-random' }
  | { format: 'table'; legacyGrade: boolean };

export interface CourseDefinition {
  name: string;
  kind: CourseKind;
  stages: CourseStageRef[];
  /** Normalised: known names only, at most one per group, in source order. */
  constraints: CourseConstraint[];
  /** Easiest first: the last trophy a result qualifies for is the one it earns. */
  trophies: CourseTrophy[];
  /** beatoraja's `release`: false keeps the course's scores off any ranking. */
  release: boolean;
  /** Key mode the course is meant for (LR2 `line`, table `mode`), when the source says. */
  keyMode?: number;
  /** A NONSTOP course's connection after each stage but the last (see {@link NonstopConnection}). */
  connections?: NonstopConnection[];
  source: CourseSource;
}

/** One stage of a random course: the filter its chart is drawn by, and the stage's display title. */
export interface RandomCourseStage {
  /** An SQL `WHERE` clause (see `parseCourseChartFilter`). Absent: the first stage draws from every chart, a later one reuses the previous stage's candidates. */
  filter?: string;
  title?: string;
}

/**
 * A beatoraja random course: each stage is drawn from the charts a filter selects. beatoraja's filters are SQL
 * `WHERE` clauses over its song database; an empty one reuses the previous stage's candidates. `drawRandomCourse`
 * turns one into a fixed {@link CourseDefinition}.
 */
export interface RandomCourseDefinition {
  name: string;
  stages: RandomCourseStage[];
  constraints: CourseConstraint[];
  trophies: CourseTrophy[];
  /** `distinct`: no chart is drawn twice. */
  distinct: boolean;
}

const CONSTRAINT_GROUPS: Readonly<Record<CourseConstraint, CourseConstraintGroup>> = {
  grade: 'option',
  grade_mirror: 'option',
  grade_random: 'option',
  no_speed: 'speed',
  no_good: 'judge',
  no_great: 'judge',
  gauge_lr2: 'gauge',
  gauge_5k: 'gauge',
  gauge_7k: 'gauge',
  gauge_9k: 'gauge',
  gauge_24k: 'gauge',
  ln: 'longNote',
  cn: 'longNote',
  hcn: 'longNote',
};

/** beatoraja's enum constant names, which its `course/*.json` files carry, mapped to the table-header names. */
const ENUM_CONSTRAINTS: Readonly<Record<string, CourseConstraint>> = {
  CLASS: 'grade',
  MIRROR: 'grade_mirror',
  RANDOM: 'grade_random',
  NO_SPEED: 'no_speed',
  NO_GOOD: 'no_good',
  NO_GREAT: 'no_great',
  GAUGE_LR2: 'gauge_lr2',
  GAUGE_5KEYS: 'gauge_5k',
  GAUGE_7KEYS: 'gauge_7k',
  GAUGE_9KEYS: 'gauge_9k',
  GAUGE_24KEYS: 'gauge_24k',
  LN: 'ln',
  CN: 'cn',
  HCN: 'hcn',
};

/** beatoraja's enum constant name of a constraint (`grade_mirror` → `MIRROR`), as its `course/*.json` files write it. */
export function courseConstraintEnumName(constraint: CourseConstraint): string {
  return Object.keys(ENUM_CONSTRAINTS).find((name) => ENUM_CONSTRAINTS[name] === constraint)!;
}

/** The group a constraint belongs to: only one constraint per group applies. */
export function courseConstraintGroup(constraint: CourseConstraint): CourseConstraintGroup {
  return CONSTRAINT_GROUPS[constraint];
}

/**
 * Reads one constraint name, either the table-header form (`grade_mirror`) or beatoraja's enum constant
 * (`MIRROR`). Unknown names give `undefined`.
 */
export function parseCourseConstraint(name: string): CourseConstraint | undefined {
  if (Object.hasOwn(CONSTRAINT_GROUPS, name)) return name as CourseConstraint;
  return Object.hasOwn(ENUM_CONSTRAINTS, name) ? ENUM_CONSTRAINTS[name] : undefined;
}

/** Drops unknown names and keeps the first constraint of each group, as beatoraja's `CourseData.validate` does. */
export function normalizeCourseConstraints(names: readonly unknown[]): CourseConstraint[] {
  const seen = new Set<CourseConstraintGroup>();
  const constraints: CourseConstraint[] = [];
  for (const name of names) {
    const constraint = typeof name === 'string' ? parseCourseConstraint(name) : undefined;
    if (constraint === undefined) continue;
    const group = CONSTRAINT_GROUPS[constraint];
    if (seen.has(group)) continue;
    seen.add(group);
    constraints.push(constraint);
  }
  return constraints;
}

/** beatoraja's `CourseData.isClassCourse`: a lane-option constraint makes the course a dan course. */
export function isClassCourseConstraints(constraints: readonly CourseConstraint[]): boolean {
  return constraints.some((constraint) => CONSTRAINT_GROUPS[constraint] === 'option');
}

/** Keeps the trophies beatoraja accepts (`TrophyData.validate`): a name, a positive miss rate, a score rate below 100. */
export function normalizeCourseTrophies(values: readonly unknown[]): CourseTrophy[] {
  const trophies: CourseTrophy[] = [];
  for (const value of values) {
    if (value === null || typeof value !== 'object') continue;
    const { name, missrate, scorerate } = value as Record<string, unknown>;
    if (typeof name !== 'string' || typeof missrate !== 'number' || typeof scorerate !== 'number') continue;
    if (!(missrate > 0) || !(scorerate < 100)) continue;
    trophies.push({ name, missRate: missrate, scoreRate: scorerate });
  }
  return trophies;
}

const HEX_32 = /^[0-9a-f]{32}$/u;
const HEX_64 = /^[0-9a-f]{64}$/u;

/** A stage reference from loose `md5` / `sha256` / `title` / `artist` values, or `undefined` without a valid hash. */
export function createCourseStageRef(values: {
  md5?: unknown;
  sha256?: unknown;
  title?: unknown;
  artist?: unknown;
}): CourseStageRef | undefined {
  const stage: CourseStageRef = {};
  const md5 = typeof values.md5 === 'string' ? values.md5.trim().toLowerCase() : '';
  const sha256 = typeof values.sha256 === 'string' ? values.sha256.trim().toLowerCase() : '';
  if (HEX_32.test(md5)) stage.md5 = md5;
  if (HEX_64.test(sha256)) stage.sha256 = sha256;
  if (stage.md5 === undefined && stage.sha256 === undefined) return undefined;
  if (typeof values.title === 'string' && values.title.length > 0) stage.title = values.title;
  if (typeof values.artist === 'string' && values.artist.length > 0) stage.artist = values.artist;
  return stage;
}
