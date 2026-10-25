import { createLR2PerfectAttackGauge } from './lr2-attack.ts';
import type { GaugeGutsStep, GaugeSpec, JudgeWindowSetUs, RulesetId, RulesetWindowTables } from './definitions.ts';

/**
 * Course play (LR2 grade / expert / nonstop courses and beatoraja courses): which gauge a stage runs on and how a
 * course's judge constraint narrows the windows. Shared by the engine and the replay simulator through
 * `resolveRuleset`, like every other ruleset rule.
 */

/** A course's kind as the ruleset needs it: LR2 picks its course gauges by it; beatoraja does not distinguish. */
export type RulesetCourseKind = 'grade' | 'expert' | 'nonstop';

/** beatoraja's class-gauge table sets, chosen by a course's `gauge_*` constraint or else by the play mode. */
export type CourseGaugeSet = 'lr2' | '5k' | '7k' | '9k' | '24k';

/** beatoraja's `NO_GOOD` / `NO_GREAT` course constraints. */
export type CourseJudgeConstraint = 'no-good' | 'no-great';

export interface RulesetCourseOptions {
  kind: RulesetCourseKind;
  /** The course's `gauge_*` constraint; without one beatoraja picks the set by play mode. LR2 ignores it. */
  gaugeSet?: CourseGaugeSet;
  judge?: CourseJudgeConstraint;
  /**
   * The gauge value carried in from the previous stage (every course gauge starts the first stage at 100). Clamped to
   * the gauge's range.
   */
  initialGauge?: number;
  /** Independent class-gauge values carried by source gauge auto-shift. */
  initialGauges?: Readonly<Record<string, number>>;
}

type GaugeValues = GaugeSpec['values'];

/** LR2's low-HP damage reduction on course gauges: BAD / POOR / empty POOR × 0.6 below 32 % (OpenLR2 L1955-L1961). */
const LR2_COURSE_GUTS: readonly GaugeGutsStep[] = [{ threshold: 32, multiplier: 0.6 }];

function lr2CourseGauge(id: string, values: GaugeValues): GaugeSpec {
  // Course HP starts at 100 with no 2 % floor (L24532-L24535, L1964) and is pinned at 0 once it falls below 2
  // (L1971-L1975): a survival gauge with LR2's death border, whatever gauge the player picked.
  return { id, min: 0, max: 100, initial: 100, border: 0, survival: true, death: 2, values, guts: LR2_COURSE_GUTS };
}

function scaleLR2Damage(values: GaugeValues, damage: number): GaugeValues {
  return values.map((value) => (value < 0 ? value * damage : value)) as unknown as GaugeValues;
}

/**
 * LR2's course gauges (OpenLR2 `LR2f.cpp` L27707-L27790). Grade courses: GROOVE / EASY play the grade gauge, HARD the
 * grade HARD gauge, DEATH the grade DEATH gauge. EXPERT / NONSTOP courses have a GROOVE, EASY, HARD and DEATH line of
 * their own. HARD damage scales by `damage` (LR2's TOTAL / note-count multiplier), as on single charts.
 */
function resolveLR2CourseGauge(gaugeId: string, damage: number): GaugeSpec {
  switch (gaugeId) {
    case 'P-ATTACK':
      return createLR2PerfectAttackGauge();
    case 'GRADE-HARD':
      return lr2CourseGauge(gaugeId, scaleLR2Damage([0.1, 0.1, 0.04, -6, -10, -2], damage));
    case 'GRADE-DEATH':
    case 'COURSE-DEATH':
      return lr2CourseGauge(gaugeId, [0, 0, 0, -100, -100, 0]);
    case 'COURSE':
      return lr2CourseGauge(gaugeId, [0.1, 0.1, 0.04, -1.5, -2, -1.5]);
    case 'COURSE-EASY':
      return lr2CourseGauge(gaugeId, [0.12, 0.12, 0.048, -1.2, -1.6, -1.2]);
    case 'COURSE-HARD':
      return lr2CourseGauge(gaugeId, scaleLR2Damage([0.1, 0.1, 0.05, -6, -10, -2], damage));
    default:
      return lr2CourseGauge('GRADE', [0.1, 0.1, 0.04, -2, -3, -2]);
  }
}

const CLASS_GUTS: readonly GaugeGutsStep[] = [
  { threshold: 5, multiplier: 0.4 },
  { threshold: 10, multiplier: 0.5 },
  { threshold: 15, multiplier: 0.6 },
  { threshold: 20, multiplier: 0.7 },
  { threshold: 25, multiplier: 0.8 },
];
const CLASS_LR2_GUTS: readonly GaugeGutsStep[] = [{ threshold: 30, multiplier: 0.6 }];

interface ClassGaugeRow {
  values: GaugeValues;
  guts: readonly GaugeGutsStep[];
}

/** beatoraja's `GaugeElementProperty` class gauges: `[CLASS, EXCLASS, EXHARDCLASS]` per table set. */
const CLASS_GAUGES: Readonly<Record<CourseGaugeSet, readonly [ClassGaugeRow, ClassGaugeRow, ClassGaugeRow]>> = {
  '5k': [
    { values: [0.01, 0.01, 0, -0.5, -1, -0.5], guts: [] },
    { values: [0.01, 0.01, 0, -1, -2, -1], guts: [] },
    { values: [0.01, 0.01, 0, -2.5, -5, -2.5], guts: [] },
  ],
  '7k': [
    { values: [0.15, 0.12, 0.06, -1.5, -3, -1.5], guts: CLASS_GUTS },
    { values: [0.15, 0.12, 0.03, -3, -6, -3], guts: [] },
    { values: [0.15, 0.06, 0, -5, -10, -5], guts: [] },
  ],
  '9k': [
    { values: [0.15, 0.12, 0.06, -1.5, -3, -3], guts: CLASS_GUTS },
    { values: [0.15, 0.12, 0.03, -3, -6, -6], guts: [] },
    { values: [0.15, 0.06, 0, -5, -10, -10], guts: [] },
  ],
  '24k': [
    { values: [0.2, 0.2, 0.1, -1.5, -3, -1.5], guts: CLASS_GUTS },
    { values: [0.2, 0.2, 0.1, -3, -6, -3], guts: [] },
    { values: [0.2, 0.1, 0, -5, -10, -5], guts: [] },
  ],
  lr2: [
    { values: [0.1, 0.1, 0.05, -2, -3, -2], guts: CLASS_LR2_GUTS },
    { values: [0.1, 0.1, 0.05, -6, -10, -2], guts: CLASS_LR2_GUTS },
    { values: [0.1, 0.1, 0.05, -12, -20, -2], guts: [] },
  ],
};

const CLASS_GAUGE_IDS = ['CLASS', 'EXCLASS', 'EXHARDCLASS'] as const;

/**
 * beatoraja's class gauges (`GaugeProperty`): min 0, max 100, start 100, border 0, no TOTAL modifier. A course plays
 * on them whatever its kind (`GrooveGauge.create`).
 */
function resolveClassGauge(gaugeId: string, gaugeSet: CourseGaugeSet): GaugeSpec {
  const index = Math.max(0, CLASS_GAUGE_IDS.indexOf(gaugeId as (typeof CLASS_GAUGE_IDS)[number]));
  const row = CLASS_GAUGES[gaugeSet][index];
  return {
    id: CLASS_GAUGE_IDS[index],
    min: 0,
    max: 100,
    initial: 100,
    border: 0,
    survival: true,
    values: row.values,
    guts: row.guts,
  };
}

/** The class-gauge set a play mode uses when the course names none (beatoraja's `BMSPlayerRule` per mode). */
export function resolveDefaultCourseGaugeSet(laneMode: string): CourseGaugeSet {
  if (laneMode.startsWith('5') || laneMode.startsWith('10')) return '5k';
  if (laneMode.startsWith('9')) return '9k';
  if (laneMode.startsWith('24') || laneMode.startsWith('48')) return '24k';
  return '7k';
}

/**
 * Maps the player's LR2-family gauge pick onto a ruleset's course gauge id.
 *
 * - `lr2`: grade courses play `GRADE` (GROOVE and EASY alike: LR2 has no grade EASY), `GRADE-HARD` or `GRADE-DEATH`;
 *   EXPERT / NONSTOP courses play `COURSE`, `COURSE-EASY`, `COURSE-HARD` or `COURSE-DEATH`.
 * - beatoraja and That-Which-Must-Not-Be-Named: GROOVE / EASY play `CLASS`, HARD `EXCLASS`, DEATH `EXHARDCLASS` (`GrooveGauge.create`: types up
 *   to NORMAL → CLASS, HARD → EXCLASS, EX-HARD / HAZARD → EXHARDCLASS).
 */
export function resolveCourseGaugeId(rulesetId: RulesetId, kind: RulesetCourseKind, selectedGauge: string): string {
  if (rulesetId !== 'lr2' && selectedGauge === 'P-ATTACK') throw new RangeError('P.ATTACK is available only for LR2.');
  if (rulesetId === 'lr2') {
    const prefix = kind === 'grade' ? 'GRADE' : 'COURSE';
    switch (selectedGauge) {
      case 'P-ATTACK':
        return 'P-ATTACK';
      case 'HARD':
        return `${prefix}-HARD`;
      case 'DEATH':
        return `${prefix}-DEATH`;
      case 'EASY':
        return kind === 'grade' ? 'GRADE' : 'COURSE-EASY';
      default:
        return prefix;
    }
  }
  switch (selectedGauge) {
    case 'HARD':
      return 'EXCLASS';
    case 'EX-HARD':
    case 'DEATH':
      return 'EXHARDCLASS';
    default:
      return 'CLASS';
  }
}

/**
 * The gauge a course stage runs on. `damage` is LR2's HARD damage multiplier for the stage's own chart; `laneMode`
 * picks beatoraja's class-gauge set when the course names none. That-Which-Must-Not-Be-Named has no published class gauge, so it uses
 * beatoraja's (the LR2-first policy falls back to beatoraja for what LR2 lacks).
 */
export function resolveCourseGauge(
  rulesetId: RulesetId,
  gaugeId: string,
  course: RulesetCourseOptions,
  laneMode: string,
  damage: number,
): GaugeSpec {
  if (rulesetId !== 'lr2' && gaugeId === 'P-ATTACK') throw new RangeError('P.ATTACK is available only for LR2.');
  const spec =
    rulesetId === 'lr2'
      ? resolveLR2CourseGauge(gaugeId, damage)
      : resolveClassGauge(gaugeId, course.gaugeSet ?? resolveDefaultCourseGaugeSet(laneMode));
  const initial = course.initialGauge;
  if (initial === undefined || !Number.isFinite(initial)) return spec;
  return { ...spec, initial: Math.min(spec.max, Math.max(spec.min, initial)) };
}

function collapseWindows(set: JudgeWindowSetUs, constraint: CourseJudgeConstraint): JudgeWindowSetUs {
  const [pgreat, great, , bad] = set.judges;
  const judges: JudgeWindowSetUs['judges'] =
    constraint === 'no-great' ? [pgreat, pgreat, pgreat, bad] : [pgreat, great, great, bad];
  return { ...set, judges };
}

/**
 * beatoraja's `NO_GOOD` / `NO_GREAT` (`JudgeManager` L175-L184): the GOOD (and GREAT) window rate drops to 0, and
 * `JudgeWindowRule.create` widens a window that ends up narrower than the one inside it back to that one. So `no-good`
 * gives GOOD the GREAT window and `no-great` gives GREAT and GOOD the PGREAT window, on every table (notes, scratch and
 * long-note ends alike, since `JudgeWindow` builds all four with the key rates).
 */
export function applyCourseJudgeConstraint(
  tables: RulesetWindowTables,
  constraint: CourseJudgeConstraint | undefined,
): RulesetWindowTables {
  if (constraint === undefined) return tables;
  return {
    note: collapseWindows(tables.note, constraint),
    scratch: collapseWindows(tables.scratch, constraint),
    longNoteEnd: collapseWindows(tables.longNoteEnd, constraint),
    longScratchEnd: collapseWindows(tables.longScratchEnd, constraint),
  };
}
