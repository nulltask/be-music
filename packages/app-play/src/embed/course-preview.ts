import { playerText } from '../player-copy.ts';
import {
  computeChartFileHashes,
  createChartHashLookup,
  loadAssetBytes,
  readCourseFile,
  resolveChartSource,
  resolveCourseEntry,
  type BrowserChartCollection,
} from '@be-music/player-browser/collection';
import type { PlaySceneCourse, PlaySceneSettings } from '@be-music/player-browser/host';
import {
  CourseRun,
  isCourseHiSpeedLocked,
  resolveCourseStageSettings,
  type CourseRunStagePlan,
} from '@be-music/player-engine/course';
import {
  resolveCourseView,
  type LibraryChart,
  type LibraryCourse,
  type PlayResult,
} from '@be-music/player-scene-model';

/** The same separator and case rules as `?chart=`. */
function normalizeCoursePath(path: string): string {
  return path
    .trim()
    .replaceAll('\\', '/')
    .replace(/^(?:\.\/|\/)+/u, '')
    .toLowerCase();
}

/** Reads only the named course file; a root-level beatoraja JSON is valid when explicitly selected. */
export async function loadEmbedCourses(collection: BrowserChartCollection, query: string): Promise<LibraryCourse[]> {
  const wanted = normalizeCoursePath(query);
  const matches = collection.sources.flatMap((source) =>
    [...source.files.keys()]
      .filter((path) => {
        const candidate = normalizeCoursePath(path);
        return wanted !== '' && (candidate === wanted || candidate.endsWith(`/${wanted}`));
      })
      .map((path) => ({ source, path })),
  );
  const exact = matches.filter(({ path }) => normalizeCoursePath(path) === wanted);
  const found = exact.length > 0 ? exact : matches;
  if (found.length === 0) throw new Error(`Course file not found: ${query}`);
  if (found.length > 1) throw new Error(`More than one course file matches ${query}; specify its full path.`);
  const { source, path } = found[0]!;
  if (!/\.(lr2crs|json)$/iu.test(path)) throw new Error(playerText().embed.badCourseFile);
  const bytes = await loadAssetBytes(source.files.get(path));
  if (bytes === undefined) throw new Error(`Could not read the course file: ${path}`);
  const groups = readCourseFile(path, bytes);
  const definitions = groups.flatMap((group) => group.courses);
  if (definitions.length === 0) throw new Error(`The file holds no valid fixed course: ${path}`);
  const candidates = await Promise.all(
    collection.charts.map(async (chart) => ({
      chart,
      ...(await computeChartFileHashes(resolveChartSource(collection, chart), chart.chartPath)),
    })),
  );
  const lookup = createChartHashLookup(candidates);
  return definitions.map((definition, index) =>
    resolveCourseEntry(`${source.id}/${path}#${index}`, definition, lookup),
  );
}

/** Course context shared by staged previews and the one stitched NONSTOP play. */
export function previewCourseOptions(
  course: LibraryCourse,
  plan?: CourseRunStagePlan<LibraryChart>,
): {
  course: PlaySceneCourse;
  settings: PlaySceneSettings;
} {
  return {
    course: {
      stage: plan?.course ?? resolveCourseStageSettings(course.definition),
      view: resolveCourseView(course, plan?.index ?? 0),
    },
    settings: { hiSpeedLocked: plan?.hiSpeedLocked ?? isCourseHiSpeedLocked(course.definition.constraints) },
  };
}

/** EXPERT / GRADE playback without result screens or retained replays; the engine carries gauge and combo. */
export class PreviewCourseRun {
  private readonly run: CourseRun<LibraryChart>;
  public readonly course: LibraryCourse;
  public constructor(course: LibraryCourse) {
    this.course = course;
    this.run = new CourseRun(
      course.definition,
      course.stages.map((stage) => stage.chart),
    );
  }
  public next(): CourseRunStagePlan<LibraryChart> | undefined {
    return this.run.nextStage();
  }
  public finish(result: PlayResult): CourseRunStagePlan<LibraryChart> | undefined {
    this.run.recordStage(undefined, { stageOutcome: result.stageOutcome, practice: true });
    return this.next();
  }
}
