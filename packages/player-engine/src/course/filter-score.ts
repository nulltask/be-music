import type { BestRecord } from '../records/best-record.ts';
import type { ClearLamp } from '../ruleset/clear-lamp.ts';
import type { CourseChartScore } from './filter.ts';

/**
 * beatoraja's `ClearType.id` for each lamp: ASSIST EASY is AssistEasy (2) and LIGHT ASSIST EASY is LightAssistEasy (3).
 */
const BEATORAJA_CLEAR_TYPES: Readonly<Record<ClearLamp, number>> = {
  NO_PLAY: 0,
  FAILED: 1,
  ASSIST_EASY: 2,
  LIGHT_ASSIST_EASY: 3,
  EASY: 4,
  NORMAL: 5,
  HARD: 6,
  EX_HARD: 7,
  FULL_COMBO: 8,
  PERFECT: 9,
  MAX: 10,
};

/** A clear lamp as beatoraja's `ClearType.id`, the number its `score.clear` column holds. */
export function beatorajaClearType(lamp: ClearLamp): number {
  return BEATORAJA_CLEAR_TYPES[lamp] ?? 0;
}

/**
 * A best record as the `score` row a random-course filter reads (`CourseChartRecord.score`): the lamp in beatoraja's
 * numbering, the EX score, max combo, BP and play count, and the chart's note count when given. A field the record
 * lacks stays out, so it reads as NULL.
 */
export function createCourseChartScore(record: BestRecord, notes?: number): CourseChartScore {
  return {
    clear: beatorajaClearType(record.lamp),
    ...(record.exScore !== undefined ? { exscore: record.exScore } : {}),
    ...(record.maxCombo !== undefined ? { combo: record.maxCombo } : {}),
    ...(record.missCount !== undefined ? { minbp: record.missCount } : {}),
    ...(record.playCount !== undefined ? { playcount: record.playCount } : {}),
    ...(notes !== undefined ? { notes } : {}),
  };
}
