import { parseLr2NonstopConnections, type CourseKind, type NonstopConnection } from '@be-music/player/course';
import type { BrowserCourseEntry } from '../collection/types.ts';

/** One stage of a course, as a skin shows it: the stage chart's title, subtitle, play level and difficulty. */
export interface SceneCourseStageInfo {
  title: string;
  subtitle?: string;
  level?: number;
  /** The chart's `#DIFFICULTY` (1 BEGINNER … 5 INSANE); absent when the chart names none or is not in the collection. */
  difficulty?: number;
}

/**
 * The course a scene shows: on the select screen the course bar under the cursor, during a course the running course
 * and the stage being played. Skins read the course's kind, title and stage list from it (LR2 ops 280-293, numbers
 * 250-259 and texts 150-170; beatoraja's course strings and stage ops).
 */
export interface SceneCourseInfo {
  kind: CourseKind;
  title: string;
  stages: readonly SceneCourseStageInfo[];
  /** Zero-based stage being played; absent on the select screen and on the course result. */
  stageIndex?: number;
  /**
   * A NONSTOP course's connection after each of its first nine stages, as LR2's select screen lists them (texts
   * 171-179): from the `.lr2crs` header when the course came from one, else the course's connections.
   */
  connections?: readonly NonstopConnection[];
}

/** The {@link SceneCourseInfo} of a collection course, at `stageIndex` when one of its stages is being played. */
export function resolveSceneCourseInfo(course: BrowserCourseEntry, stageIndex?: number): SceneCourseInfo {
  return {
    kind: course.definition.kind,
    title: course.definition.name,
    stages: course.stages.map((stage): SceneCourseStageInfo => {
      const song = stage.song;
      const level = typeof song?.playLevel === 'string' ? Number.parseInt(song.playLevel, 10) : song?.playLevel;
      const difficulty = song?.chart.metadata.difficulty;
      return {
        title: song?.title ?? stage.title,
        ...(song?.subtitle !== undefined ? { subtitle: song.subtitle } : {}),
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
