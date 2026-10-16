import { parseLr2NonstopConnections, type CourseKind, type NonstopConnection } from '@be-music/player/course';
import type { LibraryCourse } from '../library/entries.ts';

/** One stage of a course, as a skin shows it: the stage chart's title, subtitle, play level and difficulty. */
export interface CourseStageView {
  title: string;
  subtitle?: string;
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
      const chart = stage.song;
      const level = typeof chart?.playLevel === 'string' ? Number.parseInt(chart.playLevel, 10) : chart?.playLevel;
      const difficulty = chart?.chart.metadata.difficulty;
      return {
        title: chart?.title ?? stage.title,
        ...(chart?.subtitle !== undefined ? { subtitle: chart.subtitle } : {}),
        ...(level !== undefined && Number.isFinite(level) ? { level } : {}),
        ...(difficulty !== undefined && Number.isFinite(difficulty) ? { difficulty } : {}),
      };
    }),
    ...(stageIndex !== undefined ? { stageIndex } : {}),
    ...(course.definition.kind === 'nonstop'
      ? {
          connections:
            course.definition.source.format === 'lr2crs'
              ? parseLr2NonstopConnections(course.definition.source.header).slice(0, 9)
              : (course.definition.connections ?? []),
        }
      : {}),
  };
}
