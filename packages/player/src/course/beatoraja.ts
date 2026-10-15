import {
  type CourseDefinition,
  type CourseStageRef,
  createCourseStageRef,
  isClassCourseConstraints,
  normalizeCourseConstraints,
  normalizeCourseTrophies,
  type RandomCourseDefinition,
  type RandomCourseStage,
} from './definition.ts';
import { decodeCourseText } from './text.ts';

const DEFAULT_COURSE_NAME = 'No Course Title';

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * One beatoraja `CourseData` object, validated as `CourseData.validate` does: at least one stage, every stage with
 * an `md5` or a `sha256` (a missing title becomes `course N`), unknown constraints dropped and one kept per group.
 */
export function parseBeatorajaCourseData(value: unknown): CourseDefinition | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const data = value as Record<string, unknown>;
  const songs = asArray(data.hash);
  if (songs.length === 0) return undefined;
  const stages: CourseStageRef[] = [];
  for (const [index, song] of songs.entries()) {
    if (song === null || typeof song !== 'object') return undefined;
    const fields = song as Record<string, unknown>;
    const title = typeof fields.title === 'string' && fields.title.length > 0 ? fields.title : `course ${index + 1}`;
    const stage = createCourseStageRef({ ...fields, title });
    if (stage === undefined) return undefined;
    stages.push(stage);
  }
  const constraints = normalizeCourseConstraints(asArray(data.constraint));
  return {
    name: typeof data.name === 'string' && data.name.length > 0 ? data.name : DEFAULT_COURSE_NAME,
    kind: isClassCourseConstraints(constraints) ? 'grade' : 'expert',
    stages,
    constraints,
    trophies: normalizeCourseTrophies(asArray(data.trophy)),
    release: data.release !== false,
    source: { format: 'beatoraja-json' },
  };
}

/**
 * Parses a beatoraja `course/*.json` file: an array of `CourseData`, or a single object (beatoraja's fallback read).
 * Invalid courses are skipped; a file that is not JSON gives no course.
 */
export function parseBeatorajaCourseFile(input: Uint8Array | string): CourseDefinition[] {
  let json: unknown;
  try {
    json = JSON.parse(typeof input === 'string' ? input : decodeCourseText(input));
  } catch {
    return [];
  }
  const items = Array.isArray(json) ? json : [json];
  return items.map(parseBeatorajaCourseData).filter((course) => course !== undefined);
}

/**
 * One beatoraja `RandomCourseData` (an entry of a command folder's `rcourse` list): `name`, `stage[]` (`sql` and
 * `title`), `constraint`, `rconstraint` (`distinct`) and `trophy`. Stages keep their SQL filter as written;
 * `drawRandomCourse` draws the charts.
 */
export function parseBeatorajaRandomCourseData(value: unknown): RandomCourseDefinition | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const data = value as Record<string, unknown>;
  const stages = asArray(data.stage).map((stage): RandomCourseStage => {
    const fields = stage !== null && typeof stage === 'object' ? (stage as Record<string, unknown>) : {};
    const { sql, title } = fields;
    return {
      ...(typeof sql === 'string' && sql.trim().length > 0 ? { filter: sql.trim() } : {}),
      ...(typeof title === 'string' && title.length > 0 ? { title } : {}),
    };
  });
  if (stages.length === 0) return undefined;
  const rconstraints = asArray(data.rconstraint);
  return {
    name: typeof data.name === 'string' && data.name.length > 0 ? data.name : DEFAULT_COURSE_NAME,
    stages,
    constraints: normalizeCourseConstraints(asArray(data.constraint)),
    trophies: normalizeCourseTrophies(asArray(data.trophy)),
    distinct: rconstraints.some((name) => name === 'distinct' || name === 'DISTINCT'),
  };
}

/**
 * The random courses of one beatoraja command folder, under its name: nested folders joined with ` > `, and
 * `RANDOM COURSE` for a folder without a name.
 */
export interface BeatorajaRandomCourseFolder {
  name: string;
  courses: RandomCourseDefinition[];
}

function collectRandomCourseFolders(value: unknown, parents: string[], out: BeatorajaRandomCourseFolder[]): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
  const data = value as Record<string, unknown>;
  const path = typeof data.name === 'string' && data.name.length > 0 ? [...parents, data.name] : parents;
  // beatoraja reads `folder/default.json` with libGDX's `Json`, which maps keys onto field names: `rcourse`.
  const courses = asArray(data.rcourse)
    .map(parseBeatorajaRandomCourseData)
    .filter((course) => course !== undefined);
  if (courses.length > 0) out.push({ name: path.length > 0 ? path.join(' > ') : 'RANDOM COURSE', courses });
  for (const child of asArray(data.folder)) collectRandomCourseFolders(child, path, out);
}

/**
 * Reads beatoraja's command-folder file (`folder/default.json`, `BarManager.CommandFolder[]`) for its random
 * courses: each folder's `rcourse` list, nested `folder`s included. Folders without a random course (plain SQL folders)
 * are left out; a file that is not JSON gives none.
 */
export function parseBeatorajaCommandFolderFile(input: Uint8Array | string): BeatorajaRandomCourseFolder[] {
  let json: unknown;
  try {
    json = JSON.parse(typeof input === 'string' ? input : decodeCourseText(input));
  } catch {
    return [];
  }
  const folders: BeatorajaRandomCourseFolder[] = [];
  for (const folder of Array.isArray(json) ? json : [json]) collectRandomCourseFolders(folder, [], folders);
  return folders;
}
