import type { RulesetCourseKind } from './course.ts';
import type { RulesetId } from './definitions.ts';
import type { GaugeShiftBottom } from './gauge-type.ts';

/**
 * Gauge auto-shift ladders (#933): the gauges each ruleset's BEST CLEAR and SELECT TO UNDER choose among, gentlest
 * first. beatoraja 0.8.9's `BMSPlayer` defines the policies on its own gauge line-up. Be-Music extends
 * the same policies to LR2 and AC, with gauge orders and course mappings defined below.
 *
 * - beatoraja: ASSIST EASY, EASY, NORMAL, HARD, EX-HARD, HAZARD (the source's order); a course CLASS, EXCLASS,
 *   EXHARDCLASS.
 * - LR2: EASY, GROOVE, HARD, DEATH (LR2's HAZARD). P.ATTACK and G.ATTACK are not on the ladder: they judge a different
 *   thing, not a harder or gentler clear. A grade course GRADE, GRADE-HARD, GRADE-DEATH; an EXPERT / NONSTOP course
 *   COURSE-EASY, COURSE, COURSE-HARD, COURSE-DEATH.
 * - That-Which-Must-Not-Be-Named: ASSISTED EASY, EASY, NORMAL, HARD, EX-HARD (it has no HAZARD outside a course); a
 *   course plays beatoraja's class gauges, so CLASS, EXCLASS, EXHARDCLASS.
 */
const SINGLE_LADDERS: Readonly<Record<RulesetId, readonly string[]>> = {
  lr2: ['EASY', 'GROOVE', 'HARD', 'DEATH'],
  beatoraja: ['ASSIST-EASY', 'EASY', 'NORMAL', 'HARD', 'EX-HARD', 'HAZARD'],
  ____: ['ASSISTED-EASY', 'EASY', 'NORMAL', 'HARD', 'EX-HARD'],
};

const CLASS_LADDER: readonly string[] = ['CLASS', 'EXCLASS', 'EXHARDCLASS'];

/**
 * The gauge ids `ruleset`'s auto-shift chooses among, gentlest first: a single play's line-up, or the course gauges of
 * a course of `courseKind`.
 */
export function resolveGaugeShiftLadder(ruleset: RulesetId, courseKind?: RulesetCourseKind): readonly string[] {
  if (courseKind === undefined) return SINGLE_LADDERS[ruleset];
  if (ruleset !== 'lr2') return CLASS_LADDER;
  return courseKind === 'grade'
    ? ['GRADE', 'GRADE-HARD', 'GRADE-DEATH']
    : ['COURSE-EASY', 'COURSE', 'COURSE-HARD', 'COURSE-DEATH'];
}

/** The lowest auto-shift gauge pick, spelled in each ruleset's own gauge ids. */
const BOTTOM_GAUGE_IDS: Readonly<Record<RulesetId, Readonly<Record<GaugeShiftBottom, string>>>> = {
  // LR2 has no ASSIST EASY: its gentlest gauge, EASY, is the lowest it can go.
  lr2: { 'ASSIST-EASY': 'EASY', EASY: 'EASY', GROOVE: 'GROOVE' },
  beatoraja: { 'ASSIST-EASY': 'ASSIST-EASY', EASY: 'EASY', GROOVE: 'NORMAL' },
  ____: { 'ASSIST-EASY': 'ASSISTED-EASY', EASY: 'EASY', GROOVE: 'NORMAL' },
};

/**
 * The index on {@link resolveGaugeShiftLadder} below which auto-shift never goes. A course starts from its gentlest
 * course gauge, as beatoraja's class gauges do, whatever the pick; a single play from the pick (ASSIST EASY by default),
 * which LR2, lacking ASSIST EASY, reads as EASY.
 */
export function resolveGaugeShiftBottomIndex(
  ruleset: RulesetId,
  bottom: GaugeShiftBottom | undefined,
  courseKind?: RulesetCourseKind,
): number {
  if (courseKind !== undefined) return 0;
  return Math.max(0, SINGLE_LADDERS[ruleset].indexOf(BOTTOM_GAUGE_IDS[ruleset][bottom ?? 'ASSIST-EASY']));
}

/** The gauge SURVIVAL TO GROOVE falls back to: the ruleset's own default recovery gauge (LR2 GROOVE, else NORMAL). */
export function resolveGaugeShiftFallbackId(ruleset: RulesetId): string {
  return ruleset === 'lr2' ? 'GROOVE' : 'NORMAL';
}
