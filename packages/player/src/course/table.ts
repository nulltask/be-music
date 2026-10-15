import {
  type CourseDefinition,
  type CourseStageRef,
  createCourseStageRef,
  isClassCourseConstraints,
  normalizeCourseConstraints,
  normalizeCourseTrophies,
} from './definition.ts';

/** jbmstable-parser's default course name (`Course.name`). */
const DEFAULT_TABLE_COURSE_NAME = '新規段位';

/** beatoraja's `Mode` hints, as difficulty tables write them, by key count. */
const TABLE_MODE_KEYS: Readonly<Record<string, number>> = {
  'beat-5k': 5,
  'beat-7k': 7,
  'beat-10k': 10,
  'beat-14k': 14,
  'popn-5k': 5,
  'popn-9k': 9,
  'keyboard-24k': 24,
  'keyboard-24k-double': 48,
};

/** The key count a table's `mode` hint names (`beat-7k` → 7), or `undefined` for none or an unknown one. */
export function resolveTableModeKeys(mode: unknown): number | undefined {
  return typeof mode === 'string' && Object.hasOwn(TABLE_MODE_KEYS, mode) ? TABLE_MODE_KEYS[mode] : undefined;
}

function parseTableCourse(value: unknown, legacy: boolean, keyMode: number | undefined): CourseDefinition | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const data = value as Record<string, unknown>;
  const stages: CourseStageRef[] = [];
  if (!legacy && Array.isArray(data.charts)) {
    for (const chart of data.charts) {
      if (chart === null || typeof chart !== 'object') continue;
      const stage = createCourseStageRef(chart as Record<string, unknown>);
      // beatoraja drops the whole course when one of its charts has no hash (`SongData.validate`).
      if (stage === undefined) return undefined;
      stages.push(stage);
    }
  } else if (Array.isArray(data.md5)) {
    for (const md5 of data.md5) {
      if (typeof md5 !== 'string') continue;
      const stage = createCourseStageRef({ md5 });
      if (stage === undefined) return undefined;
      stages.push(stage);
    }
  }
  if (stages.length === 0) return undefined;
  const constraints = legacy
    ? normalizeCourseConstraints(['grade_mirror', 'gauge_lr2'])
    : normalizeCourseConstraints(Array.isArray(data.constraint) ? data.constraint : []);
  const course: CourseDefinition = {
    name: typeof data.name === 'string' ? data.name : DEFAULT_TABLE_COURSE_NAME,
    kind: isClassCourseConstraints(constraints) ? 'grade' : 'expert',
    stages,
    constraints,
    trophies: legacy ? [] : normalizeCourseTrophies(Array.isArray(data.trophy) ? data.trophy : []),
    release: true,
    source: { format: 'table', legacyGrade: legacy },
  };
  if (keyMode !== undefined) course.keyMode = keyMode;
  return course;
}

/**
 * The courses of a difficulty-table header (`header.json`), grouped as jbmstable-parser groups them: `course` as an
 * array of groups (`Course[][]`), or as one group (`Course[]`), or else the legacy `grade` list, whose courses all get
 * `grade_mirror` and `gauge_lr2`. A course reads its stages from `charts` (table elements, which may carry `sha256`)
 * or from `md5`; one whose charts lack a hash is skipped, as beatoraja does. Empty groups are dropped.
 */
export function parseTableHeaderCourses(header: unknown): CourseDefinition[][] {
  if (header === null || typeof header !== 'object' || Array.isArray(header)) return [];
  const data = header as Record<string, unknown>;
  const keyMode = resolveTableModeKeys(data.mode);
  const parseGroup = (group: readonly unknown[], legacy: boolean): CourseDefinition[] =>
    group.map((course) => parseTableCourse(course, legacy, keyMode)).filter((course) => course !== undefined);
  let groups: CourseDefinition[][] = [];
  if (Array.isArray(data.course) && data.course.length > 0) {
    groups = Array.isArray(data.course[0])
      ? data.course.filter(Array.isArray).map((group) => parseGroup(group, false))
      : [parseGroup(data.course, false)];
  } else if (Array.isArray(data.grade)) {
    groups = [parseGroup(data.grade, true)];
  }
  return groups.filter((group) => group.length > 0);
}
