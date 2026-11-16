import { isBmsonRecoveryDisabled, type BmsonTotalMode } from './bmson-total.ts';
import { applyChartGaugeModifiers, applyChartJudgeModifiers, type ChartJudgeModifiers } from './chart-judge.ts';
import { applyCustomJudgeTables, type BeatorajaCustomJudge } from './custom-judge.ts';
import { BEATORAJA_MODES, resolveBeatorajaMode } from './beatoraja-windows.ts';
import { createLR2GoodAttackGauge, createLR2PerfectAttackGauge } from './lr2-attack.ts';
import type { GaugeJudgeIndex } from './gauge.ts';
import type { GaugeAutoShift, GaugeShiftBottom } from './gauge-type.ts';
import { resolveGaugeShiftBottomIndex, resolveGaugeShiftFallbackId, resolveGaugeShiftLadder } from './gauge-shift.ts';
import {
  BEATORAJA_PRACTICE_GAUGE_TYPES,
  isPracticeGaugeType,
  practiceReadsJudgeRankAndTotal,
  resolveDefaultPracticeGauge,
  splitPracticeGaugePick,
  type PracticeGaugePick,
} from './practice-gauge.ts';
import {
  bmsExRankValueToJudgeRankPercent,
  resolveBMSJudgeWindowsMsForExRankValue,
  resolveBMSJudgeWindowsMsForPercent,
  resolveBMSRankJudgeRankPercent,
  resolveLR2GambolWindowsMs,
  resolveLR2NonstopRankWindowsMs,
  type LR2GambolLevel,
  type JudgeWindowsMs,
} from '../core/judge-window.ts';
import {
  applyCourseJudgeConstraint,
  resolveClassGauge,
  resolveCourseGauge,
  resolveCourseGaugeId,
  type RulesetCourseOptions,
} from './course.ts';
import { countBaseNotes, withoutRulesetNotes, type RulesetChartFacts, type RulesetNoteCounts } from './facts.ts';
import { isChargeLongNoteMode, resolveEffectiveLongNoteMode } from './long-note.ts';
import { resolvePlugoutDefaultTotal, resolvePlugoutGauge, resolvePlugoutGaugeId } from './plugout.ts';
import { resolvePlugoutRuleset } from './plugout-ruleset.ts';

/**
 * Ruleset tables for the replay simulators.
 *
 * Every numeric constant here was read from primary sources (2026-08 HEAD):
 * - beatoraja: `exch-bms2/beatoraja` — `play/JudgeProperty.java`, `play/JudgeAlgorithm.java`,
 *   `play/JudgeManager.java`, `play/GaugeProperty.java`, `play/GrooveGauge.java`, `play/BMSPlayerRule.java`.
 * - LR2: `wcko87/lr2oraja` / `seraxis/lr2oraja-endlessdream` (`JudgeProperty.LR2`, `JudgeWindowRule.LR2`,
 *   `GaugeProperty` LR2 variants with `death = 2` / guts `{32, 0.6}`) cross-checked against
 *   the OpenLR2 transcription (`GOMazk/OpenLR2` — `Scene04_Play.cpp`, `LR2_bmsload.cpp`,
 *   `LR2f.cpp` ProcSinglenote for the forward BAD re-judge chain).
 * - That-Which-Must-Not-Be-Named: community measurements (https://iidx.org compendium; dbm_capture / leisurely1 measurements). That-Which-Must-Not-Be-Named internals are
 *   not public — those values are the current community consensus, not vendor data.
 *
 * Window convention (borrowed from beatoraja): `dmTimeUs = noteTimeUs - inputTimeUs`, so POSITIVE deltas are
 * EARLY (FAST) presses. A window is a `[lateBoundUs, earlyBoundUs]` pair with `lateBoundUs <= 0 <= earlyBoundUs`
 * (except the LR2 empty-POOR window, which is early-only).
 */

export type WindowPairUs = readonly [number, number];

export interface JudgeWindowSetUs {
  /** PGREAT / GREAT / GOOD / BAD windows, inner to outer. */
  judges: readonly [WindowPairUs, WindowPairUs, WindowPairUs, WindowPairUs];
  /** Empty-POOR (空POOR) window, or undefined when the context has none (long-note ends). */
  ms?: WindowPairUs;
}

export interface RulesetWindowTables {
  note: JudgeWindowSetUs;
  scratch: JudgeWindowSetUs;
  longNoteEnd: JudgeWindowSetUs;
  longScratchEnd: JudgeWindowSetUs;
}

/** Every supported judge ruleset id, in canonical display order. */
export const RULESET_IDS = ['lr2', 'beatoraja', '____', 'plugout'] as const;

export type RulesetId = (typeof RULESET_IDS)[number];

/** Whether `value` names a judge ruleset. */
export function isRulesetId(value: unknown): value is RulesetId {
  return typeof value === 'string' && (RULESET_IDS as readonly string[]).includes(value);
}

export type BeatorajaJudgeAlgorithm = 'combo' | 'duration' | 'lowest' | 'score';

/** How a ruleset plays the chart's long notes. */
export type LongNoteStyle =
  /** LR2: every long note is an LN — one deferred judgment (see {@link LNEarlyReleaseRule} for a release before the tail). */
  | 'ln'
  /** beatoraja: per-note lnMode decides LN (1) vs CN (2) vs HCN (3). */
  | 'per-note'
  /** That-Which-Must-Not-Be-Named: every long note is a CN (HCN when the chart says mode 3) — head and tail judged separately. */
  | 'charge';

/**
 * When a mine detonates.
 *
 * - `'press-ahead-or-hold'` — LR2beta3: strict GREAT reach ahead of the line on key-down, or held crossing;
 *   passed mines retire immediately and hits count as POOR without changing combo or EX-SCORE. That-Which-Must-Not-Be-Named has no
 *   mines, so its ruleset imports this policy whole, reading the reach on its own GREAT window (#1169).
 * - `'hold'` — beatoraja (`JudgeManager` L244): the key is down at the moment the mine crosses the line; a press
 *   shortly before or after does nothing.
 */
export type MineTrigger = 'press-ahead-or-hold' | 'hold';

/**
 * How an LN (long-note mode 1) let go before its tail is judged. The LN's single judgment is otherwise the head's,
 * confirmed when the tail is reached.
 *
 * - `'head-unless-beyond-good'` — LR2 (OpenLR2 `ProcLongnote`, `LR2f.cpp:7612-7621`): a release more than the GOOD
 *   window before the tail is a BAD; a later one keeps the head's judgment.
 * - `'worse-of-head-and-tail'` — beatoraja (`JudgeManager` L533-545): the release is judged against the long-note-end
 *   windows and the LN takes the worse of that and the head; when that is BAD or worse and the release came before
 *   the tail, it is a BAD.
 */
export type LNEarlyReleaseRule = 'head-unless-beyond-good' | 'worse-of-head-and-tail';

/**
 * What a press does on a lane whose long note is being held (a second key bound to the lane, such as the turntable's
 * other direction). It never judges another note on that lane: the lane's current note is the long note.
 *
 * - `'rejudge-head-or-empty-poor'` — LR2 (OpenLR2 `ProcLongnote`, `LR2f.cpp:7547-7590`): a press within the BAD window of
 *   the LN's head judges the head again; any other press is an empty POOR.
 * - `'ignore'` — beatoraja (`JudgeManager` L355-377): a re-press during the hold, judging nothing. That-Which-Must-Not-Be-Named follows it: one
 *   button per lane cannot be pressed again while held.
 */
export type PressDuringLongNoteRule = 'rejudge-head-or-empty-poor' | 'ignore';

export interface GaugeGutsStep {
  /** Restrict softening to these judgments; omitted preserves a source table's unrestricted behavior. */
  judges?: readonly GaugeJudgeIndex[];
  /** Gauge value below (or at, when `inclusive`) which the damage multiplier applies. */
  threshold: number;
  multiplier: number;
  inclusive?: boolean;
}

export interface GaugeSpec {
  /** Suppress every positive delta, including HCN and raw deltas; damage and initial values are unchanged. */
  recoveryDisabled?: boolean;
  /** Ruleset-scoped gauge label reported in the result. */
  id: string;
  min: number;
  max: number;
  initial: number;
  /** Clear border; survival gauges use 0 (clear = survive). */
  border: number;
  /** Survival gauges fail the moment they reach 0. */
  survival: boolean;
  /** LR2 survival gauges: values below this collapse to 0 (death border). */
  death?: number;
  /** A survival gauge that also needs this value at the end to clear: LR2's HAZARD on a single chart (80). */
  clearBorder?: number;
  /**
   * LR2: landmine damage stops at this value instead of going lower. LR2 holds HP at 2 when the player picked GROOVE
   * or EASY, in a course too (OpenLR2 `LR2f.cpp` L2054-L2056), where the course gauge itself has no 2 % floor.
   */
  mineFloor?: number;
  /** Per-judge deltas in percent, `[PG, GR, GD, BD, missPOOR, emptyPOOR]`, AFTER TOTAL modifiers. */
  values: readonly [number, number, number, number, number, number];
  /** Low-gauge damage reduction steps (first match wins). */
  guts: readonly GaugeGutsStep[];
  /**
   * plugout's grade gauges: damage scales by `base + perGauge × value` (the value before the judgment) while the gauge
   * is above 0, instead of `guts`.
   */
  damageScale?: { base: number; perGauge: number };
  /**
   * plugout's grade NORMAL / EASY: on reaching 0 the gauge does not fail but plays on `initial` lives, each judgment
   * costing `costs[judge]` (`[PG, GR, GD, BD, missPOOR, emptyPOOR]`); it fails when none are left, and clears while any
   * are.
   */
  lives?: { initial: number; costs: readonly [number, number, number, number, number, number] };
  /**
   * beatoraja: the gauge, its deltas and every update run in Java `float` (`GrooveGauge.Gauge`), so each step rounds to
   * float32. LR2 keeps HP and its deltas in `double` (#1090).
   */
  float32?: boolean;
}

export interface RulesetConfig {
  /** Versioned ruleset id written into the result (`'lr2/0'` etc.). */
  id: string;
  rulesetId: RulesetId;
  windows: RulesetWindowTables;
  /**
   * LR2 dynamic `#EXRANKxx` support: returns the window tables active at `timeUs`. Rulesets without dynamic
   * rank support return the static tables.
   */
  windowsAt: (timeUs: number) => RulesetWindowTables;
  selection: BeatorajaJudgeAlgorithm;
  /** LR2: after a tap BAD, re-judge the next tap on that lane with the same press until a non-BAD stops it. */
  multiBad: boolean;
  /**
   * How far after the press, in µs, a note {@link multiBad} re-judges may lie (exclusive). Absent: the BAD window's early
   * edge (LR2). plugout re-runs the press only on a note earlier than 3 ms after it (`plugout4.exe` 0x4407c4..0x4407fa).
   */
  multiBadAheadUs?: number;
  /** LR2: a long-note head is never judged as a LATE bad — the press is ignored instead. */
  ignoreLateBadOnLNHead: boolean;
  longNoteStyle: LongNoteStyle;
  /** How an LN released before its tail is judged (see {@link LNEarlyReleaseRule}). */
  lnEarlyRelease: LNEarlyReleaseRule;
  /** What a press on a lane whose long note is held does (see {@link PressDuringLongNoteRule}). */
  pressDuringLongNote: PressDuringLongNoteRule;
  /**
   * How long (µs) a long-note release that would score BAD or worse before the tail waits before it is settled, per
   * lane kind. Pressing the lane again inside it resumes the hold, as if it had never been let go; any other release
   * settles at once. beatoraja's `JudgeProperty.longnoteMargin` / `longscratchMargin` (200 ms on PMS keys, 0
   * elsewhere); LR2 and That-Which-Must-Not-Be-Named settle every release at once.
   */
  longNoteReleaseMarginUs: { note: number; scratch: number };
  /** That-Which-Must-Not-Be-Named: a BAD / POOR on a charge-note head skips the tail judgment entirely. */
  headBadSkipsTail: boolean;
  /**
   * beatoraja's `sckey` (#605): a scratch long note remembers the input source that hit its head. An LN on a scratch
   * lane is let go only by that source's release; a back-spin scratch ends on that source's release when the release
   * would judge POOR (otherwise it is ignored). A press from another source ends a back-spin scratch under every
   * ruleset that plays one. LR2 and That-Which-Must-Not-Be-Named release scratch holds on any key.
   */
  scratchHoldsBySource: boolean;
  comboBreaksOnEmptyPoor: boolean;
  /** When a mine detonates (see {@link MineTrigger}). */
  mineTrigger: MineTrigger;
  /** HCN tick deltas as `[heldJudgeIndex, heldRate, releasedJudgeIndex, releasedRate]` (beatoraja model). */
  hcnTick: { heldJudge: number; heldRate: number; releasedJudge: number; releasedRate: number };
  /**
   * The source whose gauges the play runs on: the judge ruleset itself, or another one when the gauge pick names it
   * (`lr2:HARD` under beatoraja judging, #1171). The gauge table, its TOTAL reading, the auto-shift ladder and
   * fallback, and the course gauges are that source's; every other field stays the judge ruleset's.
   */
  gaugeSource: RulesetId;
  gauge: GaugeSpec;
  /** SURVIVAL TO GROOVE tracks NORMAL from chart start, never on course class gauges. */
  gaugeFallback?: GaugeSpec;
  /** Source-ordered parallel gauges and minimum eligible index (CLASS family starts at zero). */
  gaugeBank?: { specs: readonly GaugeSpec[]; bottomIndex: number; upperExclusive?: number };
  /** EX-SCORE denominator note count (longs count 1 for LN styles, 2 for charge styles). */
  noteCount: number;
  /**
   * The TOTAL the gauge runs on: BMS `#TOTAL` as is, bmson `info.total` as a percentage of this ruleset's default, or
   * the default itself when the chart names none (or a value ≤ 0). Spec-mode zero disables recovery separately,
   * retaining this value for damage scaling.
   */
  effectiveTotal: number;
  /** LR2 money score (`(4PG + 2GR + GD) × 50000 / notes`, floored). */
  moneyScore: boolean;
  /** plugout's score (`100000·PG/n + 50000·GR/n + 25000·GOOD/n`) instead of the EX-SCORE or LR2's money score. */
  plugoutScore?: boolean;
  /**
   * What a charge-note tail still held past its end becomes. Absent: a missed POOR once the tail's late window closes
   * (beatoraja, AC). plugout: a key lane's tail is a BAD at that point, and a scratch lane's tail is a PGREAT as soon as
   * the end is reached (0x440d75..0x440f5b); a release before the tail's windows is a BAD, not a POOR (0x4408bf).
   */
  heldChargeTail?: { note: 'BAD'; scratch: 'PGREAT'; earlyRelease: 'BAD' };
  /**
   * How a press with nothing to judge picks its lane's sound. Absent: the last note whose early window has opened
   * (LR2's lane sound hold). `plugout`: the lane's sound cursor, moved by judged presses, long-note releases and hidden
   * notes (`core/plugout-lane-sound.ts`). Audio only: no judgment or score depends on it.
   */
  laneSound?: 'plugout';
  /** plugout: AUTO SCRATCH notes only sound; they are neither judged nor counted (0x43fa2e, 0x43e1a4). */
  autoScratchUnjudged?: boolean;
  /**
   * Whether the ruleset's own result screen folds empty POORs into its POOR counter. LR2 does — OpenLR2's
   * `ApplyJudgeNote` increments `playerstat.poor` for the empty-POOR branch and LR2 exposes no separate stat —
   * so a run judged under LR2 must display the sum to match the real thing. Purely a PRESENTATION rule: the
   * counts stay separate in `PlayerSummary`, and EX-SCORE and combo are never affected either way.
   *
   * beatoraja and That-Which-Must-Not-Be-Named are left `false`: beatoraja shows an empty-POOR figure of its own, and no first-party
   * measurement of That-Which-Must-Not-Be-Named's counter was found. Flip either one when a source turns up.
   */
  emptyPoorCountsInPoorDisplay: boolean;
}

export interface ResolveRulesetOptions {
  /** The notes AUTO SCRATCH plays. plugout leaves them out of judging and the note count (0x43e1a4). */
  autoScratchNotes?: RulesetNoteCounts;
  /** Judged notes plugout leaves out of its note count: LRX chain notes that start their lane (0x43c071). */
  uncountedNotes?: RulesetNoteCounts;
  /** bmson zero-total policy. Absent retains beatoraja-compatible recovery. */
  bmsonTotalMode?: BmsonTotalMode;
  /** Forces a specific ruleset-scoped gauge id (see the gauge tables), bypassing {@link selectedGauge} mapping. */
  gauge?: string;
  /**
   * The LR2-family gauge the player picked (`'GROOVE'` / `'EASY'` / `'HARD'` / `'DEATH'`). Mapped onto each
   * ruleset's own line-up by `resolveDefaultGaugeId`. Defaults to `'GROOVE'`.
   */
  selectedGauge?: string;
  /** Gauge auto-shift, along the ruleset's own ladder (`resolveGaugeShiftLadder`). */
  gaugeAutoShift?: GaugeAutoShift;
  bottomShiftableGauge?: GaugeShiftBottom;
  /** Debug BAD-window override (`PlayerOptions.judgeWindowMs`) — non-standard, applies to every window table. */
  judgeWindowOverrideMs?: number;
  /** beatoraja note-selection algorithm (default `'combo'`, beatoraja's own default). */
  judgeAlgorithm?: BeatorajaJudgeAlgorithm;
  /** beatoraja CUSTOM JUDGE window and long-note margin rates; absent while the option is off. */
  customJudge?: BeatorajaCustomJudge;
  /** LR2's mania option GAMBOL (LR2 rules only): fixes the judge windows for the play; absent while it is off. */
  lr2Gambol?: LR2GambolLevel;
  /** PRACTICE (beatoraja's `PracticeProperty`, under every ruleset): replaces the gauge, TOTAL and judgerank of the play. */
  practice?: PracticeRules;
  /**
   * The play is a course stage: it runs on the ruleset's course gauge (see `resolveCourseGauge`), starting from the
   * value carried in, and under the course's judge constraint.
   */
  course?: RulesetCourseOptions;
  /** The chart's judgment CRAZY options (`GOOD2BAD`, `GREAT2BAD`, `HELLJUDGE`, #844), applied before a course constraint. */
  chartJudge?: ChartJudgeModifiers;
}

const scale = (windows: { pgreat: number; great: number; good: number; bad: number }): JudgeWindowSetUs => ({
  judges: [
    [-windows.pgreat * 1000, windows.pgreat * 1000],
    [-windows.great * 1000, windows.great * 1000],
    [-windows.good * 1000, windows.good * 1000],
    [-windows.bad * 1000, windows.bad * 1000],
  ],
  ms: [0, 1_000_000],
});

/** LR2 long-note end tolerance is the (rank-scaled) GOOD window on both ends (OpenLR2 `ProcLongnote`). */
const lr2LongNoteEnd = (windows: { good: number; bad: number }): JudgeWindowSetUs => ({
  judges: [
    [-windows.good * 1000, windows.good * 1000],
    [-windows.good * 1000, windows.good * 1000],
    [-windows.good * 1000, windows.good * 1000],
    [-windows.bad * 1000, windows.bad * 1000],
  ],
});

function resolveLR2WindowTables(percent: number, overrideBadMs: number | undefined): RulesetWindowTables {
  return lr2WindowTables(resolveBMSJudgeWindowsMsForPercent(percent, overrideBadMs));
}

function lr2WindowTables(windows: JudgeWindowsMs): RulesetWindowTables {
  const note = scale(windows);
  const longEnd = lr2LongNoteEnd(windows);
  return { note, scratch: note, longNoteEnd: longEnd, longScratchEnd: longEnd };
}

/** bmson `info.judge_rank` default (bmson 1.0.0; beatoraja's bmson model initialises it to 100). */
const BMSON_DEFAULT_JUDGE_RANK = 100;

/** beatoraja judgerank percent per `BMSPlayerRule.validate` (NORMAL window rule). */
function resolveBeatorajaJudgeRank(chart: RulesetChartFacts, rankTable: readonly number[]): number {
  const exRank = chart.judgeRank.sourceExRank;
  if (chart.sourceFormat === 'bmson') {
    // bmson's judge_rank is the judgerank itself; a chart that omits it gets the format default, not BMS #RANK 2.
    // Decided here rather than in the chart facts so a replay, which records `sourceExRank` only when the chart sets
    // it, resolves the same windows on replay.
    return typeof exRank === 'number' && exRank > 0 ? exRank : BMSON_DEFAULT_JUDGE_RANK;
  }
  if (typeof exRank === 'number' && exRank > 0) {
    // BMS #DEFEXRANK: value × (NORMAL-rule rank-2 percent) / 100.
    return (exRank * rankTable[2]!) / 100;
  }
  const rank = chart.judgeRank.sourceRank;
  if (typeof rank === 'number' && Number.isInteger(rank) && rank >= 0 && rank < rankTable.length) {
    return rankTable[rank]!;
  }
  return rankTable[2]!;
}

/**
 * Applies beatoraja's `JudgeWindowRule.create` to one flat window table: scale the non-fixed judges by
 * `judgerank / 100`, clamp every leg to the resolved BAD leg, then enforce inner-to-outer monotonicity.
 * NORMAL scales BAD too; PMS keeps it fixed.
 */
function scaleBeatorajaWindows(
  flat: readonly number[],
  judgeRank: number,
  scaled: readonly [boolean, boolean, boolean, boolean],
): JudgeWindowSetUs {
  const judgeCount = flat.length >= 10 ? 5 : 4;
  const legs: number[] = [];
  for (let judge = 0; judge < 4; judge += 1) {
    for (let side = 0; side < 2; side += 1) {
      let value = flat[judge * 2 + side]!;
      if (scaled[judge]) {
        value = (value * judgeRank) / 100;
      }
      const badLeg = flat[3 * 2 + side]! * (scaled[3] ? judgeRank / 100 : 1);
      if (Math.abs(value) > Math.abs(badLeg)) {
        value = badLeg;
      }
      if (judge > 0 && Math.abs(value) < Math.abs(legs[(judge - 1) * 2 + side]!)) {
        value = legs[(judge - 1) * 2 + side]!;
      }
      legs.push(Math.round(value));
    }
  }
  const set: JudgeWindowSetUs = {
    judges: [
      [legs[0]!, legs[1]!],
      [legs[2]!, legs[3]!],
      [legs[4]!, legs[5]!],
      [legs[6]!, legs[7]!],
    ],
    ...(judgeCount === 5 ? { ms: [flat[8]!, flat[9]!] as WindowPairUs } : {}),
  };
  return set;
}

function resolveBeatorajaWindowTables(chart: RulesetChartFacts, judgeRankOverride?: number): RulesetWindowTables {
  const mode = resolveBeatorajaMode(chart.laneMode);
  const judgeRank = judgeRankOverride ?? resolveBeatorajaJudgeRank(chart, mode.rankTable);
  const note = scaleBeatorajaWindows(mode.note, judgeRank, mode.scaled);
  const scratch = mode.scratch ? scaleBeatorajaWindows(mode.scratch, judgeRank, mode.scaled) : note;
  const longNoteEnd = scaleBeatorajaWindows(mode.longNoteEnd, judgeRank, mode.scaled);
  const longScratchEnd = mode.longScratchEnd
    ? scaleBeatorajaWindows(mode.longScratchEnd, judgeRank, mode.scaled)
    : longNoteEnd;
  return { note, scratch, longNoteEnd, longScratchEnd };
}

// That-Which-Must-Not-Be-Named community-consensus windows [C] (https://iidx.org): PG ±1F / GR ±2F / GD ±7F / BD ±15F at 60 fps. Only these
// ordinary-note windows rest on evidence about the game itself.
const _____NOTE: JudgeWindowSetUs = {
  judges: [
    [-16667, 16667],
    [-33333, 33333],
    [-116667, 116667],
    [-250000, 250000],
  ],
  // Provisional (#1189): the That-Which-Must-Not-Be-Named empty-POOR window is not known ("?" in https://iidx.org/compendium/gauges_and_timing
  // [C]: "exact numbers for excessive POORs in IIDX are not precisely known"). beatoraja's MS window (late 150 ms /
  // early 500 ms, `JudgeProperty` SEVENKEYS [V]) is borrowed as a donor value: evidence of beatoraja, not of this game.
  ms: [-150000, 500000],
};
// That-Which-Must-Not-Be-Named's CN release (#1189). Its one rule on record [C] (https://iidx.org/compendium/gauges_and_timing): the release
// judgment "only has PGREAT; GREAT and GOODs get automatically upgraded to PGREAT", so a release inside the GOOD window
// is a PGREAT and the PGREAT and GREAT windows reach as far as the GOOD one. A BAD or POOR head skips the tail
// (`headBadSkipsTail`). The bounds stay provisional: no source gives them. beatoraja's SEVENKEYS long-note end GOOD
// (±200 ms) and BAD (+220 / -280 ms) windows (`JudgeProperty` [V]) are borrowed unscaled as donor values, evidence of
// beatoraja, not of this game; iidx.org's "±120, ±160, ±200, {+220, -280}" are beatoraja's too. `judge.test.ts` pins
// them, so a later measured value replaces them deliberately.
const _____LN_END_GOOD: WindowPairUs = [-200000, 200000];
const _____LN_END: JudgeWindowSetUs = {
  judges: [_____LN_END_GOOD, _____LN_END_GOOD, _____LN_END_GOOD, [-280000, 220000]],
};

const _____WINDOWS: RulesetWindowTables = {
  note: _____NOTE,
  scratch: _____NOTE,
  longNoteEnd: _____LN_END,
  longScratchEnd: _____LN_END,
};

/** LR2 default TOTAL (OpenLR2 `LR2_bmsload.cpp`): piecewise-linear in the note count, ×0.8. */
export function resolveLR2DefaultTotal(noteCount: number): number {
  const n = Math.max(0, noteCount);
  let base: number;
  if (n < 400) {
    base = n / 5 + 200;
  } else if (n < 600) {
    base = (n - 400) / 2.5 + 280;
  } else {
    base = (n - 600) / 5 + 360;
  }
  return base * 0.8;
}

/** beatoraja default TOTAL (`BMSPlayerRule.calculateDefaultTotal`, keyboard modes excluded). */
export function resolveBeatorajaDefaultTotal(noteCount: number): number {
  const n = Math.max(1, noteCount);
  return Math.max(260.0, (7.605 * n) / (0.01 * n + 6.5));
}

/**
 * That-Which-Must-Not-Be-Named gauge recovery unit ("a value", percent per PGREAT/GREAT) — https://iidx.org measurement: `260 / n` up to 338
 * notes, `760.5 / (n + 650)` beyond, rounded to the nearest 0.02 %.
 */
export function resolve____GaugeUnit(noteCount: number): number {
  const n = Math.max(1, noteCount);
  const raw = n <= 338 ? 260 / n : 760.5 / (n + 650);
  return Math.round(raw / 0.02 + 1e-9) * 0.02;
}

/**
 * lr2oraja `MODIFY_DAMAGE` — LR2 HARD/EX-HARD damage multiplier from TOTAL (fix1) and note count (fix2).
 */
export function resolveLR2HardDamageMultiplier(total: number, noteCount: number): number {
  const fix1 = 10.0 / Math.min(10.0, Math.max(1.0, Math.floor(total / 16.0) - 5.0));
  const n = noteCount;
  let fix2: number;
  if (n <= 20) fix2 = 10.0;
  else if (n < 30) fix2 = 8.0 + 0.2 * (30 - n);
  else if (n < 60) fix2 = 5.0 + (0.2 * (60 - n)) / 3.0;
  else if (n < 125) fix2 = 4.0 + (125 - n) / 65.0;
  else if (n < 250) fix2 = 3.0 + 0.008 * (250 - n);
  else if (n < 500) fix2 = 2.0 + 0.004 * (500 - n);
  else if (n < 1000) fix2 = 1.0 + 0.002 * (1000 - n);
  else fix2 = 1.0;
  return Math.max(fix1, fix2);
}

/** beatoraja `LIMIT_INCREMENT` — HARD/EX-HARD recovery scale from TOTAL and note count. */
export function resolveBeatorajaHardRecoverMultiplier(total: number, noteCount: number): number {
  const pg = Math.max(Math.min(0.15, (2 * total - 320) / Math.max(1, noteCount)), 0);
  return pg / 0.15;
}

type GaugeValues = readonly [number, number, number, number, number, number];

/**
 * LR2's recovery gauges: PGREAT and GREAT gain `total / (float)notes` and GOOD `total / (float)(notes + notes)`, a
 * float32 division, which EASY then multiplies by 1.2 in `double` (OpenLR2 `LR2f.cpp` L27658-L27684) [R]. Damage stays
 * as given.
 */
function lr2RecoveryValues(
  multiplier: number,
  damage: readonly [number, number, number],
  total: number,
  noteCount: number,
): GaugeValues {
  const notes = Math.max(1, noteCount);
  const gain = Math.fround(total / notes) * multiplier;
  return [gain, gain, Math.fround(total / (notes + notes)) * multiplier, ...damage];
}

const FLOAT_0_15 = Math.fround(0.15);

/**
 * beatoraja's gauge table as `GrooveGauge.Gauge` builds it in Java `float`: the base values are float constants, and
 * TOTAL, LIMIT_INCREMENT and MODIFY_DAMAGE round to float32 where Java does (`GaugeModifier`, beatoraja `8320241d`) [V].
 */
function beatorajaGaugeValues(
  modifier: 'total' | 'limit' | 'damage' | undefined,
  base: GaugeValues,
  total: number,
  noteCount: number,
): GaugeValues {
  const notes = Math.max(1, noteCount);
  const f32 = Math.fround;
  let modify: (value: number) => number = (value) => value;
  if (modifier === 'total') modify = (value) => (value > 0 ? f32((value * total) / notes) : value);
  else if (modifier === 'limit') {
    const pg = f32(Math.max(Math.min(FLOAT_0_15, (2 * total - 320) / notes), 0));
    const scale = f32(pg / FLOAT_0_15);
    modify = (value) => (value > 0 ? f32(value * scale) : value);
  } else if (modifier === 'damage') {
    const totals = [240, 230, 210, 200, 180, 160, 150, 130, 120, 0];
    const multipliers = [1, 1.11, 1.25, 1.5, 1.666, 2, 2.5, 3.333, 5, 10].map(f32);
    let index = 0;
    while (index < totals.length - 1 && total < totals[index]!) index++;
    let fix2 = 1;
    let note = 1000;
    let step = f32(0.002);
    while (note > notes || note > 1) {
      fix2 = f32(fix2 + f32(step * (note - Math.max(notes, Math.trunc(note / 2)))));
      note = Math.trunc(note / 2);
      step = f32(step * 2);
    }
    const scale = Math.max(multipliers[index]!, fix2);
    modify = (value) => (value < 0 ? f32(value * scale) : value);
  }
  return base.map((value) => modify(f32(value))) as unknown as GaugeValues;
}

function scaleNegative(values: GaugeValues, multiplier: number): GaugeValues {
  return values.map((value) => (value < 0 ? value * multiplier : value)) as unknown as GaugeValues;
}

function resolveLR2Gauge(gaugeId: string, total: number, noteCount: number): GaugeSpec {
  switch (gaugeId) {
    case 'P-ATTACK':
      return createLR2PerfectAttackGauge();
    case 'G-ATTACK':
      return createLR2GoodAttackGauge(resolveLR2HardDamageMultiplier(total, noteCount));
    case 'EASY':
      return {
        id: 'EASY',
        min: 2,
        max: 100,
        initial: 20,
        border: 80,
        survival: false,
        values: lr2RecoveryValues(1.2, [-3.2, -4.800000000000001, -1.6], total, noteCount),
        guts: [],
      };
    case 'HARD': {
      const damage = resolveLR2HardDamageMultiplier(total, noteCount);
      return {
        id: 'HARD',
        min: 0,
        max: 100,
        initial: 100,
        border: 0,
        survival: true,
        death: 2,
        values: scaleNegative([0.1, 0.1, 0.05, -6.0, -10.0, -2.0], damage),
        guts: [{ threshold: 32, multiplier: 0.6 }],
      };
    }
    case 'EX-HARD': {
      const damage = resolveLR2HardDamageMultiplier(total, noteCount);
      return {
        id: 'EX-HARD',
        min: 0,
        max: 100,
        initial: 100,
        border: 0,
        survival: true,
        death: 2,
        values: scaleNegative([0.1, 0.1, 0.05, -12.0, -20.0, -2.0], damage),
        guts: [],
      };
    }
    case 'DEATH':
    case 'DEATH-CORRECTED':
      // LR2's own DEATH table (OpenLR2 LR2f.cpp L27673-L27680; LR2body.exe `ParseBMSFile` case 2 at 0x4b5c2e):
      // no gain at all, BAD / POOR kill, and an empty POOR costs nothing. beatoraja's HAZARD_LR2 differs. LR2's
      // CheckClear also wants HP 80 at the end of a single chart, as for GROOVE (L1842-L1862), so a mine can leave a
      // surviving run FAILED; the corrected HAZARD clears by surviving (#1082).
      return {
        id: gaugeId,
        min: 0,
        max: 100,
        initial: 100,
        border: 0,
        survival: true,
        death: 2,
        values: [0, 0, 0, -100, -100, 0],
        guts: [],
        ...(gaugeId === 'DEATH' ? { clearBorder: 80 } : {}),
      };
    default:
      return {
        id: 'GROOVE',
        min: 2,
        max: 100,
        initial: 20,
        border: 80,
        survival: false,
        values: lr2RecoveryValues(1, [-4.0, -6.0, -2.0], total, noteCount),
        guts: [],
      };
  }
}

const BEATORAJA_HARD_GUTS: readonly GaugeGutsStep[] = [
  { threshold: 10, multiplier: 0.4 },
  { threshold: 20, multiplier: 0.5 },
  { threshold: 30, multiplier: 0.6 },
  { threshold: 40, multiplier: 0.7 },
  { threshold: 50, multiplier: 0.8 },
];

/** beatoraja `GaugeProperty`: the gauge table family; a play mode picks its own unless PRACTICE names one. */
export type BeatorajaGaugeCategory = 'FIVEKEYS' | 'SEVENKEYS' | 'PMS' | 'KEYBOARD' | 'LR2';

/**
 * The play rules PRACTICE sets (beatoraja's `BMSPlayer` STATE_PRACTICE, `PracticeModifier`, `getGauge`), read under the
 * judge ruleset (#933): beatoraja as the source does; LR2 on its own gauges, window table and TOTAL; That-Which-Must-Not-
 * Be-Named on its own gauges only, since its windows are fixed and its gauges do not use TOTAL.
 */
export interface PracticeRules {
  /** The scorable note counts before PracticeModifier moved the notes outside the range to the background. */
  sourceNotes: RulesetNoteCounts;
  /**
   * `TOTAL`; absent keeps the whole chart's. beatoraja scales it by the notes left in the range for NORMAL and gentler
   * gauges; LR2 uses it as is. Ignored under That-Which-Must-Not-Be-Named.
   */
  total?: number;
  /**
   * `JUDGERANK`, a judgerank percent; absent keeps the chart's. beatoraja reads it on its `NORMAL` rule (rank 2 = 75),
   * LR2 on its `#RANK` table, where 25 / 50 / 75 / 100 are `#RANK` 0-3. Ignored under That-Which-Must-Not-Be-Named.
   */
  judgeRank?: number;
  /**
   * `GAUGE TYPE`: one of the judge ruleset's `resolvePracticeGaugeTypes`, or another source's qualified with it
   * (`beatoraja:ASSIST-EASY`), which plays on that source's gauge and TOTAL reading (ADR 0019).
   */
  gauge: PracticeGaugePick;
  /** `GAUGE CATEGORY` (beatoraja only); absent uses the play mode's. */
  gaugeCategory?: BeatorajaGaugeCategory;
  /** `GAUGE VALUE`, clamped to the gauge's range. */
  startGauge: number;
}

// GaugeProperty.java: modifier, minimum, maximum, initial value, clear border, judge deltas and guts.
type BeatorajaGaugeProperty = readonly [
  modifier: 'total' | 'limit' | 'damage' | undefined,
  min: number,
  max: number,
  initial: number,
  border: number,
  values: GaugeValues,
  guts?: readonly GaugeGutsStep[],
];
const BEATORAJA_SINGLE_GAUGES: Record<BeatorajaGaugeCategory, readonly BeatorajaGaugeProperty[]> = {
  // Selectable only from PRACTICE's GAUGE CATEGORY in 0.8.9.
  LR2: [
    ['total', 2, 100, 20, 60, [1.2, 1.2, 0.6, -3.2, -4.8, -1.6]],
    ['total', 2, 100, 20, 80, [1.2, 1.2, 0.6, -3.2, -4.8, -1.6]],
    ['total', 2, 100, 20, 80, [1, 1, 0.5, -4, -6, -2]],
    ['damage', 0, 100, 100, 0, [0.1, 0.1, 0.05, -6, -10, -2], [{ threshold: 30, multiplier: 0.6 }]],
    ['damage', 0, 100, 100, 0, [0.1, 0.1, 0.05, -12, -20, -2]],
    [undefined, 0, 100, 100, 0, [0.15, 0.06, 0, -100, -100, -10]],
  ],
  FIVEKEYS: [
    ['total', 2, 100, 20, 50, [1, 1, 0.5, -1.5, -3, -0.5]],
    ['total', 2, 100, 20, 75, [1, 1, 0.5, -1.5, -4.5, -1]],
    ['total', 2, 100, 20, 75, [1, 1, 0.5, -3, -6, -2]],
    ['limit', 0, 100, 100, 0, [0, 0, 0, -5, -10, -5]],
    ['damage', 0, 100, 100, 0, [0, 0, 0, -10, -20, -10]],
    [undefined, 0, 100, 100, 0, [0, 0, 0, -100, -100, -100]],
  ],
  SEVENKEYS: [
    ['total', 2, 100, 20, 60, [1, 1, 0.5, -1.5, -3, -0.5]],
    ['total', 2, 100, 20, 80, [1, 1, 0.5, -1.5, -4.5, -1]],
    ['total', 2, 100, 20, 80, [1, 1, 0.5, -3, -6, -2]],
    ['limit', 0, 100, 100, 0, [0.15, 0.12, 0.03, -5, -10, -5], BEATORAJA_HARD_GUTS],
    ['limit', 0, 100, 100, 0, [0.15, 0.06, 0, -8, -16, -8]],
    [undefined, 0, 100, 100, 0, [0.15, 0.06, 0, -100, -100, -10]],
  ],
  PMS: [
    ['total', 2, 120, 30, 65, [1, 1, 0.5, -1, -2, -2]],
    ['total', 2, 120, 30, 85, [1, 1, 0.5, -1, -3, -3]],
    ['total', 2, 120, 30, 85, [1, 1, 0.5, -2, -6, -6]],
    ['limit', 0, 100, 100, 0, [0.15, 0.12, 0.03, -5, -10, -10], BEATORAJA_HARD_GUTS],
    ['limit', 0, 100, 100, 0, [0.15, 0.06, 0, -10, -15, -15]],
    [undefined, 0, 100, 100, 0, [0.15, 0.06, 0, -100, -100, -100]],
  ],
  KEYBOARD: [
    ['total', 2, 100, 30, 50, [1, 1, 0.5, -1, -2, -1]],
    ['total', 2, 100, 20, 70, [1, 1, 0.5, -1, -3, -1]],
    ['total', 2, 100, 20, 70, [1, 1, 0.5, -2, -4, -2]],
    ['limit', 0, 100, 100, 0, [0.2, 0.2, 0.1, -4, -8, -4], BEATORAJA_HARD_GUTS],
    ['limit', 0, 100, 100, 0, [0.2, 0.1, 0, -6, -12, -6]],
    [undefined, 0, 100, 100, 0, [0.2, 0.1, 0, -100, -100, -100]],
  ],
};
const BEATORAJA_SINGLE_GAUGE_IDS = ['ASSIST-EASY', 'EASY', 'NORMAL', 'HARD', 'EX-HARD', 'HAZARD'];

function resolveBeatorajaGaugeCategory(laneMode: string): BeatorajaGaugeCategory {
  const mode = resolveBeatorajaMode(laneMode);
  return mode === BEATORAJA_MODES.FIVEKEYS
    ? 'FIVEKEYS'
    : mode === BEATORAJA_MODES.PMS
      ? 'PMS'
      : mode === BEATORAJA_MODES.KEYBOARD
        ? 'KEYBOARD'
        : 'SEVENKEYS';
}

function resolveBeatorajaGauge(
  gaugeId: string,
  total: number,
  noteCount: number,
  laneMode: string,
  category?: BeatorajaGaugeCategory,
): GaugeSpec {
  const mode = resolveBeatorajaMode(laneMode);
  const rows = category
    ? BEATORAJA_SINGLE_GAUGES[category]
    : mode === BEATORAJA_MODES.FIVEKEYS
      ? BEATORAJA_SINGLE_GAUGES.FIVEKEYS
      : mode === BEATORAJA_MODES.PMS
        ? BEATORAJA_SINGLE_GAUGES.PMS
        : mode === BEATORAJA_MODES.KEYBOARD
          ? BEATORAJA_SINGLE_GAUGES.KEYBOARD
          : BEATORAJA_SINGLE_GAUGES.SEVENKEYS;
  const index = BEATORAJA_SINGLE_GAUGE_IDS.indexOf(gaugeId);
  const [modifier, min, max, initial, border, base, guts = []] = rows[index >= 0 ? index : 2]!;
  const values = beatorajaGaugeValues(modifier, base, total, noteCount);
  const f32Guts = guts.map((step) => ({ ...step, multiplier: Math.fround(step.multiplier) }));
  return {
    id: index >= 0 ? gaugeId : 'NORMAL',
    min,
    max,
    initial,
    border,
    survival: min === 0,
    values,
    guts: f32Guts,
    float32: true,
  };
}

function resolve____Gauge(gaugeId: string, noteCount: number): GaugeSpec {
  const a = resolve____GaugeUnit(noteCount);
  switch (gaugeId) {
    case 'ASSISTED-EASY':
      return {
        id: 'ASSISTED-EASY',
        min: 0,
        max: 100,
        initial: 22,
        border: 60,
        survival: false,
        values: [a, a, a / 2, -1.6, -4.8, -1.6],
        guts: [],
      };
    case 'EASY':
      return {
        id: 'EASY',
        min: 0,
        max: 100,
        initial: 22,
        border: 80,
        survival: false,
        values: [a, a, a / 2, -1.6, -4.8, -1.6],
        guts: [],
      };
    case 'HARD':
      return {
        id: 'HARD',
        min: 0,
        max: 100,
        initial: 100,
        border: 0,
        survival: true,
        // Low Life Adjustment: at or below 30 %, BAD / POOR damage is halved (https://iidx.org).
        values: [0.16, 0.16, 0, -5, -9, -5],
        guts: [{ threshold: 30, multiplier: 0.5, inclusive: true }],
      };
    case 'EX-HARD':
      return {
        id: 'EX-HARD',
        min: 0,
        max: 100,
        initial: 100,
        border: 0,
        survival: true,
        values: [0.16, 0.16, 0, -10, -18, -10],
        guts: [],
      };
    default:
      return {
        id: 'NORMAL',
        min: 0,
        max: 100,
        initial: 22,
        border: 80,
        survival: false,
        values: [a, a, a / 2, -2, -6, -2],
        guts: [],
      };
  }
}

/** Maps the replay's LR2-family gauge pick onto each ruleset's own gauge id. */
function resolveDefaultGaugeId(rulesetId: RulesetId, playGauge: string): string {
  if (rulesetId === 'plugout') return resolvePlugoutGaugeId(playGauge);
  switch (playGauge) {
    case 'P-ATTACK':
    case 'G-ATTACK':
      return playGauge;
    case 'ASSIST-EASY':
      return rulesetId === '____' ? 'ASSISTED-EASY' : 'ASSIST-EASY';
    case 'EX-HARD':
      return 'EX-HARD';
    case 'EASY':
      return 'EASY';
    case 'HARD':
      return 'HARD';
    case 'DEATH':
    case 'DEATH-CORRECTED':
      return rulesetId === 'lr2' ? playGauge : rulesetId === 'beatoraja' ? 'HAZARD' : 'EX-HARD';
    default:
      return rulesetId === 'lr2' ? 'GROOVE' : 'NORMAL';
  }
}

/**
 * Judgment-note count under one long-note style: a long note yields one judgment when it plays as an LN and two
 * (head + tail) when it plays as a charge note. This is the EX-SCORE denominator, not the note-object count.
 */
function countRulesetNotes(chart: RulesetChartFacts, style: LongNoteStyle): number {
  const { normal, long } = chart.notes;
  let count = normal;
  for (const mode of [1, 2, 3] as const) {
    count += long[mode] * (isChargeLongNoteMode(resolveEffectiveLongNoteMode(style, mode)) ? 2 : 1);
  }
  return count;
}

/**
 * One source's single-play gauges for a play another ruleset judges: its TOTAL reading and its gauge table, both over
 * `noteCount` judgments. `baseNoteCount` is the note-object count That-Which-Must-Not-Be-Named's reported TOTAL follows.
 */
function resolveSourceGauges(
  source: RulesetId,
  chart: RulesetChartFacts,
  baseNoteCount: number,
  noteCount: number,
): { effectiveTotal: number; gaugeOf: (id: string) => GaugeSpec } {
  if (source === 'lr2') {
    const effectiveTotal = resolveEffectiveTotal('lr2', chart, noteCount);
    return { effectiveTotal, gaugeOf: (id) => resolveLR2Gauge(id, effectiveTotal, noteCount) };
  }
  if (source === 'beatoraja') {
    const effectiveTotal = resolveEffectiveTotal('beatoraja', chart, noteCount);
    return { effectiveTotal, gaugeOf: (id) => resolveBeatorajaGauge(id, effectiveTotal, noteCount, chart.laneMode) };
  }
  if (source === 'plugout') {
    const effectiveTotal = resolveEffectiveTotal('plugout', chart, noteCount);
    return { effectiveTotal, gaugeOf: (id) => resolvePlugoutGauge(id, effectiveTotal, noteCount) };
  }
  return {
    effectiveTotal: resolveEffectiveTotal('____', chart, baseNoteCount),
    gaugeOf: (id) => resolve____Gauge(id, noteCount),
  };
}

/**
 * Another source's PRACTICE gauge under the judge ruleset's judging (`beatoraja:ASSIST-EASY` under LR2): the gauge as that
 * source's PRACTICE builds it, on its TOTAL reading of PRACTICE's TOTAL (LR2 as is, beatoraja scaled by the notes left in
 * the range for NORMAL and gentler gauges, AC none), over the judgments the judge ruleset issues (`noteCount`), starting
 * at `GAUGE VALUE`. `gaugeOf` builds the source's single gauges for auto-shift.
 */
function resolveSourcePracticeGauges(
  source: RulesetId,
  chart: RulesetChartFacts,
  baseNoteCount: number,
  noteCount: number,
  practice: PracticeRules,
): { effectiveTotal: number; gauge: GaugeSpec; gaugeOf: (id: string) => GaugeSpec } {
  if (source === 'lr2') {
    const effectiveTotal =
      practice.total ??
      resolveEffectiveTotal('lr2', { ...chart, notes: practice.sourceNotes }, countBaseNotes(practice.sourceNotes));
    const gaugeOf = (id: string): GaugeSpec => resolveLR2Gauge(id, effectiveTotal, noteCount);
    return { effectiveTotal, gauge: startPracticeGauge(gaugeOf(practice.gauge), practice), gaugeOf };
  }
  if (source === 'beatoraja') {
    const effectiveTotal = resolvePracticeTotal(chart, noteCount, practice);
    return {
      effectiveTotal,
      gauge: resolvePracticeGauge(practice, effectiveTotal, noteCount, chart.laneMode),
      gaugeOf: (id) => resolveBeatorajaGauge(id, effectiveTotal, noteCount, chart.laneMode),
    };
  }
  if (source === 'plugout') {
    // plugout has no PRACTICE: PRACTICE's TOTAL (else the chart's) over the judgments issued, starting at `GAUGE VALUE`.
    const effectiveTotal = practice.total ?? resolveEffectiveTotal('plugout', chart, noteCount);
    const gaugeOf = (id: string): GaugeSpec => resolvePlugoutGauge(id, effectiveTotal, noteCount);
    return { effectiveTotal, gauge: startPracticeGauge(gaugeOf(practice.gauge), practice), gaugeOf };
  }
  const gaugeOf = (id: string): GaugeSpec => resolve____Gauge(id, noteCount);
  return {
    effectiveTotal: resolveEffectiveTotal('____', chart, baseNoteCount),
    gauge: startPracticeGauge(gaugeOf(practice.gauge), practice),
    gaugeOf,
  };
}

/**
 * The TOTAL a ruleset falls back to when the chart names none: LR2's note-count curve for `lr2`, beatoraja's formula
 * for `beatoraja`. The `____` gauge never reads TOTAL (its recovery comes from {@link resolve____GaugeUnit}), so its
 * reported TOTAL follows the `lr2` curve.
 */
function resolveDefaultTotal(rulesetId: RulesetId, baseNoteCount: number, laneMode: string): number {
  if (rulesetId === 'plugout') return resolvePlugoutDefaultTotal(baseNoteCount);
  if (rulesetId === 'beatoraja' && resolveBeatorajaMode(laneMode) === BEATORAJA_MODES.KEYBOARD)
    return Math.max(300, (7.605 * (baseNoteCount + 100)) / (0.01 * baseNoteCount + 6.5));
  return rulesetId === 'beatoraja'
    ? resolveBeatorajaDefaultTotal(baseNoteCount)
    : resolveLR2DefaultTotal(baseNoteCount);
}

/** The index of a beatoraja PRACTICE gauge in the source's `GAUGE TYPE` order. */
function beatorajaPracticeGaugeIndex(practice: PracticeRules): number {
  return (BEATORAJA_PRACTICE_GAUGE_TYPES as readonly string[]).indexOf(practice.gauge);
}

/**
 * PRACTICE's TOTAL: the set `TOTAL` (else the whole chart's), scaled by the notes left in the range when the gauge is
 * NORMAL or gentler (`PracticeModifier`: `total × totalNotes / totalNotesBefore` for `gaugetype < 3`).
 */
function resolvePracticeTotal(chart: RulesetChartFacts, noteCount: number, practice: PracticeRules): number {
  const source = { ...chart, notes: practice.sourceNotes };
  const sourceCount = countRulesetNotes(source, 'per-note');
  const total = practice.total ?? resolveEffectiveTotal('beatoraja', source, sourceCount);
  return beatorajaPracticeGaugeIndex(practice) < 3 && sourceCount > 0 ? (total * noteCount) / sourceCount : total;
}

/** `PracticeConfiguration.getGauge`: the picked type of the picked category, starting at `GAUGE VALUE`. */
function resolvePracticeGauge(practice: PracticeRules, total: number, noteCount: number, laneMode: string): GaugeSpec {
  const category = practice.gaugeCategory ?? resolveBeatorajaGaugeCategory(laneMode);
  const spec =
    beatorajaPracticeGaugeIndex(practice) >= 6
      ? resolveClassGauge(
          practice.gauge,
          ({ FIVEKEYS: '5k', SEVENKEYS: '7k', PMS: '9k', KEYBOARD: '24k', LR2: 'lr2' } as const)[category],
        )
      : resolveBeatorajaGauge(practice.gauge, total, noteCount, laneMode, category);
  return startPracticeGauge(spec, practice);
}

/** A PRACTICE gauge starting at `GAUGE VALUE`, clamped to the gauge's range. */
function startPracticeGauge(spec: GaugeSpec, practice: PracticeRules): GaugeSpec {
  return { ...spec, initial: Math.min(spec.max, Math.max(spec.min, practice.startGauge)) };
}

/**
 * Gauge auto-shift's parallel gauges for a play starting on `initialGauge` (#933), on the ruleset's own ladder
 * (`resolveGaugeShiftLadder`); `gaugeOf` builds a ladder gauge by id.
 *
 * - BEST CLEAR / SELECT TO UNDER run the whole ladder in parallel ({@link RulesetConfig.gaugeBank}); SELECT TO UNDER
 *   stops at the picked gauge. A gauge off the ladder (LR2's P.ATTACK and G.ATTACK, a PRACTICE class gauge in a single
 *   play) has no place to shift from: it plays alone, to the end, as CONTINUE does.
 * - SURVIVAL TO GROOVE runs the ruleset's default recovery gauge alongside a survival gauge, outside a course
 *   ({@link RulesetConfig.gaugeFallback}).
 */
function resolveGaugeShift(
  rulesetId: RulesetId,
  options: ResolveRulesetOptions,
  initialGauge: GaugeSpec,
  gaugeOf: (id: string) => GaugeSpec,
): Pick<RulesetConfig, 'gaugeBank' | 'gaugeFallback'> {
  const { gaugeAutoShift: policy, course } = options;
  if (policy === 'BEST_CLEAR' || policy === 'SELECT_TO_UNDER') {
    // The corrected HAZARD takes HAZARD's place on LR2's ladder.
    const ladder = resolveGaugeShiftLadder(rulesetId, course?.kind).map((id) =>
      id === 'DEATH' && initialGauge.id === 'DEATH-CORRECTED' ? 'DEATH-CORRECTED' : id,
    );
    const selected = ladder.indexOf(initialGauge.id);
    if (selected < 0) return {};
    return {
      gaugeBank: {
        specs: ladder.map(gaugeOf),
        bottomIndex: resolveGaugeShiftBottomIndex(rulesetId, options.bottomShiftableGauge, course?.kind),
        ...(policy === 'SELECT_TO_UNDER' ? { upperExclusive: selected + 1 } : {}),
      },
    };
  }
  if (policy === 'SURVIVAL_TO_GROOVE' && course === undefined && initialGauge.survival)
    return { gaugeFallback: gaugeOf(resolveGaugeShiftFallbackId(rulesetId)) };
  return {};
}

/**
 * The TOTAL the gauge runs on. BMS `#TOTAL` is absolute; bmson `info.total` is a percentage of the ruleset's own
 * default TOTAL (bmson 1.0.0; beatoraja `BMSPlayerRule.validate`: `total > 0 ? total / 100 × default : default`).
 * Either way a value ≤ 0 supplies the default for arithmetic. The optional bmson spec policy suppresses
 * recovery on final gauge tables separately, without changing this damage-scaling value.
 */
function resolveEffectiveTotal(rulesetId: RulesetId, chart: RulesetChartFacts, baseNoteCount: number): number {
  // LR2 keeps TOTAL in an int: `#TOTAL` through `atol`, the default assigned to it, and a value below 1 replaced by the
  // default (OpenLR2 `LR2f.cpp` L25824, L26299, L27566-L27579).
  const lr2 = rulesetId === 'lr2';
  const fallback = lr2
    ? Math.trunc(resolveDefaultTotal(rulesetId, baseNoteCount, chart.laneMode))
    : resolveDefaultTotal(rulesetId, baseNoteCount, chart.laneMode);
  const raw = chart.total;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }
  if ((chart.totalUnit ?? (chart.sourceFormat === 'bmson' ? 'percent' : 'absolute')) === 'percent')
    return (raw / 100) * fallback;
  if (!lr2) return raw;
  const truncated = Math.trunc(raw);
  return truncated < 1 ? fallback : truncated;
}

/**
 * Builds the ruleset a play runs under, from chart facts plus the per-play choices.
 *
 * This is the single source of truth shared by the live engine and the replay simulator: both produce a
 * {@link RulesetChartFacts} from their own chart representation and get back the same tables.
 */
export function resolveRuleset(
  chart: RulesetChartFacts,
  rulesetId: RulesetId,
  options: ResolveRulesetOptions = {},
): RulesetConfig {
  if (
    options.bmsonTotalMode === 'spec' &&
    chart.total !== undefined &&
    chart.total < 0 &&
    (chart.totalUnit ?? (chart.sourceFormat === 'bmson' ? 'percent' : 'absolute')) === 'percent'
  )
    throw new RangeError('bmson spec TOTAL must be normalized to a non-negative percentage.');
  const config = withChartGaugeModifiers(resolveRulesetTables(chart, rulesetId, options), options.chartJudge);
  const practiceTotal = practiceReadsJudgeRankAndTotal(rulesetId) ? options.practice?.total : undefined;
  const disabled = isBmsonRecoveryDisabled(chart, options.bmsonTotalMode) && practiceTotal === undefined;
  if (!disabled) return config;
  const suppress = (spec: GaugeSpec): GaugeSpec => ({
    ...spec,
    recoveryDisabled: true,
    values: spec.values.map((delta) => Math.min(0, delta)) as unknown as GaugeSpec['values'],
  });
  return {
    ...config,
    gauge: suppress(config.gauge),
    ...(config.gaugeFallback === undefined ? {} : { gaugeFallback: suppress(config.gaugeFallback) }),
    ...(config.gaugeBank === undefined
      ? {}
      : { gaugeBank: { ...config.gaugeBank, specs: config.gaugeBank.specs.map(suppress) } }),
  };
}

/** A ruleset with a chart's GOOD2BAD / GREAT2BAD applied to every gauge it may run on (`applyChartGaugeModifiers`). */
function withChartGaugeModifiers(config: RulesetConfig, modifiers: ChartJudgeModifiers | undefined): RulesetConfig {
  if (modifiers?.judge === undefined) return config;
  const apply = (spec: GaugeSpec): GaugeSpec => applyChartGaugeModifiers(spec, modifiers);
  return {
    ...config,
    gauge: apply(config.gauge),
    ...(config.gaugeFallback === undefined ? {} : { gaugeFallback: apply(config.gaugeFallback) }),
    ...(config.gaugeBank === undefined
      ? {}
      : { gaugeBank: { ...config.gaugeBank, specs: config.gaugeBank.specs.map(apply) } }),
  };
}

function resolveRulesetTables(
  chart: RulesetChartFacts,
  rulesetId: RulesetId,
  options: ResolveRulesetOptions,
): RulesetConfig {
  const baseNotes = countBaseNotes(chart.notes);
  const { course } = options;
  // PRACTICE's GAUGE TYPE is a gauge of the judge ruleset's own PRACTICE list, or another source's qualified with it
  // (`beatoraja:ASSIST-EASY` under LR2), which keeps that source's gauge as a qualified gauge pick does (ADR 0019).
  const practicePick = options.practice === undefined ? undefined : splitPracticeGaugePick(options.practice.gauge);
  if (
    options.practice !== undefined &&
    (practicePick === undefined ||
      (practicePick.source === undefined && !isPracticeGaugeType(practicePick.type, rulesetId)))
  )
    throw new RangeError(`PRACTICE under ${rulesetId} rules has no ${String(options.practice.gauge)} gauge.`);
  const practiceSource = practicePick?.source ?? rulesetId;
  // The practice the judge ruleset's branch below reads: its own gauge, or its default one while another source's gauge
  // replaces it (`borrowedGauges`). `sourcePractice` names the gauge on its source's own list.
  const practice: PracticeRules | undefined =
    options.practice === undefined
      ? undefined
      : {
          ...options.practice,
          gauge: practiceSource === rulesetId ? practicePick!.type : resolveDefaultPracticeGauge(rulesetId),
        };
  const sourcePractice: PracticeRules | undefined =
    options.practice === undefined || practiceSource === rulesetId
      ? undefined
      : { ...options.practice, gauge: practicePick!.type };
  // A qualified pick (`lr2:HARD`) keeps its source's gauges under this ruleset's judging; a bare one is the ruleset's
  // own (ADR 0019, #1171). PRACTICE plays on its own GAUGE TYPE, so the play's own pick does not apply: a pick only
  // another source has (`beatoraja:ASSIST-EASY` under LR2) must not stop it.
  const pickedGauge = practice === undefined ? (options.selectedGauge ?? 'GROOVE') : 'GROOVE';
  const pickedSource = pickedGauge.slice(0, Math.max(0, pickedGauge.indexOf(':')));
  const selectedGauge = isRulesetId(pickedSource) ? pickedGauge.slice(pickedSource.length + 1) : pickedGauge;
  const gaugeSource = practice !== undefined ? practiceSource : isRulesetId(pickedSource) ? pickedSource : rulesetId;
  if (
    gaugeSource !== 'lr2' &&
    (['P-ATTACK', 'G-ATTACK'].includes(selectedGauge) || ['P-ATTACK', 'G-ATTACK'].includes(options.gauge ?? ''))
  )
    throw new RangeError('Attack gauges are available only for LR2.');
  if (gaugeSource === 'lr2' && (selectedGauge === 'EX-HARD' || selectedGauge === 'ASSIST-EASY')) {
    throw new RangeError(`LR2 beta3 has no ${selectedGauge} gauge.`);
  }
  if (gaugeSource === 'plugout' && selectedGauge === 'ASSIST-EASY') {
    throw new RangeError('plugout has no ASSIST-EASY gauge.');
  }
  if (gaugeSource !== 'plugout' && ['EX-GROOVE', 'EX-EASY', 'EX-DEATH'].includes(selectedGauge)) {
    throw new RangeError(`Only plugout has a ${selectedGauge} gauge.`);
  }
  const gaugeId =
    options.gauge ??
    (course === undefined
      ? resolveDefaultGaugeId(gaugeSource, selectedGauge)
      : resolveCourseGaugeId(gaugeSource, course.kind, selectedGauge));
  const overrideBadMs = options.judgeWindowOverrideMs;
  if (options.customJudge !== undefined && rulesetId !== 'beatoraja')
    throw new RangeError('CUSTOM JUDGE is available only for beatoraja.');
  const gambol = options.lr2Gambol;
  if (gambol !== undefined && rulesetId !== 'lr2') throw new RangeError('GAMBOL is available only for LR2.');
  if (practice !== undefined && course !== undefined) throw new RangeError('PRACTICE plays a single chart.');
  const constrain = (tables: RulesetWindowTables): RulesetWindowTables =>
    applyCourseJudgeConstraint(applyChartJudgeModifiers(tables, options.chartJudge), course?.judge);
  // A course gauge starts from the value its own id carried in (auto-shift carries every ladder gauge's), else from the
  // value the played gauge carried.
  // LR2 keeps a GROOVE or EASY pick's mine damage at 2 % on its course gauge too (#1082).
  const courseMineFloor = gaugeSource === 'lr2' && ['GROOVE', 'EASY'].includes(selectedGauge) ? 2 : undefined;
  // `notes` is the count LR2's HARD damage scales by: the judgments the judge ruleset issues.
  const courseGaugeOf = (id: string, total: number, stage: RulesetCourseOptions, notes = baseNotes): GaugeSpec => {
    const spec = resolveCourseGauge(
      gaugeSource,
      id,
      { ...stage, initialGauge: stage.initialGauges?.[id] ?? stage.initialGauge },
      chart.laneMode,
      resolveLR2HardDamageMultiplier(total, notes),
      notes,
    );
    return courseMineFloor === undefined ? spec : { ...spec, mineFloor: courseMineFloor };
  };
  const courseGauge = (total: number, notes = baseNotes): GaugeSpec | undefined =>
    course === undefined ? undefined : courseGaugeOf(gaugeId, total, course, notes);
  // Gauge auto-shift's parallel gauges; `singleGaugeOf` builds a single-play gauge of the gauge's source by id.
  const shiftGauges = (
    initialGauge: GaugeSpec,
    total: number,
    singleGaugeOf: (id: string) => GaugeSpec,
    notes = baseNotes,
  ): Pick<RulesetConfig, 'gaugeBank' | 'gaugeFallback'> =>
    resolveGaugeShift(gaugeSource, options, initialGauge, (id) =>
      course === undefined ? singleGaugeOf(id) : courseGaugeOf(id, total, course, notes),
    );
  // Another source's gauges under this ruleset's judging: the source's own tables and TOTAL reading, over the number of
  // judgments this ruleset issues (`notes`), so a play of PGREATs still recovers the source's TOTAL.
  const borrowedGauges = (
    notes: number,
  ):
    | (Pick<RulesetConfig, 'gauge' | 'gaugeBank' | 'gaugeFallback' | 'effectiveTotal'> & { gaugeSource: RulesetId })
    | undefined => {
    if (gaugeSource === rulesetId) return undefined;
    if (sourcePractice !== undefined) {
      const source = resolveSourcePracticeGauges(gaugeSource, chart, baseNotes, notes, sourcePractice);
      return {
        gaugeSource,
        gauge: source.gauge,
        ...shiftGauges(source.gauge, source.effectiveTotal, source.gaugeOf, notes),
        effectiveTotal: source.effectiveTotal,
      };
    }
    const source = resolveSourceGauges(gaugeSource, chart, baseNotes, notes);
    const gauge = courseGauge(source.effectiveTotal, notes) ?? source.gaugeOf(gaugeId);
    return {
      gaugeSource,
      gauge,
      ...shiftGauges(gauge, source.effectiveTotal, source.gaugeOf, notes),
      effectiveTotal: source.effectiveTotal,
    };
  };

  if (rulesetId === 'lr2') {
    const noteCount = countRulesetNotes(chart, 'ln');
    // PRACTICE's TOTAL is used as is; without one, the whole chart's (its notes before the range was cut).
    const effectiveTotal = practice
      ? (practice.total ??
        resolveEffectiveTotal('lr2', { ...chart, notes: practice.sourceNotes }, countBaseNotes(practice.sourceNotes)))
      : resolveEffectiveTotal('lr2', chart, baseNotes);
    // PRACTICE's JUDGERANK replaces the chart's rank for the whole play, `#EXRANKxx` changes included.
    const practiceRank = practice?.judgeRank;
    const timeline = practiceRank !== undefined ? [] : (chart.judgeRank.timeline ?? []);
    const initialStage =
      chart.sourceFormat === 'bmson' ? chart.judgeRank.stageRanks?.find((change) => change.timeUs === 0) : undefined;
    // `#DEFEXRANK` / `#EXRANKxx` scale the `#RANK 2` windows (#1190); bmson `judge_rank` and `#RANK` sit on LR2's
    // percent axis.
    const exRankTables = (value: number): RulesetWindowTables =>
      lr2WindowTables(resolveBMSJudgeWindowsMsForExRankValue(value, overrideBadMs));
    const stageTablesOf = (rank: number, table: string): RulesetWindowTables =>
      table === 'bms-exrank' || table === 'bms-exrank-change'
        ? exRankTables(rank)
        : resolveLR2WindowTables(
            table === 'bmson' ? bmsExRankValueToJudgeRankPercent(rank) : resolveBMSRankJudgeRankPercent(rank),
            overrideBadMs,
          );
    const defExRank = chart.sourceFormat === 'bmson' ? undefined : chart.judgeRank.sourceExRank;
    // GAMBOL fixes the windows whatever the chart's rank: LR2 sets them after the rank's own, as the chart opens and at
    // each NONSTOP rank object. LR2 has no `#EXRANKxx`, so a fixed window ignores those changes too.
    const gambolTables = (table: 'opening' | 'nonstop'): RulesetWindowTables =>
      constrain(lr2WindowTables(resolveLR2GambolWindowsMs(gambol!, table, overrideBadMs)));
    const staticTables =
      gambol !== undefined
        ? gambolTables('opening')
        : constrain(
            practiceRank !== undefined
              ? resolveLR2WindowTables(practiceRank, overrideBadMs)
              : initialStage !== undefined
                ? stageTablesOf(initialStage.rank, initialStage.table)
                : typeof defExRank === 'number' && Number.isFinite(defExRank) && defExRank > 0
                  ? exRankTables(defExRank)
                  : resolveLR2WindowTables(chart.judgeRank.percent, overrideBadMs),
          );
    const timelineTables = [
      ...(gambol !== undefined ? [] : timeline).map((change) => ({
        timeUs: change.timeUs,
        tables: constrain(exRankTables(change.exRankValue)),
      })),
      // A stitched NONSTOP chart's later stages (`RulesetStageRank`); stable after the `#EXRANKxx` changes on a tie.
      ...(practiceRank !== undefined ? [] : (chart.judgeRank.stageRanks ?? [])).map((change) => ({
        timeUs: change.timeUs,
        tables:
          gambol !== undefined
            ? gambolTables(change.table === 'lr2-nonstop' ? 'nonstop' : 'opening')
            : constrain(
                change.table === 'lr2-nonstop'
                  ? lr2WindowTables(resolveLR2NonstopRankWindowsMs(change.rank, overrideBadMs))
                  : stageTablesOf(change.rank, change.table),
              ),
      })),
    ].sort((left, right) => left.timeUs - right.timeUs);
    const initialGauge = practice
      ? startPracticeGauge(resolveLR2Gauge(practice.gauge, effectiveTotal, baseNotes), practice)
      : (courseGauge(effectiveTotal) ?? resolveLR2Gauge(gaugeId, effectiveTotal, baseNotes));
    return {
      id: 'lr2/0',
      rulesetId: 'lr2',
      windows: staticTables,
      windowsAt: (timeUs) => {
        let active = staticTables;
        for (const change of timelineTables) {
          if (change.timeUs <= timeUs) {
            active = change.tables;
          } else {
            break;
          }
        }
        return active;
      },
      selection: 'lowest',
      multiBad: true,
      ignoreLateBadOnLNHead: true,
      longNoteStyle: 'ln',
      lnEarlyRelease: 'head-unless-beyond-good',
      pressDuringLongNote: 'rejudge-head-or-empty-poor',
      longNoteReleaseMarginUs: { note: 0, scratch: 0 },
      headBadSkipsTail: false,
      scratchHoldsBySource: false,
      comboBreaksOnEmptyPoor: false,
      mineTrigger: 'press-ahead-or-hold',
      hcnTick: { heldJudge: 1, heldRate: 0.5, releasedJudge: 3, releasedRate: 0.5 },
      gaugeSource,
      gauge: initialGauge,
      ...shiftGauges(initialGauge, effectiveTotal, (id) => resolveLR2Gauge(id, effectiveTotal, baseNotes)),
      noteCount,
      effectiveTotal,
      ...borrowedGauges(noteCount),
      moneyScore: true,
      emptyPoorCountsInPoorDisplay: true,
    };
  }

  if (rulesetId === 'beatoraja') {
    const noteCount = countRulesetNotes(chart, 'per-note');
    const effectiveTotal = practice
      ? resolvePracticeTotal(chart, noteCount, practice)
      : resolveEffectiveTotal('beatoraja', chart, noteCount);
    const customize = (tables: RulesetWindowTables): RulesetWindowTables =>
      options.customJudge === undefined ? tables : applyCustomJudgeTables(tables, options.customJudge);
    // Legacy BMS NONSTOP stage ranks apply only to LR2. Mixed bmson courses explicitly carry each stage's units.
    // Stage-owned `#EXRANKxx` changes (`bms-exrank-change`) stay with LR2, as beatoraja ignores `A0` in a chart alone.
    const stageTables =
      chart.sourceFormat === 'bmson'
        ? (chart.judgeRank.stageRanks ?? [])
            .filter((change) => change.table !== 'bms-exrank-change')
            .map((change) => ({
              timeUs: change.timeUs,
              tables: constrain(
                customize(
                  resolveBeatorajaWindowTables({
                    ...chart,
                    sourceFormat: change.table === 'bmson' ? 'bmson' : 'bms',
                    judgeRank: {
                      percent: chart.judgeRank.percent,
                      ...(change.table === 'bmson' || change.table === 'bms-exrank'
                        ? { sourceExRank: change.rank }
                        : { sourceRank: change.rank }),
                    },
                  }),
                ),
              ),
            }))
        : [];
    const tables =
      stageTables.find((change) => change.timeUs === 0)?.tables ??
      constrain(customize(resolveBeatorajaWindowTables(chart, practice?.judgeRank)));
    const mode = resolveBeatorajaMode(chart.laneMode);
    const initialGauge = practice
      ? resolvePracticeGauge(practice, effectiveTotal, noteCount, chart.laneMode)
      : (courseGauge(effectiveTotal) ?? resolveBeatorajaGauge(gaugeId, effectiveTotal, noteCount, chart.laneMode));
    // FIVEKEYS / PMS break combo on an empty POOR (JudgeProperty combo[MS] = false).
    const comboBreaksOnEmptyPoor = mode === BEATORAJA_MODES.FIVEKEYS || mode === BEATORAJA_MODES.PMS;
    return {
      id: 'beatoraja/0',
      rulesetId: 'beatoraja',
      windows: tables,
      windowsAt: (timeUs) => {
        let active = tables;
        for (const change of stageTables) {
          if (change.timeUs > timeUs) break;
          active = change.tables;
        }
        return active;
      },
      selection: options.judgeAlgorithm ?? 'combo',
      multiBad: false,
      ignoreLateBadOnLNHead: false,
      longNoteStyle: 'per-note',
      lnEarlyRelease: 'worse-of-head-and-tail',
      pressDuringLongNote: 'ignore',
      // JudgeManager: only the key margin takes the CUSTOM JUDGE rate (`nreleasemargin`).
      longNoteReleaseMarginUs: {
        note: Math.trunc(
          ((mode === BEATORAJA_MODES.PMS ? 200_000 : 0) * (options.customJudge?.longNoteMargin ?? 100)) / 100,
        ),
        scratch: 0,
      },
      headBadSkipsTail: false,
      scratchHoldsBySource: true,
      comboBreaksOnEmptyPoor,
      mineTrigger: 'hold',
      hcnTick: { heldJudge: 1, heldRate: 0.5, releasedJudge: 3, releasedRate: 0.5 },
      gaugeSource,
      gauge: initialGauge,
      ...shiftGauges(initialGauge, effectiveTotal, (id) =>
        resolveBeatorajaGauge(id, effectiveTotal, noteCount, chart.laneMode),
      ),
      noteCount,
      effectiveTotal,
      ...borrowedGauges(noteCount),
      moneyScore: false,
      emptyPoorCountsInPoorDisplay: false,
    };
  }

  if (rulesetId === 'plugout') {
    // Long notes count twice: the tail is a judgment of its own (0x43c050), and TOTAL's default counts it too.
    const played = withoutRulesetNotes(withoutRulesetNotes(chart, options.autoScratchNotes), options.uncountedNotes);
    const noteCount = countRulesetNotes(played, 'charge');
    const effectiveTotal = practice?.total ?? resolveEffectiveTotal('plugout', played, noteCount);
    return resolvePlugoutRuleset({
      chart: played,
      practice,
      gaugeId,
      gaugeSource,
      noteCount,
      effectiveTotal,
      overrideBadMs,
      constrain,
      startPracticeGauge,
      courseGauge: (total, notes) => courseGauge(total, notes),
      shiftGauges,
      borrowedGauges,
    });
  }

  const noteCount = countRulesetNotes(chart, 'charge');
  const effectiveTotal = resolveEffectiveTotal('____', chart, baseNotes);
  const ____Tables = constrain(_____WINDOWS);
  // PRACTICE sets only the gauge here: the windows are fixed and the gauges do not use TOTAL.
  const initialGauge = practice
    ? startPracticeGauge(resolve____Gauge(practice.gauge, noteCount), practice)
    : (courseGauge(effectiveTotal) ?? resolve____Gauge(gaugeId, noteCount));
  return {
    id: '____/0',
    rulesetId: '____',
    windows: ____Tables,
    windowsAt: () => ____Tables,
    selection: 'lowest',
    multiBad: false,
    ignoreLateBadOnLNHead: false,
    longNoteStyle: 'charge',
    // That-Which-Must-Not-Be-Named plays no LN (every long note is a charge note), so this never applies.
    lnEarlyRelease: 'worse-of-head-and-tail',
    pressDuringLongNote: 'ignore',
    longNoteReleaseMarginUs: { note: 0, scratch: 0 },
    headBadSkipsTail: true,
    scratchHoldsBySource: false,
    comboBreaksOnEmptyPoor: false,
    // AC has no mines: import LR2's policy, trigger and POOR accounting together (#1169).
    mineTrigger: 'press-ahead-or-hold',
    hcnTick: { heldJudge: 0, heldRate: 1, releasedJudge: 5, releasedRate: 1 },
    gaugeSource,
    gauge: initialGauge,
    ...shiftGauges(initialGauge, effectiveTotal, (id) => resolve____Gauge(id, noteCount)),
    noteCount,
    effectiveTotal,
    ...borrowedGauges(noteCount),
    moneyScore: false,
    emptyPoorCountsInPoorDisplay: false,
  };
}
