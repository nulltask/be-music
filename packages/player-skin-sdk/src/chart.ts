import type { BestRecord } from '@be-music/player-engine/records';
import type { ClearLamp } from '@be-music/player-engine/ruleset';

/**
 * The library a select screen browses, as `@be-music/player-scene-model` defines it: a chart (`LibraryChart`, with where it
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
} from '@be-music/player-scene-model';

/** Chart artwork a host can hand a skin: loading, banner, background, or pre-play title image. */
export type BeMusicChartImageKind = 'stageFile' | 'banner' | 'backBMP' | 'titleImage';

/**
 * Clear lamp of a play or a best record, worst first: not played, failed, then the gauge the chart was cleared on
 * (ASSIST EASY … EX HARD), FULL COMBO (no BAD / POOR), PERFECT (no GOOD or worse), and MAX (every note a PGREAT). The
 * clear lamp of `@be-music/player-engine/ruleset` (`ClearLamp`), which ranks them and lamps a play.
 */
export type BeMusicClearLamp = ClearLamp;

/**
 * The player's best record on one chart, as a host keeps it: the best lamp, EX score, max combo and fewest BAD + POOR +
 * empty POOR, and the play count. The best record of `@be-music/player-engine/records` (`BestRecord`), whose rules a host
 * keeps it by.
 */
export type BeMusicChartBestRecord = BestRecord;

/**
 * The player's best record on a course, as a host keeps it: the course's best lamp, EX score, max combo and BP over its
 * runs, plus the best trophy those bests earn (beatoraja's `GradeBar.getTrophy`, worked out from the best EX score and
 * the fewest BP, which may come from different runs).
 */
export interface BeMusicCourseBestRecord extends BeMusicChartBestRecord {
  /** The best trophy's name (e.g. `goldmedal`), when the course has trophies and the bests earn one. */
  trophy?: string;
}
