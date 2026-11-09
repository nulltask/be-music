import { parseLR2NonstopConnections, type CourseKind, type NonstopConnection } from '@be-music/player-engine/course';
import { resolveLibraryChartDifficultyValue } from '../library/difficulty.ts';
import type { LibraryCourse } from '../library/entries.ts';

/**
 * One stage of a course, as a skin shows it: the stage chart's title, subtitle, artist, genre, play level and
 * difficulty.
 */
export interface CourseStageView {
  title: string;
  subtitle?: string;
  artist?: string;
  genre?: string;
  level?: number;
  /** The chart's `#DIFFICULTY` (1 BEGINNER … 5 INSANE); absent when the chart names none or is not in the library. */
  difficulty?: number;
}

/**
 * The course a screen shows: on the select screen the course bar under the cursor, during a course the running course
 * and the stage being played, on the result screen the course a stage or a run belongs to. Skins read the course's
 * kind, title and stage list from it (LR2 ops 280-293, numbers 250-259 and texts 150-170; beatoraja's course strings
 * and stage ops).
 */
export interface CourseView {
  kind: CourseKind;
  title: string;
  stages: readonly CourseStageView[];
  /** Zero-based stage being played; absent on the select screen and on a course run's result. */
  stageIndex?: number;
  /**
   * A NONSTOP course's connection after each of its first nine stages, as LR2's select screen lists them (texts
   * 171-179): from the `.lr2crs` header when the course came from one, else the course's connections.
   */
  connections?: readonly NonstopConnection[];
}

/** The {@link CourseView} of a library course, at `stageIndex` when one of its stages is being played. */
export function resolveCourseView(course: LibraryCourse, stageIndex?: number): CourseView {
  return {
    kind: course.definition.kind,
    title: course.definition.name,
    stages: course.stages.map((stage): CourseStageView => {
      const chart = stage.chart;
      const level = typeof chart?.playLevel === 'string' ? Number.parseInt(chart.playLevel, 10) : chart?.playLevel;
      const difficulty = chart !== undefined ? resolveLibraryChartDifficultyValue(chart) : undefined;
      return {
        title: chart?.title ?? stage.title,
        ...(chart?.subtitle !== undefined ? { subtitle: chart.subtitle } : {}),
        ...(chart?.artist !== undefined ? { artist: chart.artist } : {}),
        ...(chart?.genre !== undefined ? { genre: chart.genre } : {}),
        ...(level !== undefined && Number.isFinite(level) ? { level } : {}),
        ...(difficulty !== undefined && Number.isFinite(difficulty) ? { difficulty } : {}),
      };
    }),
    ...(stageIndex !== undefined ? { stageIndex } : {}),
    ...(course.definition.kind === 'nonstop'
      ? {
          connections:
            course.definition.source.format === 'lr2crs'
              ? parseLR2NonstopConnections(course.definition.source.header).slice(0, 9)
              : (course.definition.connections ?? []),
        }
      : {}),
  };
}

/** How long a course result's stage list stays at one position while it scrolls ({@link scrollCourseStages}). */
export const COURSE_STAGE_SCROLL_STEP_MS = 2000;

/**
 * A course run's result as its stage list shows at `elapsedMs` into the screen, when the course has more stages than
 * the skin has rows (`rows`: LR2's five, beatoraja's ten): the list scrolls up one stage every `stepMs` until its last
 * stage reaches the bottom row, then starts again from stage 1, so every stage is shown in turn. A course that fits, or
 * a stage being played (`stageIndex`, whose stage slots the skin marks), is returned as it is.
 */
export function scrollCourseStages(
  course: CourseView,
  elapsedMs: number,
  rows: number,
  stepMs: number = COURSE_STAGE_SCROLL_STEP_MS,
): CourseView {
  const positions = course.stages.length - Math.max(1, Math.floor(rows)) + 1;
  if (positions <= 1 || course.stageIndex !== undefined || !(stepMs > 0)) return course;
  const step = Number.isFinite(elapsedMs) ? Math.floor(Math.max(0, elapsedMs) / stepMs) : 0;
  const offset = step % positions;
  return offset === 0 ? course : { ...course, stages: course.stages.slice(offset) };
}
