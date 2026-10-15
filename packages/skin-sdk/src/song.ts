import type { BeMusicJson } from '@be-music/json';
import type { CourseDefinition, RandomCourseDefinition } from '@be-music/player/course';

/** Where a song came from: a dropped directory, a zip, or loose files. */
export type BrowserSongSourceKind = 'directory' | 'zip' | 'files';

/** One chart in the song collection: its metadata and the parsed chart. */
export interface BrowserSongEntry {
  id: string;
  sourceId: string;
  sourceLabel: string;
  sourceKind: BrowserSongSourceKind;
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
  chart: BeMusicJson;
}

/**
 * One folder of songs surfaced by `groupSongsByFolder`. The label is the human-readable folder name (top-level
 * directory inside the source, falling back to the source label) and `songs` are all the BMS charts whose
 * `directoryLabel` resolves to it.
 */
export interface BrowserFolderNode {
  label: string;
  songs: readonly BrowserSongEntry[];
  /** A course folder (a course file, or one group of a difficulty table's courses) lists courses instead of songs. */
  courses?: readonly BrowserCourseEntry[];
}

/** One stage of a course in the collection: the local chart it resolved to, if any. */
export interface BrowserCourseStage {
  /** The chart's title, or the course file's title for a stage that is not in the collection. */
  title: string;
  song?: BrowserSongEntry;
}

/**
 * A course in the collection: its definition (from `@be-music/player/course`) with each stage matched to a local
 * chart. A course with a missing stage is listed but cannot be started.
 *
 * A beatoraja random course carries `random`: its stages are drawn from the collection when it is started, so
 * `definition` has the course's name, kind and constraints but no stages yet, and each of `stages` has no `song` and
 * shows the stage's title (or its filter, or `RANDOM`).
 */
export interface BrowserCourseEntry {
  /** Stable within a session: the folder label and the course's index in it. */
  id: string;
  definition: CourseDefinition;
  stages: readonly BrowserCourseStage[];
  /** Every stage was found locally (for a random course: every stage filter can be evaluated). */
  playable: boolean;
  /** Set on a random course: the definition its stages are drawn from. */
  random?: RandomCourseDefinition;
}

/**
 * One entry in the bar list when navigating the song collection. A select view shows folder bars at the root and song
 * bars inside a song folder, or course bars inside a course folder.
 */
export type BrowserBrowseEntry =
  | { kind: 'folder'; folder: BrowserFolderNode }
  | { kind: 'song'; song: BrowserSongEntry }
  | { kind: 'course'; course: BrowserCourseEntry };

/** A song image a host can hand a skin: the chart's `#STAGEFILE`, `#BANNER`, or `#BACKBMP`. */
export type BeMusicSongImageKind = 'stageFile' | 'banner' | 'backBmp';

/**
 * Clear lamp of a play or a best record, worst first: not played, failed, then the gauge the chart was cleared on
 * (ASSIST EASY … EX HARD), FULL COMBO (no BAD / POOR), PERFECT (no GOOD or worse), and MAX (every note a PGREAT).
 */
export type BeMusicClearLamp =
  | 'NO_PLAY'
  | 'FAILED'
  | 'ASSIST_EASY'
  | 'EASY'
  | 'NORMAL'
  | 'HARD'
  | 'EX_HARD'
  | 'FULL_COMBO'
  | 'PERFECT'
  | 'MAX';

/** The player's best record on one chart, as a host keeps it. */
export interface BeMusicSongRecord {
  /** Best clear lamp so far. */
  lamp: BeMusicClearLamp;
  exScore?: number;
  maxCombo?: number;
  /** Fewest BAD + POOR. */
  missCount?: number;
  /** How many times the chart was played. */
  playCount?: number;
}
