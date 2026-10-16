import type { BestRecord } from '@be-music/player/records';
import type { ClearLamp } from '@be-music/player/ruleset';
import type {
  ChartSourceKind,
  LibraryChart,
  LibraryCourse,
  LibraryCourseStage,
  LibraryEntry,
  LibraryFolder,
} from '@be-music/scene-model';

/** Where a chart came from: a dropped directory, a zip, or loose files (`ChartSourceKind` of `@be-music/scene-model`). */
export type BrowserSongSourceKind = ChartSourceKind;

/** One chart in the library: its metadata and the parsed chart (`LibraryChart` of `@be-music/scene-model`). */
export type BrowserSongEntry = LibraryChart;

/**
 * One folder bar: a chart folder (`groupChartsByFolder`) or a course folder (`LibraryFolder` of
 * `@be-music/scene-model`).
 */
export type BrowserFolderNode = LibraryFolder;

/** One stage of a course in the library: the local chart it resolved to, if any (`LibraryCourseStage`). */
export type BrowserCourseStage = LibraryCourseStage;

/**
 * A course in the library: its definition with each stage matched to a local chart (`LibraryCourse` of
 * `@be-music/scene-model`). A course with a missing stage is listed but cannot be started.
 */
export type BrowserCourseEntry = LibraryCourse;

/**
 * One bar of the select list: folder bars at the root, chart bars inside a chart folder, course bars inside a course
 * folder (`LibraryEntry` of `@be-music/scene-model`).
 */
export type BrowserBrowseEntry = LibraryEntry;

/** A song image a host can hand a skin: the chart's `#STAGEFILE`, `#BANNER`, or `#BACKBMP`. */
export type BeMusicSongImageKind = 'stageFile' | 'banner' | 'backBmp';

/**
 * Clear lamp of a play or a best record, worst first: not played, failed, then the gauge the chart was cleared on
 * (ASSIST EASY … EX HARD), FULL COMBO (no BAD / POOR), PERFECT (no GOOD or worse), and MAX (every note a PGREAT). The
 * clear lamp of `@be-music/player/ruleset` (`ClearLamp`), which ranks them and lamps a play.
 */
export type BeMusicClearLamp = ClearLamp;

/**
 * The player's best record on one chart, as a host keeps it: the best lamp, EX score, max combo and fewest BAD + POOR +
 * empty POOR, and the play count. The best record of `@be-music/player/records` (`BestRecord`), whose rules a host
 * keeps it by.
 */
export type BeMusicSongRecord = BestRecord;

/**
 * The player's best record on a course, as a host keeps it: the course's best lamp, EX score, max combo and BP over its
 * runs, plus the best trophy those bests earn (beatoraja's `GradeBar.getTrophy`, worked out from the best EX score and
 * the fewest BP, which may come from different runs).
 */
export interface BeMusicCourseRecord extends BeMusicSongRecord {
  /** The best trophy's name (e.g. `goldmedal`), when the course has trophies and the bests earn one. */
  trophy?: string;
}
