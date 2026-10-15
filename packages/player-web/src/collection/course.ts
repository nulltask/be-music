import { resolveChart } from '@be-music/chart';
import type { BeMusicJson } from '@be-music/json';
import {
  drawRandomCourse,
  isClassCourseConstraints,
  parseBeatorajaCommandFolderFile,
  parseBeatorajaCourseFile,
  parseCourseSongFilter,
  parseLr2CourseFile,
  resolveCourseStages,
  type CourseChartLookup,
  type CourseConstraint,
  type CourseDefinition,
  type CourseSongRecord,
  type RandomCourseDefinition,
  type RandomCourseDrawFailure,
} from '@be-music/player/course';
import type { PlaylogCourseStage } from '@be-music/player/playlog';
import type { BeMusicGaugeType, BeMusicHiddenSudden } from '../skin/be-music/types.ts';
import { resolveChartBpmRange } from '../chart/bpm-range.ts';
import { resolveChartPlayVariant } from './collection.ts';
import type { BrowserCourseEntry, BrowserFolderNode, BrowserSongEntry } from './types.ts';

/** A course file's courses, under the label its folder bar shows. */
export interface CourseDefinitionGroup {
  label: string;
  courses: readonly CourseDefinition[];
  /** beatoraja random courses, listed after the fixed ones; their stages are drawn when one is started. */
  randomCourses?: readonly RandomCourseDefinition[];
}

function isUnderFolder(lowerPath: string, folder: string): boolean {
  return lowerPath.startsWith(`${folder}/`) || lowerPath.includes(`/${folder}/`);
}

/** beatoraja's command-folder file (`folder/default.json`), which holds its random courses. */
function isCommandFolderPath(lowerPath: string): boolean {
  return lowerPath.endsWith('.json') && isUnderFolder(lowerPath, 'folder') && !isUnderFolder(lowerPath, 'course');
}

/**
 * The course formats a host reads from dropped files: LR2's `.lr2crs`, beatoraja's `course/*.json` and beatoraja's
 * command-folder file `folder/default.json`, which holds its random courses.
 */
export function isCourseFilePath(path: string): boolean {
  const lower = path.toLowerCase().replaceAll('\\', '/');
  if (lower.endsWith('.lr2crs')) return true;
  // beatoraja keeps course files in a `course` folder and command folders in a `folder` folder; any other JSON (skins,
  // bmson metadata) is not a course.
  return (lower.endsWith('.json') && isUnderFolder(lower, 'course')) || isCommandFolderPath(lower);
}

/**
 * Reads one dropped course file into the course groups its folder bars show. `.lr2crs` is LR2's XML course list and a
 * `course/*.json` a beatoraja course file, each one group labelled with the file's name (without extension). A
 * `folder/*.json` is beatoraja's command-folder file: one group per command folder that holds random courses, under the
 * folder's name. A file without a valid course gives no group.
 */
export function readCourseFile(path: string, bytes: Uint8Array): CourseDefinitionGroup[] {
  const normalized = path.replaceAll('\\', '/');
  if (isCommandFolderPath(normalized.toLowerCase())) {
    return parseBeatorajaCommandFolderFile(bytes).map((folder) => ({
      label: folder.name,
      courses: [],
      randomCourses: folder.courses,
    }));
  }
  const name = normalized.split('/').at(-1) ?? normalized;
  const isLr2 = name.toLowerCase().endsWith('.lr2crs');
  const courses = isLr2 ? parseLr2CourseFile(bytes) : parseBeatorajaCourseFile(bytes);
  if (courses.length === 0) return [];
  return [{ label: name.replace(/\.(lr2crs|json)$/iu, ''), courses }];
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
 * A course with its stages matched to local charts: a stage not in the collection keeps the course file's title for it
 * (or a placeholder) and makes the course unplayable.
 */
export function resolveCourseEntry(
  id: string,
  definition: CourseDefinition,
  lookup: CourseChartLookup<BrowserSongEntry>,
): BrowserCourseEntry {
  const resolved = resolveCourseStages(definition, lookup);
  return {
    id,
    definition,
    stages: resolved.stages.map((stage) => ({
      title: stage.chart?.title ?? stage.ref.title ?? 'NOT FOUND',
      ...(stage.chart !== undefined ? { song: stage.chart } : {}),
    })),
    playable: resolved.playable,
  };
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
    .filter((group) => group.courses.length + (group.randomCourses?.length ?? 0) > 0)
    .map((group): BrowserFolderNode => ({
      label: group.label,
      songs: [],
      courses: [
        ...group.courses.map((definition, index) => resolveCourseEntry(`${group.label}#${index}`, definition, lookup)),
        ...(group.randomCourses ?? []).map((random, index) =>
          createRandomCourseEntry(`${group.label}#r${index}`, random),
        ),
      ],
    }));
}

/**
 * The course bar of a beatoraja random course: the course's name, kind and constraints with no stage drawn yet, and
 * each stage shown by its title, else its filter, else `RANDOM`. It is playable when every stage filter can be
 * evaluated; whether each stage finds a chart is only known when it is drawn ({@link drawBrowserRandomCourse}).
 */
export function createRandomCourseEntry(id: string, random: RandomCourseDefinition): BrowserCourseEntry {
  return {
    id,
    definition: {
      name: random.name,
      kind: isClassCourseConstraints(random.constraints) ? 'grade' : 'expert',
      stages: [],
      constraints: random.constraints,
      trophies: random.trophies,
      release: false,
      source: { format: 'beatoraja-random' },
    },
    stages: random.stages.map((stage) => ({ title: stage.title ?? stage.filter ?? 'RANDOM' })),
    playable:
      random.stages.length > 0 &&
      random.stages.every((stage) => stage.filter === undefined || parseCourseSongFilter(stage.filter).ok),
    random,
  };
}

/** beatoraja's `Mode.id` for each play variant (24 keys is 25, 24 keys double 50). */
const MODE_IDS = { '5': 5, '7': 7, '9': 9, '10': 10, '14': 14, '24': 25, '48': 50 } as const;

type ResolvedChart = ReturnType<typeof resolveChart>;

/**
 * A song as a random-course filter sees it (`CourseSongRecord`), with the song itself under `song`. Text columns,
 * `level`, `difficulty`, `notes` and `judge` are read up front; `mode`, `minbpm` / `maxbpm`, `length` and `feature`
 * need the chart resolved and are worked out on first read, so a filter that never names them costs nothing.
 *
 * `feature` carries the long-note bits (LN / CN / HCN by the chart's long-note mode, `UNDEFINEDLN` when the chart names
 * none), mines, `#RANDOM`, STOP and scroll changes. `content` is not filled, so it reads as 0.
 */
export function createCourseSongRecord(
  song: BrowserSongEntry,
  hashes: { md5?: string; sha256?: string } = {},
): CourseSongRecord & { readonly song: BrowserSongEntry } {
  const { chart } = song;
  const level = typeof song.playLevel === 'number' ? song.playLevel : Number.parseInt(String(song.playLevel ?? ''), 10);
  const subartist = chart.metadata.extras.SUBARTIST ?? chart.bmson.info.subartists?.join(' ');
  const record: CourseSongRecord & { song: BrowserSongEntry } = {
    song,
    title: song.title,
    path: song.chartPath,
    level: Number.isFinite(level) ? Math.trunc(level) : 0,
    difficulty: Math.trunc(chart.metadata.difficulty ?? 0) || 0,
    notes: song.totalNotes,
    judge: Math.trunc(chart.metadata.rank ?? 0) || 0,
    ...(hashes.md5 !== undefined ? { md5: hashes.md5.toLowerCase() } : {}),
    ...(hashes.sha256 !== undefined ? { sha256: hashes.sha256.toLowerCase() } : {}),
    ...(song.subtitle !== undefined ? { subtitle: song.subtitle } : {}),
    ...(song.artist !== undefined ? { artist: song.artist } : {}),
    ...(subartist !== undefined ? { subartist } : {}),
    ...(song.genre !== undefined ? { genre: song.genre } : {}),
  };
  let resolved: ResolvedChart | undefined;
  const resolve = (): ResolvedChart => (resolved ??= resolveChart(chart));
  const lazy = (key: keyof CourseSongRecord, read: () => number): void => {
    let value: number | undefined;
    Object.defineProperty(record, key, { enumerable: true, get: () => (value ??= read()) });
  };
  lazy('mode', () => MODE_IDS[resolveChartPlayVariant(song)]);
  lazy('minbpm', () => Math.trunc(resolveChartBpmRange(chart).min));
  lazy('maxbpm', () => Math.trunc(resolveChartBpmRange(chart).max));
  lazy('length', () => {
    const last = resolve().sortedEvents.at(-1);
    return last === undefined ? 0 : Math.trunc(resolve().timing.eventToSeconds(last) * 1000);
  });
  lazy('feature', () => songFeatureBits(chart, resolve()));
  return record;
}

/** beatoraja's `SongData.FEATURE_*` bits that the resolved chart shows. */
function songFeatureBits(chart: BeMusicJson, resolved: ResolvedChart): number {
  let feature = 0;
  if (resolved.notes.some((note) => note.kind === 'ln')) {
    const named = chart.sourceFormat === 'bms' ? chart.bms.lnMode : chart.bmson.info.lnType || undefined;
    feature |= named === 2 ? 16 : named === 3 ? 32 : named === 1 ? 8 : 1;
  }
  if (resolved.mines.length > 0) feature |= 2;
  if (resolved.hasUnresolvedControlFlow) feature |= 4;
  if (resolved.timing.stopPoints.length > 0) feature |= 64;
  if (resolved.scroll.some((point) => point.speed !== 1)) feature |= 128;
  return feature;
}

/**
 * Draws a random course's stages from the collection (`drawRandomCourse`) and returns the course bar to play: a fixed
 * course whose stages are the drawn songs. `candidates` are the collection's songs with their chart-file hashes, as
 * {@link createSongHashLookup} takes them; a song without a hash is never drawn. `random` returns values in `[0, 1)`.
 * A course without `random` is returned as it is.
 */
export function drawBrowserRandomCourse(
  entry: BrowserCourseEntry,
  candidates: Iterable<{ song: BrowserSongEntry; sha256?: string; md5?: string }>,
  random: () => number,
): { ok: true; course: BrowserCourseEntry } | RandomCourseDrawFailure {
  if (entry.random === undefined) return { ok: true, course: entry };
  const records = Array.from(candidates, ({ song, md5, sha256 }) =>
    createCourseSongRecord(song, {
      ...(md5 !== undefined ? { md5 } : {}),
      ...(sha256 !== undefined ? { sha256 } : {}),
    }),
  );
  const drawn = drawRandomCourse(entry.random, records, random);
  if (!drawn.ok) return drawn;
  return {
    ok: true,
    course: {
      id: entry.id,
      definition: drawn.course,
      stages: drawn.songs.map(({ song }) => ({ title: song.title, song })),
      playable: true,
    },
  };
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

/** The lane options of a play: each side's lane option and DP FLIP. */
export interface CourseLaneOptions {
  random1P: CourseLaneOption;
  random2P: CourseLaneOption;
  dpFlip: boolean;
}

/** beatoraja's random options up to index 5 (`grade_random` keeps them): here all but SCATTER. */
function isPlainRandomFamily(option: CourseLaneOption): boolean {
  return option !== 'SCATTER';
}

/**
 * The lane options a course allows in place of the ones the player picked (beatoraja `MusicSelector._readCourse`):
 *
 * - `grade` turns both sides and DP FLIP off;
 * - `grade_mirror` keeps a 1P MIRROR and then plays 2P on MIRROR with FLIP on; any other 1P pick turns both sides and
 *   FLIP off;
 * - `grade_random` keeps the plain random family (beatoraja's options up to index 5: MIRROR, RANDOM, S-RANDOM here) on
 *   each side, turns anything else off, and leaves FLIP alone.
 *
 * A course without a lane-option constraint keeps the picks.
 */
export function resolveCourseLaneOptions(
  constraints: readonly CourseConstraint[],
  picked: CourseLaneOptions,
): CourseLaneOptions {
  const off: CourseLaneOptions = { random1P: 'OFF', random2P: 'OFF', dpFlip: false };
  if (constraints.includes('grade')) return off;
  if (constraints.includes('grade_mirror')) {
    return picked.random1P === 'MIRROR' ? { random1P: 'MIRROR', random2P: 'MIRROR', dpFlip: true } : off;
  }
  if (constraints.includes('grade_random')) {
    return {
      random1P: isPlainRandomFamily(picked.random1P) ? picked.random1P : 'OFF',
      random2P: isPlainRandomFamily(picked.random2P) ? picked.random2P : 'OFF',
      dpFlip: picked.dpFlip,
    };
  }
  return { ...picked };
}

/**
 * Whether a course is an LR2 GRADE course: one read from a `.lr2crs` file or made with the course maker. LR2 resets
 * the player's play options when such a course starts ({@link resolveLr2GradeCoursePlaySettings}); a difficulty
 * table's grade or a beatoraja course is not one.
 */
export function isLr2GradeCourse(definition: Pick<CourseDefinition, 'kind' | 'source'>): boolean {
  return definition.kind === 'grade' && definition.source.format === 'lr2crs';
}

/** The play settings LR2 resets when a GRADE course starts. */
export interface Lr2GradeResetSettings {
  gauge: BeMusicGaugeType;
  hiddenSudden1P: BeMusicHiddenSudden;
  hiddenSudden2P: BeMusicHiddenSudden;
  autoScratch1P: boolean;
  autoScratch2P: boolean;
  dpFlip: boolean;
  /** The play tempo (1 = the chart's own). */
  tempo: number;
}

/**
 * The settings an LR2 GRADE course plays its stages with (OpenLR2 `Main.cpp` M1124-M1170, which LR2 applies when the
 * course starts): an EASY gauge pick plays on GROOVE (LR2 also moves G-ATTACK there), HIDDEN / SUDDEN, the assists (auto
 * scratch), DP FLIP and the play tempo (LR2's pitch) are turned off. A course that is not an LR2 GRADE course
 * ({@link isLr2GradeCourse}) keeps the settings. The lane options are reset by the course's `grade` constraint
 * ({@link resolveCourseLaneOptions}). LR2 writes the resets into its config; a host applies them to the course's
 * stages only, so the player's own settings come back afterwards.
 */
export function resolveLr2GradeCoursePlaySettings<T extends Lr2GradeResetSettings>(
  definition: Pick<CourseDefinition, 'kind' | 'source'>,
  settings: T,
): T {
  // Spread over `settings` so the other fields a host carries along pass through.
  if (!isLr2GradeCourse(definition)) return settings;
  return {
    ...settings,
    gauge: settings.gauge === 'EASY' ? 'GROOVE' : settings.gauge,
    hiddenSudden1P: 'OFF',
    hiddenSudden2P: 'OFF',
    autoScratch1P: false,
    autoScratch2P: false,
    dpFlip: false,
    tempo: 1,
  };
}

/** Whether the course forbids changing the hi-speed during play (`no_speed`). */
export function isCourseHiSpeedLocked(constraints: readonly CourseConstraint[]): boolean {
  return constraints.includes('no_speed');
}

/** Moved to `@be-music/player/course`; re-exported here for the hosts that import it from the collection. */
export { applyCourseLongNoteConstraint } from '@be-music/player/course';
