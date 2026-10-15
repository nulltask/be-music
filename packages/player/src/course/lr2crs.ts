import { type CourseDefinition, type CourseKind, createCourseStageRef, type NonstopConnection } from './definition.ts';
import { decodeCourseText, parseCourseXml } from './text.ts';

/**
 * LR2's course type numbers (OpenLR2: `INSERT INTO expert / nonstop / grade` for 0 / 1 / 2, and skin ops 291-293).
 */
const LR2_COURSE_KINDS: Readonly<Record<number, CourseKind>> = { 0: 'expert', 1: 'nonstop', 2: 'grade' };

/**
 * LR2 plays at most the first five stages of any course: its chart loader clamps the course's stage count to 1-5 on
 * every play, whatever the course type (`LR2body.exe` ParseBmsFile @0x4b0b0f), although a course bar lists up to ten.
 */
export const LR2_MAX_PLAYED_STAGES = 5;

/** The length of the metadata block that opens an LR2 course hash, and of each stage MD5 after it. */
const LR2_HASH_BLOCK = 32;

/** LR2's NONSTOP connections by their `courseKeys` digit (`0`-`5`). */
export const LR2_NONSTOP_CONNECTIONS: readonly NonstopConnection[] = [
  'fade',
  'fade-fit',
  'cut',
  'cut-fit',
  'blank1',
  'blank2',
];

/**
 * The NONSTOP connections an LR2 course hash header names: characters 0-9 (`courseKeys`, OpenLR2 `LR2f.cpp`
 * L18083-L18087), one per stage, each the connection after that stage. LR2 only ever writes `0`-`5` (its select-screen
 * buttons cycle through them); any other character reads as `fade`, LR2's default.
 */
export function parseLr2NonstopConnections(header: string): NonstopConnection[] {
  return Array.from({ length: 10 }, (_, index) => {
    const digit = header.charCodeAt(index) - 0x30;
    return LR2_NONSTOP_CONNECTIONS[digit] ?? 'fade';
  });
}

/**
 * Parses an LR2 `.lr2crs` file: an XML `<courselist>` of `<course>` elements, each with `title`, `line` (key mode),
 * `type` and `hash`. Field names are matched case-sensitively, as LR2 does.
 *
 * - `hash` is a 32-character header (char 10 is the course type) followed by one 32-character chart MD5 per stage;
 *   LR2 plays only the first five of any course ({@link LR2_MAX_PLAYED_STAGES}), so a course is read as those.
 * - `type` 0 / 1 / 2 is EXPERT / NONSTOP / GRADE (OpenLR2). Without a `type` element the header's char 10 is used.
 * - A NONSTOP course reads its connections from the header's chars 0-9 ({@link parseLr2NonstopConnections}).
 * - A grade course allows no lane option and plays on the LR2 gauge (`grade`, `gauge_lr2`): LR2 turns both sides'
 *   lane options off when a GRADE course starts (OpenLR2 `Main.cpp` M1124-M1125), along with the other resets a host
 *   applies (`isLr2GradeCourse`). A table's legacy `grade` list keeps jbmstable-parser's `grade_mirror`.
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
    // LR2 plays only a course's first five stages, so the course is read as those.
    const stageCount = Math.min(Math.floor(hash.length / LR2_HASH_BLOCK) - 1, LR2_MAX_PLAYED_STAGES);
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
      constraints: kind === 'grade' ? ['grade', 'gauge_lr2'] : [],
      trophies: [],
      release: true,
      source: { format: 'lr2crs', type, header, hash },
    };
    if (Number.isInteger(line) && line > 0) course.keyMode = line;
    if (kind === 'nonstop') course.connections = parseLr2NonstopConnections(header).slice(0, stages.length - 1);
    courses.push(course);
  }
  return courses;
}
