import { computeChartFingerprint } from '@be-music/chart-model';
import type { BeMusicJSON } from '@be-music/chart-source';
import type { ReplayCourseInfo } from '../replay/course.ts';
import type { CourseDefinition } from './definition.ts';

/*
 * What the course runs (`CourseRun`, the NONSTOP pipeline) share when they write a course replay. Internal: not part
 * of `@be-music/player-engine/course`.
 */

/** The course as its replay records it. */
export function resolveReplayCourseInfo(
  definition: Pick<CourseDefinition, 'name' | 'kind' | 'constraints' | 'trophies' | 'release'>,
): ReplayCourseInfo {
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
 * the stage in the course replay and keys the course on the Leaderboard. `undefined` when the chart cannot be
 * fingerprinted.
 */
export function computeStageChartFingerprint(chart: BeMusicJSON, chartPath: string | undefined): string | undefined {
  try {
    return computeChartFingerprint(chart, { chartPath });
  } catch {
    return undefined;
  }
}
