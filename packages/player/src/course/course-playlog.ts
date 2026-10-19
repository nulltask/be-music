import { computeChartFingerprint } from '@be-music/chart';
import type { BeMusicJson } from '@be-music/json';
import type { PlaylogCourseInfo } from '../playlog/course.ts';
import type { CourseDefinition } from './definition.ts';

/*
 * What the course runs (`CourseRun`, the NONSTOP pipeline) share when they write a course play log. Internal: not part
 * of `@be-music/player/course`.
 */

/** The course as its play log records it. */
export function resolvePlaylogCourseInfo(
  definition: Pick<CourseDefinition, 'name' | 'kind' | 'constraints' | 'trophies' | 'release'>,
): PlaylogCourseInfo {
  return {
    name: definition.name,
    kind: definition.kind,
    constraints: [...definition.constraints],
    trophies: definition.trophies.map((trophy) => ({ ...trophy })),
    ...(definition.release === false ? { release: false as const } : {}),
  };
}

/**
 * The chart fingerprint of a course stage's chart, as the recorder would record it had the stage been played: it names
 * the stage in the course play log and keys the course on the Leaderboard. `undefined` when the chart cannot be
 * fingerprinted.
 */
export function computeStageChartFingerprint(chart: BeMusicJson, chartPath: string | undefined): string | undefined {
  try {
    return computeChartFingerprint(chart, { chartPath });
  } catch {
    return undefined;
  }
}
