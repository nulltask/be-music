import type { GaugeType } from '../ruleset/gauge-type.ts';
import type { ReplayCourseStage } from '../replay/format.ts';
import type { CourseConstraint, CourseDefinition } from './definition.ts';

/*
 * The rules a course sets for each of its stages: the course settings the engine plays a stage under, the lane options
 * it allows, the hi-speed lock and LR2's GRADE resets. The long-note constraint is `applyCourseLongNoteConstraint`.
 */

const GAUGE_SETS = { gauge_lr2: 'lr2', gauge_5k: '5k', gauge_7k: '7k', gauge_9k: '9k', gauge_24k: '24k' } as const;

/** The course settings every stage plays under (`PlayerOptions.course` without the carried-in state). */
export function resolveCourseStageSettings(definition: CourseDefinition): Omit<ReplayCourseStage, 'carryIn'> {
  const settings: Omit<ReplayCourseStage, 'carryIn'> = { kind: definition.kind };
  for (const constraint of definition.constraints) {
    if (Object.hasOwn(GAUGE_SETS, constraint)) settings.gaugeSet = GAUGE_SETS[constraint as keyof typeof GAUGE_SETS];
    if (constraint === 'no_good') settings.judge = 'no-good';
    if (constraint === 'no_great') settings.judge = 'no-great';
  }
  return settings;
}

/** The lane options a host offers, as the select screen names them. */
export type CourseLaneOption =
  | 'OFF'
  | 'MIRROR'
  | 'RANDOM'
  | 'R-RANDOM'
  | 'S-RANDOM'
  | 'SPIRAL'
  | 'H-RANDOM'
  | 'ALL-SCR'
  | 'RANDOM-EX'
  | 'S-RANDOM-EX'
  | 'RANDOM_PLAYABLE'
  | 'S_RANDOM_PLAYABLE'
  | 'CONVERGE'
  | 'SCATTER'
  | 'SCATTER-CORRECTED';

/** The lane options of a play: each side's lane option and DP FLIP. */
export interface CourseLaneOptions {
  random1P: CourseLaneOption;
  random2P: CourseLaneOption;
  dpFlip: boolean;
}

/** beatoraja's random options up to index 5 (`grade_random` keeps them): OFF, MIRROR, RANDOM, R-RANDOM S-RANDOM and SPIRAL here. */
function isPlainRandomFamily(option: CourseLaneOption): boolean {
  return ['OFF', 'MIRROR', 'RANDOM', 'R-RANDOM', 'S-RANDOM', 'SPIRAL'].includes(option);
}

/**
 * The lane options a course allows in place of the ones the player picked (beatoraja `MusicSelector._readCourse`):
 *
 * - `grade` turns both sides and DP FLIP off;
 * - `grade_mirror` keeps a 1P MIRROR and then plays 2P on MIRROR with FLIP on; any other 1P pick turns both sides and
 *   FLIP off;
 * - `grade_random` keeps the plain random family (beatoraja's options up to index 5: MIRROR, RANDOM, S-RANDOM here) on
 *   each side, turns anything else off, and leaves FLIP alone.
 *
 * A course without a lane-option constraint keeps the picks.
 */
export function resolveCourseLaneOptions(
  constraints: readonly CourseConstraint[],
  picked: CourseLaneOptions,
): CourseLaneOptions {
  const off: CourseLaneOptions = { random1P: 'OFF', random2P: 'OFF', dpFlip: false };
  if (constraints.includes('grade')) return off;
  if (constraints.includes('grade_mirror')) {
    return picked.random1P === 'MIRROR' ? { random1P: 'MIRROR', random2P: 'MIRROR', dpFlip: true } : off;
  }
  if (constraints.includes('grade_random')) {
    return {
      random1P: isPlainRandomFamily(picked.random1P) ? picked.random1P : 'OFF',
      random2P: isPlainRandomFamily(picked.random2P) ? picked.random2P : 'OFF',
      dpFlip: picked.dpFlip,
    };
  }
  return { ...picked };
}

/**
 * Whether a course is an LR2 GRADE course: one read from a `.lr2crs` file or made with the course maker. LR2 resets
 * the player's play options when such a course starts ({@link resolveLR2GradeCoursePlaySettings}); a difficulty
 * table's grade or a beatoraja course is not one.
 */
export function isLR2GradeCourse(definition: Pick<CourseDefinition, 'kind' | 'source'>): boolean {
  return definition.kind === 'grade' && definition.source.format === 'lr2crs';
}

/** The play settings LR2 resets when a GRADE course starts. */
export interface LR2GradeResetSettings {
  gauge: GaugeType;
  /** Each side's lane cover, as the select screen names it. */
  hiddenSudden1P: 'OFF' | 'HIDDEN' | 'SUDDEN' | 'HID+SUD';
  hiddenSudden2P: 'OFF' | 'HIDDEN' | 'SUDDEN' | 'HID+SUD';
  autoScratch1P: boolean;
  autoScratch2P: boolean;
  dpFlip: boolean;
  /** The play tempo (1 = the chart's own). */
  tempo: number;
}

/**
 * The settings an LR2 GRADE course plays its stages with (OpenLR2 `Main.cpp` M1124-M1170, which LR2 applies when the
 * course starts): an EASY gauge pick plays on GROOVE (LR2 also moves G-ATTACK there), HIDDEN / SUDDEN, the assists (auto
 * scratch), DP FLIP and the play tempo (LR2's pitch) are turned off. A course that is not an LR2 GRADE course
 * ({@link isLR2GradeCourse}) keeps the settings. The lane options are reset by the course's `grade` constraint
 * ({@link resolveCourseLaneOptions}). LR2 writes the resets into its config; a host applies them to the course's
 * stages only, so the player's own settings come back afterwards.
 */
export function resolveLR2GradeCoursePlaySettings<T extends LR2GradeResetSettings>(
  definition: Pick<CourseDefinition, 'kind' | 'source'>,
  settings: T,
): T {
  // Spread over `settings` so the other fields a host carries along pass through.
  if (!isLR2GradeCourse(definition)) return settings;
  return {
    ...settings,
    gauge: settings.gauge === 'EASY' ? 'GROOVE' : settings.gauge,
    hiddenSudden1P: 'OFF',
    hiddenSudden2P: 'OFF',
    autoScratch1P: false,
    autoScratch2P: false,
    dpFlip: false,
    tempo: 1,
  };
}

/** Whether the course forbids changing the hi-speed during play (`no_speed`). */
export function isCourseHiSpeedLocked(constraints: readonly CourseConstraint[]): boolean {
  return constraints.includes('no_speed');
}

/** The player's picks a course may override for a stage: the lane options and what LR2 resets on a GRADE course. */
export interface CourseStagePlaySettings extends CourseLaneOptions, LR2GradeResetSettings {}

/**
 * The settings a stage plays with in place of the player's picks: the lane options the course allows
 * ({@link resolveCourseLaneOptions}), then, on an LR2 GRADE course, LR2's resets ({@link resolveLR2GradeCoursePlaySettings}:
 * EASY gauge to GROOVE; HIDDEN / SUDDEN, auto scratch, FLIP and the tempo off). The other fields a host carries along
 * pass through. The player's own settings are left as they are, so they come back after the course.
 */
export function resolveCourseStagePlaySettings<T extends CourseStagePlaySettings>(
  definition: Pick<CourseDefinition, 'kind' | 'source' | 'constraints'>,
  picked: T,
): T {
  return resolveLR2GradeCoursePlaySettings(definition, {
    ...picked,
    ...resolveCourseLaneOptions(definition.constraints, picked),
  });
}
