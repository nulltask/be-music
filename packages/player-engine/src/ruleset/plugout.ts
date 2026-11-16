import type { GaugeGutsStep, GaugeSpec, JudgeWindowSetUs, RulesetWindowTables } from './definitions.ts';
import type { RulesetChartFacts } from './facts.ts';
import type { RulesetCourseKind } from './course.ts';

/**
 * plugout4 -ARCADE EDITION-'s judging and gauges (lavalse, 2012), read in `plugout4.exe`; addresses are cited as in
 * docs/format-compat.md §7 and docs/player-spec.md ("plugout"). Shared by the live engine and the replay simulator
 * through `resolveRuleset`.
 */

/** PGREAT / GREAT / GOOD windows in ms by judge rank 0..3 (0x43e0a7, jump table 0x43e350). BAD is 200 ms throughout. */
const PLUGOUT_RANK_WINDOWS_MS: readonly (readonly [number, number, number])[] = [
  [12, 24, 50],
  [15, 30, 100],
  [18, 40, 100],
  [21, 60, 120],
];
const PLUGOUT_BAD_MS = 200;
/** A press 200–1000 ms before the lane's next note is an empty POOR (0x440803). */
const PLUGOUT_EMPTY_POOR_MS = 1000;
/** plugout's default rank when the chart names none (LRS `information rank`). */
const PLUGOUT_DEFAULT_RANK = 2;

/**
 * The plugout judge rank of a chart: an authored `#RANK` / LRS `rank` read as plugout does (0–2 as written, any other
 * value — an unsigned compare — as 3), else the chart's judge rank on the LR2 percent axis (25 / 50 / 75 / 100, which
 * also carries `#DEFEXRANK` and bmson `judge_rank`) to the nearest rank. The percent reading is a Be-Music decision for
 * charts plugout never read.
 */
export function resolvePlugoutJudgeRank(chart: Pick<RulesetChartFacts, 'judgeRank'>): number {
  const rank = chart.judgeRank.sourceRank;
  if (typeof rank === 'number' && Number.isFinite(rank)) {
    const truncated = Math.trunc(rank);
    return truncated >= 0 && truncated <= 2 ? truncated : 3;
  }
  const percent = chart.judgeRank.percent;
  if (!Number.isFinite(percent)) return PLUGOUT_DEFAULT_RANK;
  return Math.min(3, Math.max(0, Math.round(percent / 25) - 1));
}

/**
 * plugout's window tables for a judge rank. Notes and scratches judge alike, `|Δ| ≤ window` both ways (0x4402dd..). A
 * long note's end is a release: any release no earlier than the GOOD window before the end is a PGREAT, an earlier one a
 * BAD (0x4408bf); a key held 200 ms past the end is a BAD (0x440d75), which `chargeTailHeld` carries.
 */
export function resolvePlugoutWindowTables(rank: number, overrideBadMs?: number): RulesetWindowTables {
  const [pgreat, great, good] = PLUGOUT_RANK_WINDOWS_MS[Math.min(3, Math.max(0, rank))]!;
  const bad = (overrideBadMs ?? PLUGOUT_BAD_MS) * 1000;
  const note: JudgeWindowSetUs = {
    judges: [
      [-pgreat * 1000, pgreat * 1000],
      [-great * 1000, great * 1000],
      [-good * 1000, good * 1000],
      [-bad, bad],
    ],
    ms: [0, PLUGOUT_EMPTY_POOR_MS * 1000],
  };
  // Released from the GOOD window before the end to 200 ms past it: PGREAT; earlier, within the BAD window: BAD. A release
  // earlier still is a BAD too (`heldChargeTail.earlyRelease`), not the missed POOR a window-less release is elsewhere.
  const tail: readonly [number, number] = [-PLUGOUT_BAD_MS * 1000, good * 1000];
  const longEnd: JudgeWindowSetUs = { judges: [tail, tail, tail, [-PLUGOUT_BAD_MS * 1000, bad]] };
  return { note, scratch: note, longNoteEnd: longEnd, longScratchEnd: longEnd };
}

/**
 * plugout's TOTAL when the chart names none (0x43e209): LR2's note-count curve without LR2's ×0.8, each piece truncated
 * to an integer.
 */
export function resolvePlugoutDefaultTotal(noteCount: number): number {
  const n = Math.max(0, noteCount);
  if (n >= 600) return 360 + Math.trunc((n - 600) / 5);
  if (n >= 400) return Math.trunc((n - 400) / 2.5 + 280);
  return 200 + Math.trunc(n / 5);
}

/** Every plugout single-play gauge id: the four types and their EX variants (0x43af70, table 0x43b15c..0x43b280). */
export const PLUGOUT_GAUGE_IDS = [
  'NORMAL',
  'EX-NORMAL',
  'EASY',
  'EX-EASY',
  'HARD',
  'EX-HARD',
  'HAZARD',
  'EX-HAZARD',
] as const;

/**
 * The plugout gauge a Be-Music gauge pick plays: GROOVE → NORMAL, DEATH → HAZARD, and the EX picks to plugout's EX
 * gauges. plugout has no ASSIST EASY and no attack gauges; `resolveRuleset` refuses those picks before this.
 */
export function resolvePlugoutGaugeId(pick: string): string {
  switch (pick) {
    case 'EASY':
      return 'EASY';
    case 'EX-EASY':
      return 'EX-EASY';
    case 'HARD':
      return 'HARD';
    case 'EX-HARD':
      return 'EX-HARD';
    case 'DEATH':
    case 'DEATH-CORRECTED':
      return 'HAZARD';
    case 'EX-DEATH':
      return 'EX-HAZARD';
    case 'EX-GROOVE':
      return 'EX-NORMAL';
    default:
      return 'NORMAL';
  }
}

/** HARD's relief: below 30 % a POOR or empty POOR costs ×0.7 (0x43a38a..0x43a3c4); BAD keeps its full damage. */
const PLUGOUT_HARD_GUTS: readonly GaugeGutsStep[] = [{ judges: [4, 5], threshold: 30, multiplier: 0.7 }];

/**
 * A plugout single-play gauge (normal play, `player+0xc4` = 0). NORMAL / EASY recover `TOTAL / n` (GOOD half) over
 * `noteCount` judgments and stay at 2 % or more; EXNORMAL clears only at 100 %, and EX EASY at 4 % (the code's value,
 * whatever its intent). HARD / HAZARD and their EX variants start full and fail at 0.
 */
export function resolvePlugoutGauge(gaugeId: string, total: number, noteCount: number): GaugeSpec {
  const unit = total / Math.max(1, noteCount);
  const recovery = (damage: readonly [number, number, number]) =>
    [unit, unit, unit / 2, ...damage] as unknown as GaugeSpec['values'];
  const groove = (id: string, damage: readonly [number, number, number], border: number): GaugeSpec => ({
    id,
    min: 2,
    max: 100,
    initial: 20,
    border,
    survival: false,
    values: recovery(damage),
    guts: [],
  });
  const survival = (id: string, values: GaugeSpec['values'], guts: readonly GaugeGutsStep[] = []): GaugeSpec => ({
    id,
    min: 0,
    max: 100,
    initial: 100,
    border: 0,
    survival: true,
    values,
    guts,
  });
  switch (gaugeId) {
    case 'EX-NORMAL':
      return groove('EX-NORMAL', [-3, -8, -2], 100);
    case 'EASY':
      return groove('EASY', [-2.4, -6.4, -1.6], 80);
    case 'EX-EASY':
      return groove('EX-EASY', [-2.4, -6.4, -1.6], 4);
    case 'HARD':
      return survival('HARD', [0.1, 0.1, 0.05, -9, -18, -4], PLUGOUT_HARD_GUTS);
    case 'EX-HARD':
      return survival('EX-HARD', [0.1, 0.1, 0.05, -5, -10, -2]);
    case 'HAZARD':
      return survival('HAZARD', [0, 0, 0, -100, -100, 0]);
    case 'EX-HAZARD':
      return survival('EX-HAZARD', [0, -2, -100, -100, -100, -100]);
    default:
      return groove('NORMAL', [-3, -8, -2], 80);
  }
}

/**
 * plugout's course gauge for a stage (`player+0xc4` ≠ 0), by the player's single-play gauge. EXPERT / NONSTOP courses
 * play mode 1 (0x43afb4..0x43b0b4); grade courses mode 4 (0x43b0b7..0x43b158). Every course gauge starts at 100, carries
 * over between stages, never recovers and clears above 0.
 *
 * - Mode 1: NORMAL / EASY damage scales by `f` of the stage's note count `n` (2 under 100 notes, `1 + (n − 100) / 500`
 *   up to 400, then 1); HARD keeps its single-play damage (EX lighter); HAZARD is as in single play. Every type gets the
 *   ×0.7 POOR relief below 30 %.
 * - Mode 4: NORMAL −1 / −2 / −2, EASY as in mode 1, HARD with the EX tables swapped (plain −5 / −10 / −2, EX −9 / −18 /
 *   −4), HAZARD as in single play. While the gauge is above 0, NORMAL and EASY damage scales by `(3g + 100) / 400`; HARD
 *   gets the ×0.7 relief instead. When NORMAL or EASY reach 0, the stage goes on 24 lives (BAD and empty POOR one each,
 *   POOR two) and clears while any are left; a stage starts again at 0.01 % with 24 lives.
 */
export function resolvePlugoutCourseGauge(gaugeId: string, kind: RulesetCourseKind, noteCount: number): GaugeSpec {
  // A course gauge's own id (`COURSE-HARD`, `GRADE`) names the single-play gauge it came from.
  if (gaugeId === 'COURSE' || gaugeId === 'GRADE') gaugeId = 'NORMAL';
  else if (gaugeId.startsWith('COURSE-')) gaugeId = gaugeId.slice('COURSE-'.length);
  else if (gaugeId.startsWith('GRADE-')) gaugeId = gaugeId.slice('GRADE-'.length);
  const n = Math.max(0, noteCount);
  const f = n < 100 ? 2 : n < 400 ? 1 + (n - 100) / 500 : 1;
  const grade = kind === 'grade';
  const course = (
    id: string,
    damage: readonly [number, number, number],
    extra: Partial<GaugeSpec> = {},
  ): GaugeSpec => ({
    id,
    min: 0,
    max: 100,
    initial: 100,
    border: 0,
    survival: true,
    values: [0, 0, 0, ...damage] as unknown as GaugeSpec['values'],
    guts: grade ? [] : PLUGOUT_HARD_GUTS,
    ...extra,
  });
  const prefix = grade ? 'GRADE' : 'COURSE';
  // Grade NORMAL / EASY: damage shrinks with the gauge, then the stage plays on lives.
  const gradeGroove: Partial<GaugeSpec> = grade
    ? { damageScale: { base: 0.25, perGauge: 0.0075 }, lives: { initial: 24, costs: [0, 0, 0, 1, 2, 1] } }
    : {};
  switch (gaugeId) {
    case 'EASY':
    case 'EX-EASY':
      return course(`${prefix}-EASY`, [-0.8 * f, -1.6 * f, -0.8 * f], gradeGroove);
    case 'HARD':
      return grade
        ? course('GRADE-HARD', [-5, -10, -2], { guts: PLUGOUT_HARD_GUTS })
        : course('COURSE-HARD', [-9, -18, -4]);
    case 'EX-HARD':
      return grade
        ? course('GRADE-EX-HARD', [-9, -18, -4], { guts: PLUGOUT_HARD_GUTS })
        : course('COURSE-EX-HARD', [-5, -10, -2]);
    case 'HAZARD':
      return { ...course(`${prefix}-HAZARD`, [-100, -100, 0]), guts: [] };
    case 'EX-HAZARD':
      return {
        ...course(`${prefix}-EX-HAZARD`, [-100, -100, -100]),
        values: [0, -2, -100, -100, -100, -100],
        guts: [],
      };
    default:
      return grade ? course('GRADE', [-1, -2, -2], gradeGroove) : course('COURSE', [-1 * f, -2 * f, -1 * f]);
  }
}

/** A grade stage's starting gauge: what the last stage left, but never below 0.01 % (0x439fb9). */
export function resolvePlugoutGradeStageStart(carried: number): number {
  return Math.max(0.01, carried);
}

/** plugout's score (0x43a27b): `100000·PG/n + 50000·GR/n + 25000·GOOD/n`, each term integer-divided; 100000 at most. */
export function resolvePlugoutScore(
  counts: { pgreat: number; great: number; good: number },
  noteCount: number,
): number {
  const n = Math.max(1, noteCount);
  return (
    Math.trunc((100000 * counts.pgreat) / n) +
    Math.trunc((50000 * counts.great) / n) +
    Math.trunc((25000 * counts.good) / n)
  );
}

export const PLUGOUT_SCORE_MAX = 100000;
