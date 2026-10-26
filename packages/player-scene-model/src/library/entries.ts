import type { BeMusicJSON } from '@be-music/chart-source';
import type { CourseChartRecord, CourseDefinition, RandomCourseDefinition } from '@be-music/player-engine/course';

/*
 * The library a select screen browses: its charts, the folders they are grouped in and the courses. Types and fields
 * follow the glossary: a list entry is a chart, so a chart bar is `{ kind: 'chart', chart }`, a folder lists its
 * `charts` and a course stage names its `chart`.
 */

/** Where a chart of the library came from: a dropped directory, a zip, or loose files. */
export type ChartSourceKind = 'directory' | 'zip' | 'files';

/** One chart in the library: its metadata and the parsed chart. */
export interface LibraryChart {
  id: string;
  sourceId: string;
  sourceLabel: string;
  sourceKind: ChartSourceKind;
  chartPath: string;
  directoryLabel: string;
  fileLabel: string;
  title: string;
  subtitle?: string;
  artist?: string;
  genre?: string;
  playLevel?: number | string;
  bpm?: number;
  /** The notes a play scores: judged notes without FREE ZONE tails; mines and invisible objects are not notes. */
  totalNotes: number;
  chart: BeMusicJSON;
}

/**
 * One folder bar of the library. A chart folder (`groupChartsByFolder`) is labelled with the top-level directory of its
 * charts inside their source (falling back to the source label) and lists them in `charts`; a course folder (a course
 * file, or one group of a difficulty table's courses) lists courses instead.
 */
export interface LibraryFolder {
  label: string;
  charts: readonly LibraryChart[];
  /** A course folder lists courses instead of charts. */
  courses?: readonly LibraryCourse[];
}

/** One stage of a course in the library: the local chart it resolved to, if any. */
export interface LibraryCourseStage {
  /** The chart's title, or the course file's title for a stage that is not in the library. */
  title: string;
  chart?: LibraryChart;
}

/**
 * A course in the library: its definition (from `@be-music/player-engine/course`) with each stage matched to a local chart.
 * A course with a missing stage is listed but cannot be started.
 *
 * A beatoraja random course carries `random`: its stages are drawn from the library when it is started, so
 * `definition` has the course's name, kind and constraints but no stages yet, and each of `stages` has no `chart` and
 * shows the stage's title (or its filter, or `RANDOM`).
 */
export interface LibraryCourse {
  /** Stable within a session: the folder label and the course's index in it. */
  id: string;
  definition: CourseDefinition;
  stages: readonly LibraryCourseStage[];
  /** Every stage was found locally (for a random course: every stage filter can be evaluated). */
  playable: boolean;
  /** Set on a random course: the definition its stages are drawn from. */
  random?: RandomCourseDefinition;
  /**
   * LR2's NEW COURSE bar, closing a list of the player's own courses: deciding it starts making a course of
   * `definition.kind` (no stages yet). A host routes it through its course-select callback.
   */
  newCourse?: true;
  /** A course the player made: it can be renamed and deleted, and a NONSTOP one's connections edited. */
  editable?: true;
}

/**
 * One bar of the list a select screen shows: folder bars at the root, chart bars inside a chart folder (and at the root
 * while searching), course bars inside a course folder.
 */
export type LibraryEntry =
  | { kind: 'folder'; folder: LibraryFolder }
  | { kind: 'chart'; chart: LibraryChart }
  | { kind: 'course'; course: LibraryCourse };

/**
 * What a select screen browses: the library's charts, grouped into chart folders at the root, and its course folders,
 * listed after them. The browser player's chart collection is one.
 */
export interface Library {
  readonly charts: readonly LibraryChart[];
  readonly courseFolders?: readonly LibraryFolder[];
  /**
   * A chart as a chart filter search (`?…`) sees it: its song columns, best record and song information. Without it
   * the search reads what the library entry holds (`libraryChartFilterRecord`). Give a new function when what it reads
   * changes (a new best record): the list is derived again for it.
   */
  readonly chartFilterRecord?: (chart: LibraryChart) => CourseChartRecord;
}

/**
 * A key naming one bar of the list across rebuilds: a chart by its id, a folder by its label, a course by its id. A
 * restored browse state puts the cursor back on the bar with the key it saved (the glossary's focus key).
 */
export function libraryEntryKey(entry: LibraryEntry): string {
  switch (entry.kind) {
    case 'folder':
      return `folder:${entry.folder.label}`;
    case 'chart':
      return `chart:${entry.chart.id}`;
    case 'course':
      return `course:${entry.course.id}`;
  }
}
