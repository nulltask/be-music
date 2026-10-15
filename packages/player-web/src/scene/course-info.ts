import type { CourseKind } from '@be-music/player/course';
import type { BrowserCourseEntry } from '../collection/types.ts';

/** One stage of a course, as a skin shows it: the stage chart's title, subtitle and play level. */
export interface SceneCourseStageInfo {
  title: string;
  subtitle?: string;
  level?: number;
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
}

/** The {@link SceneCourseInfo} of a collection course, at `stageIndex` when one of its stages is being played. */
export function resolveSceneCourseInfo(course: BrowserCourseEntry, stageIndex?: number): SceneCourseInfo {
  return {
    kind: course.definition.kind,
    title: course.definition.name,
    stages: course.stages.map((stage): SceneCourseStageInfo => {
      const song = stage.song;
      const level = typeof song?.playLevel === 'string' ? Number.parseInt(song.playLevel, 10) : song?.playLevel;
      return {
        title: song?.title ?? stage.title,
        ...(song?.subtitle !== undefined ? { subtitle: song.subtitle } : {}),
        ...(level !== undefined && Number.isFinite(level) ? { level } : {}),
      };
    }),
    ...(stageIndex !== undefined ? { stageIndex } : {}),
  };
}
