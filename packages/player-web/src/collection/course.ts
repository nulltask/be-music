import { resolveChart } from '@be-music/chart';
import type { BeMusicJSON } from '@be-music/json';
import {
  drawRandomCourse,
  isClassCourseConstraints,
  parseBeatorajaCommandFolderFile,
  parseBeatorajaCourseFile,
  parseCourseChartFilter,
  parseLR2CourseFile,
  resolveCourseStages,
  type CourseChartLookup,
  type CourseDefinition,
  type CourseChartRecord,
  type RandomCourseDefinition,
  type RandomCourseDrawFailure,
} from '@be-music/player/course';
import {
  resolveLibraryChartPlayVariant,
  type LibraryChart,
  type LibraryCourse,
  type LibraryFolder,
} from '@be-music/scene-model';
import { resolveChartBPMRange } from '../chart/bpm-range.ts';

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
  const isLR2 = name.toLowerCase().endsWith('.lr2crs');
  const courses = isLR2 ? parseLR2CourseFile(bytes) : parseBeatorajaCourseFile(bytes);
  if (courses.length === 0) return [];
  return [{ label: name.replace(/\.(lr2crs|json)$/iu, ''), courses }];
}

/** A song lookup by chart-file hash, for {@link resolveCourseFolders}. */
export function createChartHashLookup(
  chartEntries: Iterable<{ chart: LibraryChart; sha256?: string; md5?: string }>,
): CourseChartLookup<LibraryChart> {
  const bySHA256 = new Map<string, LibraryChart>();
  const byMD5 = new Map<string, LibraryChart>();
  // The first song with a hash wins, so a chart dropped twice resolves to the copy loaded first.
  for (const { chart: chartEntry, sha256, md5 } of chartEntries) {
    const sha = sha256?.toLowerCase();
    const md = md5?.toLowerCase();
    if (sha !== undefined && !bySHA256.has(sha)) bySHA256.set(sha, chartEntry);
    if (md !== undefined && !byMD5.has(md)) byMD5.set(md, chartEntry);
  }
  return { bySHA256: (hash) => bySHA256.get(hash), byMD5: (hash) => byMD5.get(hash) };
}

/**
 * A course with its stages matched to local charts: a stage not in the collection keeps the course file's title for it
 * (or a placeholder) and makes the course unplayable.
 */
export function resolveCourseEntry(
  id: string,
  definition: CourseDefinition,
  lookup: CourseChartLookup<LibraryChart>,
): LibraryCourse {
  const resolved = resolveCourseStages(definition, lookup);
  return {
    id,
    definition,
    stages: resolved.stages.map((stage) => ({
      title: stage.chart?.title ?? stage.ref.title ?? 'NOT FOUND',
      ...(stage.chart !== undefined ? { chart: stage.chart } : {}),
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
  lookup: CourseChartLookup<LibraryChart>,
): LibraryFolder[] {
  return groups
    .filter((group) => group.courses.length + (group.randomCourses?.length ?? 0) > 0)
    .map((group): LibraryFolder => ({
      label: group.label,
      charts: [],
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
export function createRandomCourseEntry(id: string, random: RandomCourseDefinition): LibraryCourse {
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
      random.stages.every((stage) => stage.filter === undefined || parseCourseChartFilter(stage.filter).ok),
    random,
  };
}

/** beatoraja's `Mode.id` for each play variant (24 keys is 25, 24 keys double 50). */
const MODE_IDS = { '5': 5, '7': 7, '9': 9, '10': 10, '14': 14, '24': 25, '48': 50 } as const;

type ResolvedChart = ReturnType<typeof resolveChart>;

/**
 * A song as a random-course filter sees it (`CourseChartRecord`), with the song itself under `song`. Text columns,
 * `level`, `difficulty`, `notes` and `judge` are read up front; `mode`, `minbpm` / `maxbpm`, `length` and `feature`
 * need the chart resolved and are worked out on first read, so a filter that never names them costs nothing.
 *
 * `feature` carries the long-note bits (LN / CN / HCN by the chart's long-note mode, `UNDEFINEDLN` when the chart names
 * none), mines, `#RANDOM`, STOP and scroll changes. `content` is not filled, so it reads as 0.
 */
export function createCourseChartRecord(
  chartEntry: LibraryChart,
  hashes: { md5?: string; sha256?: string } = {},
): CourseChartRecord & { readonly chart: LibraryChart } {
  const { chart } = chartEntry;
  const level =
    typeof chartEntry.playLevel === 'number'
      ? chartEntry.playLevel
      : Number.parseInt(String(chartEntry.playLevel ?? ''), 10);
  const subartist = chart.metadata.extras.SUBARTIST ?? chart.bmson.info.subartists?.join(' ');
  const record: CourseChartRecord & { chart: LibraryChart } = {
    chart: chartEntry,
    title: chartEntry.title,
    path: chartEntry.chartPath,
    level: Number.isFinite(level) ? Math.trunc(level) : 0,
    difficulty: Math.trunc(chart.metadata.difficulty ?? 0) || 0,
    notes: chartEntry.totalNotes,
    judge: Math.trunc(chart.metadata.rank ?? 0) || 0,
    ...(hashes.md5 !== undefined ? { md5: hashes.md5.toLowerCase() } : {}),
    ...(hashes.sha256 !== undefined ? { sha256: hashes.sha256.toLowerCase() } : {}),
    ...(chartEntry.subtitle !== undefined ? { subtitle: chartEntry.subtitle } : {}),
    ...(chartEntry.artist !== undefined ? { artist: chartEntry.artist } : {}),
    ...(subartist !== undefined ? { subartist } : {}),
    ...(chartEntry.genre !== undefined ? { genre: chartEntry.genre } : {}),
  };
  let resolved: ResolvedChart | undefined;
  const resolve = (): ResolvedChart => (resolved ??= resolveChart(chart));
  const lazy = (key: keyof CourseChartRecord, read: () => number): void => {
    let value: number | undefined;
    Object.defineProperty(record, key, { enumerable: true, get: () => (value ??= read()) });
  };
  lazy('mode', () => MODE_IDS[resolveLibraryChartPlayVariant(chartEntry)]);
  lazy('minbpm', () => Math.trunc(resolveChartBPMRange(chart).min));
  lazy('maxbpm', () => Math.trunc(resolveChartBPMRange(chart).max));
  lazy('length', () => {
    const last = resolve().sortedEvents.at(-1);
    return last === undefined ? 0 : Math.trunc(resolve().timing.eventToSeconds(last) * 1000);
  });
  lazy('feature', () => songFeatureBits(chart, resolve()));
  return record;
}

/** beatoraja's `SongData.FEATURE_*` bits that the resolved chart shows. */
function songFeatureBits(chart: BeMusicJSON, resolved: ResolvedChart): number {
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
 * {@link createChartHashLookup} takes them; a song without a hash is never drawn. `random` returns values in `[0, 1)`.
 * A course without `random` is returned as it is.
 */
export function drawBrowserRandomCourse(
  entry: LibraryCourse,
  candidates: Iterable<{ chart: LibraryChart; sha256?: string; md5?: string }>,
  random: () => number,
): { ok: true; course: LibraryCourse } | RandomCourseDrawFailure {
  if (entry.random === undefined) return { ok: true, course: entry };
  const records = Array.from(candidates, ({ chart: chartEntry, md5, sha256 }) =>
    createCourseChartRecord(chartEntry, {
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
      stages: drawn.charts.map(({ chart: chartEntry }) => ({ title: chartEntry.title, chart: chartEntry })),
      playable: true,
    },
  };
}
