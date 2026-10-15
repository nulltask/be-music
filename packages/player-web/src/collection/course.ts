import type { BeMusicJson } from '@be-music/json';
import {
  parseBeatorajaCourseFile,
  parseLr2CourseFile,
  resolveCourseStages,
  type CourseChartLookup,
  type CourseConstraint,
  type CourseDefinition,
} from '@be-music/player/course';
import type { PlaylogCourseStage } from '@be-music/player/playlog';
import type { BrowserCourseEntry, BrowserFolderNode, BrowserSongEntry } from './types.ts';

/** A course file's courses, under the label its folder bar shows. */
export interface CourseDefinitionGroup {
  label: string;
  courses: readonly CourseDefinition[];
}

/** The course formats a host reads from dropped files: LR2's `.lr2crs` and beatoraja's `course/*.json`. */
export function isCourseFilePath(path: string): boolean {
  const lower = path.toLowerCase().replaceAll('\\', '/');
  if (lower.endsWith('.lr2crs')) return true;
  // beatoraja keeps course files in a `course` folder; any other JSON (skins, bmson metadata) is not a course.
  return lower.endsWith('.json') && (lower.startsWith('course/') || lower.includes('/course/'));
}

/**
 * Reads one dropped course file into a group labelled with the file's name (without extension). `.lr2crs` is LR2's
 * XML course list; anything else is read as a beatoraja course file. A file without a valid course gives `undefined`.
 */
export function readCourseFile(path: string, bytes: Uint8Array): CourseDefinitionGroup | undefined {
  const name = path.replaceAll('\\', '/').split('/').at(-1) ?? path;
  const isLr2 = name.toLowerCase().endsWith('.lr2crs');
  const courses = isLr2 ? parseLr2CourseFile(bytes) : parseBeatorajaCourseFile(bytes);
  if (courses.length === 0) return undefined;
  return { label: name.replace(/\.(lr2crs|json)$/iu, ''), courses };
}

/** A song lookup by chart-file hash, for {@link resolveCourseFolders}. */
export function createSongHashLookup(
  songs: Iterable<{ song: BrowserSongEntry; sha256?: string; md5?: string }>,
): CourseChartLookup<BrowserSongEntry> {
  const bySha256 = new Map<string, BrowserSongEntry>();
  const byMd5 = new Map<string, BrowserSongEntry>();
  // The first song with a hash wins, so a chart dropped twice resolves to the copy loaded first.
  for (const { song, sha256, md5 } of songs) {
    const sha = sha256?.toLowerCase();
    const md = md5?.toLowerCase();
    if (sha !== undefined && !bySha256.has(sha)) bySha256.set(sha, song);
    if (md !== undefined && !byMd5.has(md)) byMd5.set(md, song);
  }
  return { bySha256: (hash) => bySha256.get(hash), byMd5: (hash) => byMd5.get(hash) };
}

/**
 * One folder bar per course group, each listing its courses with their stages matched to local charts. A stage not
 * in the collection keeps the course file's title for it (or a placeholder), and makes its course unplayable. Groups
 * with no course are dropped.
 */
export function resolveCourseFolders(
  groups: readonly CourseDefinitionGroup[],
  lookup: CourseChartLookup<BrowserSongEntry>,
): BrowserFolderNode[] {
  return groups
    .filter((group) => group.courses.length > 0)
    .map((group): BrowserFolderNode => ({
      label: group.label,
      songs: [],
      courses: group.courses.map((definition, index): BrowserCourseEntry => {
        const resolved = resolveCourseStages(definition, lookup);
        return {
          id: `${group.label}#${index}`,
          definition,
          stages: resolved.stages.map((stage) => ({
            title: stage.chart?.title ?? stage.ref.title ?? 'NOT FOUND',
            ...(stage.chart !== undefined ? { song: stage.chart } : {}),
          })),
          playable: resolved.playable,
        };
      }),
    }));
}

const GAUGE_SETS = { gauge_lr2: 'lr2', gauge_5k: '5k', gauge_7k: '7k', gauge_9k: '9k', gauge_24k: '24k' } as const;

/** The course settings every stage plays under (`PlayerOptions.course` without the carried-in state). */
export function resolveCourseStageSettings(definition: CourseDefinition): Omit<PlaylogCourseStage, 'carryIn'> {
  const settings: Omit<PlaylogCourseStage, 'carryIn'> = { kind: definition.kind };
  for (const constraint of definition.constraints) {
    if (Object.hasOwn(GAUGE_SETS, constraint)) settings.gaugeSet = GAUGE_SETS[constraint as keyof typeof GAUGE_SETS];
    if (constraint === 'no_good') settings.judge = 'no-good';
    if (constraint === 'no_great') settings.judge = 'no-great';
  }
  return settings;
}

/** The lane options a host offers, as the select screen names them. */
export type CourseLaneOption = 'OFF' | 'MIRROR' | 'RANDOM' | 'S-RANDOM' | 'SCATTER';

/**
 * The lane option a course allows in place of the one the player picked (beatoraja `MusicSelector._readCourse`):
 * `grade` forces OFF, `grade_mirror` keeps MIRROR and resets anything else to OFF, `grade_random` keeps the plain random
 * family (beatoraja's options up to index 5 — RANDOM and S-RANDOM here) and MIRROR. A course without a lane-option
 * constraint keeps the pick.
 */
export function resolveCourseLaneOption(
  constraints: readonly CourseConstraint[],
  picked: CourseLaneOption,
): CourseLaneOption {
  if (constraints.includes('grade')) return 'OFF';
  if (constraints.includes('grade_mirror')) return picked === 'MIRROR' ? 'MIRROR' : 'OFF';
  if (constraints.includes('grade_random')) return picked === 'SCATTER' ? 'OFF' : picked;
  return picked;
}

/** Whether the course forbids changing the hi-speed during play (`no_speed`). */
export function isCourseHiSpeedLocked(constraints: readonly CourseConstraint[]): boolean {
  return constraints.includes('no_speed');
}

/**
 * Applies a course's long-note constraint (`ln` / `cn` / `hcn`) to a stage chart that leaves its long-note mode
 * undefined, as beatoraja forces `lnmode` for such charts. A chart that names its own mode (`#LNMODE`, bmson `ln_type`)
 * keeps it. Returns the chart unchanged when nothing applies, else a copy.
 */
export function applyCourseLongNoteConstraint(
  json: BeMusicJson,
  constraints: readonly CourseConstraint[],
): BeMusicJson {
  const mode = constraints.includes('ln')
    ? 1
    : constraints.includes('cn')
      ? 2
      : constraints.includes('hcn')
        ? 3
        : undefined;
  if (mode === undefined) return json;
  if (json.sourceFormat === 'bms') {
    if (json.bms.lnMode !== undefined) return json;
    return { ...json, bms: { ...json.bms, lnMode: mode } };
  }
  const lnType = json.bmson.info.lnType;
  if (lnType !== undefined && lnType !== 0) return json;
  return { ...json, bmson: { ...json.bmson, info: { ...json.bmson.info, lnType: mode } } };
}
