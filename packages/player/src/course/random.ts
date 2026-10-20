import {
  type CourseDefinition,
  type CourseStageRef,
  createCourseStageRef,
  isClassCourseConstraints,
  type RandomCourseDefinition,
} from './definition.ts';
import { type CourseSongRecord, parseCourseSongFilter, selectCourseSongs } from './filter.ts';

/** A drawn random course: the fixed course to play and the candidate drawn for each stage. */
export interface RandomCourseDrawSuccess<T> {
  ok: true;
  course: CourseDefinition;
  /** One per stage, in stage order. */
  songs: T[];
}

/** Why a random course could not be drawn: the first stage whose filter is invalid or selects no chart. */
export interface RandomCourseDrawFailure {
  ok: false;
  /** Zero-based stage index. */
  stage: number;
  reason: 'invalid-filter' | 'no-candidates';
  /** The parse error, for `invalid-filter`. */
  error?: string;
}

export type RandomCourseDrawResult<T> = RandomCourseDrawSuccess<T> | RandomCourseDrawFailure;

/** An index in `[0, length)` from a `[0, 1)` draw, as `java.util.Random.nextInt(length)` gives. */
function pick(random: () => number, length: number): number {
  const value = Math.floor(random() * length);
  return Number.isFinite(value) ? Math.min(length - 1, Math.max(0, value)) : 0;
}

/** The identity beatoraja's `distinct` compares: the chart's SHA-256 (MD5 for a record without one). */
function chartKey(record: CourseSongRecord): string {
  return record.sha256 !== undefined && record.sha256.length > 0 ? record.sha256.toLowerCase() : `md5:${record.md5}`;
}

/**
 * Draws one chart per stage of a random course, as beatoraja's `RandomCourseData.lotterySongDatas` does, and returns
 * the fixed course to play.
 *
 * - Each stage draws uniformly from the candidates its filter selects, after the filter's own `ORDER BY` / `LIMIT`
 *   ({@link selectCourseSongs}; `ORDER BY RANDOM()` draws from `random` first). A stage without a filter draws from
 *   every candidate when it is the first stage, and from the previous filter's selection otherwise.
 * - With `distinct`, a chart already drawn for an earlier stage is redrawn; when every candidate of the stage is taken,
 *   the stage falls back to any of them, so a chart can repeat (beatoraja does the same).
 * - A candidate without a valid `md5` / `sha256` cannot be a course stage and is never drawn.
 *
 * The course is a dan course (`grade`) when the definition has a lane-option constraint, else `expert`, and it is
 * never `release`d (beatoraja's `RandomCourseData.createCourseData`). Deterministic given `random`, which returns
 * values in `[0, 1)` like `Math.random`; candidates are taken in the order given.
 */
export function drawRandomCourse<T extends CourseSongRecord>(
  definition: RandomCourseDefinition,
  candidates: readonly T[],
  random: () => number,
): RandomCourseDrawResult<T> {
  const usable: Array<{ chart: T; ref: CourseStageRef }> = [];
  for (const chart of candidates) {
    const ref = createCourseStageRef(chart);
    if (ref !== undefined) usable.push({ chart, ref });
  }
  const drawn: Array<{ chart: T; ref: CourseStageRef }> = [];
  let lots = usable;
  for (const [index, stage] of definition.stages.entries()) {
    if (stage.filter !== undefined || index === 0) {
      if (stage.filter === undefined) {
        lots = usable;
      } else {
        const parsed = parseCourseSongFilter(stage.filter);
        if (!parsed.ok) return { ok: false, stage: index, reason: 'invalid-filter', error: parsed.error };
        lots = selectCourseSongs(parsed.query, usable, ({ chart }) => chart, random);
      }
    }
    if (lots.length === 0) return { ok: false, stage: index, reason: 'no-candidates' };
    drawn.push(definition.distinct ? drawDistinct(lots, drawn, random) : lots[pick(random, lots.length)]!);
  }
  return {
    ok: true,
    course: {
      name: definition.name,
      kind: isClassCourseConstraints(definition.constraints) ? 'grade' : 'expert',
      stages: drawn.map(({ ref }) => ref),
      constraints: [...definition.constraints],
      trophies: definition.trophies.map((trophy) => ({ ...trophy })),
      release: false,
      source: { format: 'beatoraja-random' },
    },
    songs: drawn.map(({ chart }) => chart),
  };
}

/** `RandomCourseData.lotterySongData` with `distinct`: redraw a repeat, and allow one once every candidate is taken. */
function drawDistinct<E extends { chart: CourseSongRecord }>(
  lots: readonly E[],
  drawn: readonly E[],
  random: () => number,
): E {
  const taken = new Set(drawn.map(({ chart }) => chartKey(chart)));
  const remaining = [...lots];
  while (remaining.length > 0) {
    const index = pick(random, remaining.length);
    const candidate = remaining[index]!;
    if (!taken.has(chartKey(candidate.chart))) return candidate;
    remaining.splice(index, 1);
  }
  return lots[pick(random, lots.length)]!;
}
