import { type CourseDefinition, type CourseKind, createCourseStageRef } from './definition.ts';
import { decodeCourseText, parseCourseXml } from './text.ts';

/**
 * LR2's course type numbers (OpenLR2: `INSERT INTO expert / nonstop / grade` for 0 / 1 / 2, and skin ops 291-293).
 */
const LR2_COURSE_KINDS: Readonly<Record<number, CourseKind>> = { 0: 'expert', 1: 'nonstop', 2: 'grade' };

/** LR2 reads at most ten stages from a course hash (OpenLR2 `LR2f.cpp` L18078-L18081). */
const LR2_MAX_COURSE_STAGES = 10;

/** The length of the metadata block that opens an LR2 course hash, and of each stage MD5 after it. */
const LR2_HASH_BLOCK = 32;

/**
 * Parses an LR2 `.lr2crs` file: an XML `<courselist>` of `<course>` elements, each with `title`, `line` (key mode),
 * `type` and `hash`. Field names are matched case-sensitively, as LR2 does.
 *
 * - `hash` is a 32-character header (char 10 is the course type) followed by one 32-character chart MD5 per stage;
 *   LR2 keeps the first ten.
 * - `type` 0 / 1 / 2 is EXPERT / NONSTOP / GRADE (OpenLR2). Without a `type` element the header's char 10 is used.
 * - A grade course gets beatoraja's reading of an LR2 grade: MIRROR allowed and the LR2 gauge
 *   (`grade_mirror`, `gauge_lr2`), the constraints jbmstable-parser gives a table's legacy `grade` list.
 *
 * Courses with no stage or an unknown type are skipped. Accepts raw bytes (decoded by {@link decodeCourseText}) or text.
 */
export function parseLr2CourseFile(input: Uint8Array | string): CourseDefinition[] {
  const root = parseCourseXml(typeof input === 'string' ? input : decodeCourseText(input));
  if (root === undefined || root.name !== 'courselist') return [];
  const courses: CourseDefinition[] = [];
  for (const element of root.children) {
    if (element.name !== 'course') continue;
    const field = (name: string): string | undefined =>
      element.children.find((child) => child.name === name)?.text.trim();
    const hash = (field('hash') ?? '').toLowerCase();
    const header = hash.slice(0, LR2_HASH_BLOCK);
    const typeText = field('type') ?? header[10];
    const type = typeText === undefined || typeText === '' ? Number.NaN : Number(typeText);
    const kind = LR2_COURSE_KINDS[type];
    if (kind === undefined) continue;
    const stageCount = Math.min(Math.floor(hash.length / LR2_HASH_BLOCK) - 1, LR2_MAX_COURSE_STAGES);
    const stages = [];
    for (let index = 0; index < stageCount; index += 1) {
      const start = LR2_HASH_BLOCK * (index + 1);
      const stage = createCourseStageRef({ md5: hash.slice(start, start + LR2_HASH_BLOCK) });
      if (stage !== undefined) stages.push(stage);
    }
    if (stages.length === 0 || stages.length !== stageCount) continue;
    const line = Number(field('line'));
    const course: CourseDefinition = {
      name: field('title') ?? '',
      kind,
      stages,
      constraints: kind === 'grade' ? ['grade_mirror', 'gauge_lr2'] : [],
      trophies: [],
      release: true,
      source: { format: 'lr2crs', type, header, hash },
    };
    if (Number.isInteger(line) && line > 0) course.keyMode = line;
    courses.push(course);
  }
  return courses;
}
