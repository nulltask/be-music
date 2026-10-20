import type { BestRecord } from '@be-music/player/records';
import type { ClearLamp } from '@be-music/player/ruleset';

/**
 * The library a select screen browses, as `@be-music/scene-model` defines it: a chart (`LibraryChart`, with where it
 * came from as `ChartSourceKind`), a folder bar (`LibraryFolder`: a chart folder's `charts`, or a course folder's
 * `courses`), a course and its stages (`LibraryCourse`, `LibraryCourseStage`, each stage naming the local `chart` it
 * resolved to), and one bar of the select list (`LibraryEntry`: `{ kind: 'folder', folder }`,
 * `{ kind: 'chart', chart }` or `{ kind: 'course', course }`).
 */
export type {
  ChartSourceKind,
  LibraryChart,
  LibraryCourse,
  LibraryCourseStage,
  LibraryEntry,
  LibraryFolder,
} from '@be-music/scene-model';

/** A song image a host can hand a skin: the chart's `#STAGEFILE`, `#BANNER`, or `#BACKBMP`. */
export type BeMusicSongImageKind = 'stageFile' | 'banner' | 'backBMP';

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
