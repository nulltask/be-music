import type { GaugeAutoShift } from './gauge-type.ts';
import {
  bmsExRankValueToJudgeRankPercent,
  resolveBMSJudgeWindowsMsForPercent,
  resolveBMSRankJudgeRankPercent,
  resolveLR2NonstopRankWindowsMs,
  type JudgeWindowsMs,
} from '../core/judge-window.ts';
import {
  applyCourseJudgeConstraint,
  resolveCourseGauge,
  resolveCourseGaugeId,
  type RulesetCourseOptions,
} from './course.ts';
import { countBaseNotes, type RulesetChartFacts } from './facts.ts';
import { isChargeLongNoteMode, resolveEffectiveLongNoteMode } from './long-note.ts';

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
export const RULESET_IDS = ['lr2', 'beatoraja', '____'] as const;

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
 *   passed mines retire immediately and hits count as POOR without changing combo or EX-SCORE.
 * - `'press-or-hold'` — the historical provisional That-Which-Must-Not-Be-Named model: the lane's key is held as the mine crosses the judge line, or
 *   pressed while the mine is inside the PGREAT window.
 * - `'hold'` — beatoraja (`JudgeManager` L244): the key is down at the moment the mine crosses the line; a press
 *   shortly before or after does nothing.
 */
export type MineTrigger = 'press-ahead-or-hold' | 'press-or-hold' | 'hold';

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
  /** Gauge value below (or at, when `inclusive`) which the damage multiplier applies. */
  threshold: number;
  multiplier: number;
  inclusive?: boolean;
}

export interface GaugeSpec {
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
  /** Per-judge deltas in percent, `[PG, GR, GD, BD, missPOOR, emptyPOOR]`, AFTER TOTAL modifiers. */
  values: readonly [number, number, number, number, number, number];
  /** Low-gauge damage reduction steps (first match wins). */
  guts: readonly GaugeGutsStep[];
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
  comboBreaksOnEmptyPoor: boolean;
  /** When a mine detonates (see {@link MineTrigger}). */
  mineTrigger: MineTrigger;
  /** HCN tick deltas as `[heldJudgeIndex, heldRate, releasedJudgeIndex, releasedRate]` (beatoraja model). */
  hcnTick: { heldJudge: number; heldRate: number; releasedJudge: number; releasedRate: number };
  gauge: GaugeSpec;
  /** SURVIVAL TO GROOVE tracks NORMAL from chart start, never on course class gauges. */
  gaugeFallback?: GaugeSpec;
  /** EX-SCORE denominator note count (longs count 1 for LN styles, 2 for charge styles). */
  noteCount: number;
  /**
   * The TOTAL the gauge runs on: BMS `#TOTAL` as is, bmson `info.total` as a percentage of this ruleset's default, or
   * the default itself when the chart names none (or a value ≤ 0).
   */
  effectiveTotal: number;
  /** LR2 money score (`(4PG + 2GR + GD) × 50000 / notes`, floored). */
  moneyScore: boolean;
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
  /** Forces a specific ruleset-scoped gauge id (see the gauge tables), bypassing {@link selectedGauge} mapping. */
  gauge?: string;
  /**
   * The LR2-family gauge the player picked (`'GROOVE'` / `'EASY'` / `'HARD'` / `'DEATH'`). Mapped onto each
   * ruleset's own line-up by `resolveDefaultGaugeId`. Defaults to `'GROOVE'`.
   */
  selectedGauge?: string;
  gaugeAutoShift?: GaugeAutoShift;
  /** Debug BAD-window override (`PlayerOptions.judgeWindowMs`) — non-standard, applies to every window table. */
  judgeWindowOverrideMs?: number;
  /** beatoraja note-selection algorithm (default `'combo'`, beatoraja's own default). */
  judgeAlgorithm?: BeatorajaJudgeAlgorithm;
  /**
   * The play is a course stage: it runs on the ruleset's course gauge (see `resolveCourseGauge`), starting from the
   * value carried in, and under the course's judge constraint.
   */
  course?: RulesetCourseOptions;
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

interface BeatorajaModeWindows {
  note: readonly number[];
  scratch?: readonly number[];
  longNoteEnd: readonly number[];
  longScratchEnd?: readonly number[];
  rankTable: readonly number[];
  /** Which judge windows scale with judgerank (`[PG, GR, GD, BD]`; MS is always fixed). */
  scaled: readonly [boolean, boolean, boolean, boolean];
}

// beatoraja JudgeProperty flat tables: {PG late, PG early, GR..., GD..., BD..., MS late, MS early} in µs.
const BEATORAJA_MODES: Record<'FIVEKEYS' | 'SEVENKEYS' | 'PMS' | 'KEYBOARD', BeatorajaModeWindows> = {
  FIVEKEYS: {
    note: [-20000, 20000, -50000, 50000, -100000, 100000, -150000, 150000, -150000, 500000],
    scratch: [-30000, 30000, -60000, 60000, -110000, 110000, -160000, 160000, -160000, 500000],
    longNoteEnd: [-120000, 120000, -150000, 150000, -200000, 200000, -250000, 250000],
    longScratchEnd: [-130000, 130000, -160000, 160000, -110000, 110000, -260000, 260000],
    rankTable: [25, 50, 75, 100, 125],
    scaled: [true, true, true, true],
  },
  SEVENKEYS: {
    note: [-20000, 20000, -60000, 60000, -150000, 150000, -280000, 220000, -150000, 500000],
    scratch: [-30000, 30000, -70000, 70000, -160000, 160000, -290000, 230000, -160000, 500000],
    longNoteEnd: [-120000, 120000, -160000, 160000, -200000, 200000, -280000, 220000],
    longScratchEnd: [-130000, 130000, -170000, 170000, -210000, 210000, -290000, 230000],
    rankTable: [25, 50, 75, 100, 125],
    scaled: [true, true, true, true],
  },
  PMS: {
    note: [-20000, 20000, -50000, 50000, -117000, 117000, -183000, 183000, -175000, 500000],
    longNoteEnd: [-120000, 120000, -150000, 150000, -217000, 217000, -283000, 283000],
    rankTable: [33, 50, 70, 100, 133],
    scaled: [false, true, true, false],
  },
  KEYBOARD: {
    note: [-30000, 30000, -90000, 90000, -200000, 200000, -320000, 240000, -200000, 650000],
    longNoteEnd: [-160000, 25000, -200000, 75000, -260000, 140000, -320000, 240000],
    rankTable: [25, 50, 75, 100, 125],
    scaled: [true, true, true, true],
  },
};

function resolveBeatorajaMode(laneMode: string): BeatorajaModeWindows {
  if (laneMode.startsWith('5') || laneMode.startsWith('10')) return BEATORAJA_MODES.FIVEKEYS;
  if (laneMode.startsWith('9')) return BEATORAJA_MODES.PMS;
  if (laneMode.startsWith('24') || laneMode.startsWith('48')) return BEATORAJA_MODES.KEYBOARD;
  return BEATORAJA_MODES.SEVENKEYS;
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

function resolveBeatorajaWindowTables(chart: RulesetChartFacts): RulesetWindowTables {
  const mode = resolveBeatorajaMode(chart.laneMode);
  const judgeRank = resolveBeatorajaJudgeRank(chart, mode.rankTable);
  const note = scaleBeatorajaWindows(mode.note, judgeRank, mode.scaled);
  const scratch = mode.scratch ? scaleBeatorajaWindows(mode.scratch, judgeRank, mode.scaled) : note;
  const longNoteEnd = scaleBeatorajaWindows(mode.longNoteEnd, judgeRank, mode.scaled);
  const longScratchEnd = mode.longScratchEnd
    ? scaleBeatorajaWindows(mode.longScratchEnd, judgeRank, mode.scaled)
    : longNoteEnd;
  return { note, scratch, longNoteEnd, longScratchEnd };
}

// That-Which-Must-Not-Be-Named community-consensus windows (https://iidx.org): PG ±1F / GR ±2F / GD ±7F / BD ±15F at 60 fps.
const _____NOTE: JudgeWindowSetUs = {
  judges: [
    [-16667, 16667],
    [-33333, 33333],
    [-116667, 116667],
    [-250000, 250000],
  ],
  // The That-Which-Must-Not-Be-Named empty-POOR window has never been measured precisely; beatoraja's MS window (late 150 ms /
  // early 500 ms) is used as the stand-in.
  ms: [-150000, 500000],
};
// That-Which-Must-Not-Be-Named CN release windows are "significantly wider" but unmeasured — beatoraja's SEVENKEYS long-note end
// windows are used as the stand-in.
const _____LN_END: JudgeWindowSetUs = {
  judges: [
    [-120000, 120000],
    [-160000, 160000],
    [-200000, 200000],
    [-280000, 220000],
  ],
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

function totalModifier(values: GaugeValues, total: number, noteCount: number): GaugeValues {
  return values.map((value) =>
    value > 0 ? (value * total) / Math.max(1, noteCount) : value,
  ) as unknown as GaugeValues;
}

function scalePositive(values: GaugeValues, multiplier: number): GaugeValues {
  return values.map((value) => (value > 0 ? value * multiplier : value)) as unknown as GaugeValues;
}

function scaleNegative(values: GaugeValues, multiplier: number): GaugeValues {
  return values.map((value) => (value < 0 ? value * multiplier : value)) as unknown as GaugeValues;
}

function resolveLR2Gauge(gaugeId: string, total: number, noteCount: number): GaugeSpec {
  switch (gaugeId) {
    case 'EASY':
      return {
        id: 'EASY',
        min: 2,
        max: 100,
        initial: 20,
        border: 80,
        survival: false,
        values: totalModifier([1.2, 1.2, 0.6, -3.2, -4.8, -1.6], total, noteCount),
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
      // LR2's own DEATH table (OpenLR2 LR2f.cpp L27673-L27680; LR2body.exe `ParseBMSFile` case 2 at 0x4b5c2e):
      // no gain at all, BAD / POOR kill, and an empty POOR costs nothing. beatoraja's HAZARD_LR2 differs.
      return {
        id: 'DEATH',
        min: 0,
        max: 100,
        initial: 100,
        border: 0,
        survival: true,
        death: 2,
        values: [0, 0, 0, -100, -100, 0],
        guts: [],
      };
    default:
      return {
        id: 'GROOVE',
        min: 2,
        max: 100,
        initial: 20,
        border: 80,
        survival: false,
        values: totalModifier([1.0, 1.0, 0.5, -4.0, -6.0, -2.0], total, noteCount),
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
const BEATORAJA_SINGLE_GAUGES: Record<keyof typeof BEATORAJA_MODES, readonly BeatorajaGaugeProperty[]> = {
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

/** beatoraja MODIFY_DAMAGE, used by five-key EX-HARD (distinct from LR2's damage formula). */
function beatorajaFiveKeyDamageMultiplier(total: number, noteCount: number): number {
  const totals = [240, 230, 210, 200, 180, 160, 150, 130, 120, 0];
  const multipliers = [1, 1.11, 1.25, 1.5, 1.666, 2, 2.5, 3.333, 5, 10];
  let index = 0;
  while (index < totals.length - 1 && total < totals[index]!) index++;
  let countMultiplier = 1;
  let notes = 1000;
  let step = 0.002;
  // Preserve upstream's OR condition and integer halving, including its treatment of sparse charts.
  while (notes > noteCount || notes > 1) {
    countMultiplier += step * (notes - Math.max(noteCount, Math.trunc(notes / 2)));
    notes = Math.trunc(notes / 2);
    step *= 2;
  }
  return Math.max(multipliers[index]!, countMultiplier);
}

function resolveBeatorajaGauge(gaugeId: string, total: number, noteCount: number, laneMode: string): GaugeSpec {
  const mode = resolveBeatorajaMode(laneMode);
  const rows =
    mode === BEATORAJA_MODES.FIVEKEYS
      ? BEATORAJA_SINGLE_GAUGES.FIVEKEYS
      : mode === BEATORAJA_MODES.PMS
        ? BEATORAJA_SINGLE_GAUGES.PMS
        : mode === BEATORAJA_MODES.KEYBOARD
          ? BEATORAJA_SINGLE_GAUGES.KEYBOARD
          : BEATORAJA_SINGLE_GAUGES.SEVENKEYS;
  const index = BEATORAJA_SINGLE_GAUGE_IDS.indexOf(gaugeId);
  const [modifier, min, max, initial, border, base, guts = []] = rows[index >= 0 ? index : 2]!;
  const values =
    modifier === 'total'
      ? totalModifier(base, total, noteCount)
      : modifier === 'limit'
        ? scalePositive(base, resolveBeatorajaHardRecoverMultiplier(total, noteCount))
        : modifier === 'damage'
          ? scaleNegative(base, beatorajaFiveKeyDamageMultiplier(total, noteCount))
          : base;
  return { id: index >= 0 ? gaugeId : 'NORMAL', min, max, initial, border, survival: min === 0, values, guts };
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
  switch (playGauge) {
    case 'ASSIST-EASY':
      return rulesetId === '____' ? 'ASSISTED-EASY' : 'ASSIST-EASY';
    case 'EX-HARD':
      return 'EX-HARD';
    case 'EASY':
      return 'EASY';
    case 'HARD':
      return 'HARD';
    case 'DEATH':
      return rulesetId === 'lr2' ? 'DEATH' : rulesetId === 'beatoraja' ? 'HAZARD' : 'EX-HARD';
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
 * The TOTAL a ruleset falls back to when the chart names none: LR2's note-count curve for `lr2`, beatoraja's formula
 * for `beatoraja`. The `____` gauge never reads TOTAL (its recovery comes from {@link resolve____GaugeUnit}), so its
 * reported TOTAL follows the `lr2` curve.
 */
function resolveDefaultTotal(rulesetId: RulesetId, baseNoteCount: number, laneMode: string): number {
  if (rulesetId === 'beatoraja' && resolveBeatorajaMode(laneMode) === BEATORAJA_MODES.KEYBOARD)
    return Math.max(300, (7.605 * (baseNoteCount + 100)) / (0.01 * baseNoteCount + 6.5));
  return rulesetId === 'beatoraja'
    ? resolveBeatorajaDefaultTotal(baseNoteCount)
    : resolveLR2DefaultTotal(baseNoteCount);
}

/**
 * The TOTAL the gauge runs on. BMS `#TOTAL` is absolute; bmson `info.total` is a percentage of the ruleset's own
 * default TOTAL (bmson 1.0.0; beatoraja `BMSPlayerRule.validate`: `total > 0 ? total / 100 × default : default`).
 * Either way a value ≤ 0 means "use the default", so bmson `total: 0` does not freeze the gauge.
 */
function resolveEffectiveTotal(rulesetId: RulesetId, chart: RulesetChartFacts, baseNoteCount: number): number {
  const fallback = resolveDefaultTotal(rulesetId, baseNoteCount, chart.laneMode);
  const raw = chart.total;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }
  return (chart.totalUnit ?? (chart.sourceFormat === 'bmson' ? 'percent' : 'absolute')) === 'percent'
    ? (raw / 100) * fallback
    : raw;
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
  const baseNotes = countBaseNotes(chart.notes);
  const { course } = options;
  const selectedGauge = options.selectedGauge ?? 'GROOVE';
  if (rulesetId === 'lr2' && (selectedGauge === 'EX-HARD' || selectedGauge === 'ASSIST-EASY')) {
    throw new RangeError(`LR2 beta3 has no ${selectedGauge} gauge.`);
  }
  const gaugeId =
    options.gauge ??
    (course === undefined
      ? resolveDefaultGaugeId(rulesetId, selectedGauge)
      : resolveCourseGaugeId(rulesetId, course.kind, selectedGauge));
  const overrideBadMs = options.judgeWindowOverrideMs;
  const constrain = (tables: RulesetWindowTables): RulesetWindowTables =>
    applyCourseJudgeConstraint(tables, course?.judge);
  const courseGauge = (total: number): GaugeSpec | undefined =>
    course === undefined
      ? undefined
      : resolveCourseGauge(
          rulesetId,
          gaugeId,
          course,
          chart.laneMode,
          resolveLR2HardDamageMultiplier(total, baseNotes),
        );

  if (rulesetId === 'lr2') {
    const noteCount = countRulesetNotes(chart, 'ln');
    const effectiveTotal = resolveEffectiveTotal('lr2', chart, baseNotes);
    const timeline = chart.judgeRank.timeline ?? [];
    const initialStage =
      chart.sourceFormat === 'bmson' ? chart.judgeRank.stageRanks?.find((change) => change.timeUs === 0) : undefined;
    const stagePercent = (rank: number, table: string): number =>
      table === 'bmson' || table === 'bms-exrank'
        ? bmsExRankValueToJudgeRankPercent(rank)
        : resolveBMSRankJudgeRankPercent(rank);
    const staticTables = constrain(
      resolveLR2WindowTables(
        initialStage !== undefined ? stagePercent(initialStage.rank, initialStage.table) : chart.judgeRank.percent,
        overrideBadMs,
      ),
    );
    const timelineTables = [
      ...timeline.map((change) => ({
        timeUs: change.timeUs,
        tables: constrain(resolveLR2WindowTables(bmsExRankValueToJudgeRankPercent(change.exRankValue), overrideBadMs)),
      })),
      // A stitched NONSTOP chart's later stages (`RulesetStageRank`); stable after the `#EXRANKxx` changes on a tie.
      ...(chart.judgeRank.stageRanks ?? []).map((change) => ({
        timeUs: change.timeUs,
        tables: constrain(
          change.table === 'lr2-nonstop'
            ? lr2WindowTables(resolveLR2NonstopRankWindowsMs(change.rank, overrideBadMs))
            : resolveLR2WindowTables(stagePercent(change.rank, change.table), overrideBadMs),
        ),
      })),
    ].sort((left, right) => left.timeUs - right.timeUs);
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
      comboBreaksOnEmptyPoor: false,
      mineTrigger: 'press-ahead-or-hold',
      hcnTick: { heldJudge: 1, heldRate: 0.5, releasedJudge: 3, releasedRate: 0.5 },
      gauge: courseGauge(effectiveTotal) ?? resolveLR2Gauge(gaugeId, effectiveTotal, baseNotes),
      noteCount,
      effectiveTotal,
      moneyScore: true,
      emptyPoorCountsInPoorDisplay: true,
    };
  }

  if (rulesetId === 'beatoraja') {
    const noteCount = countRulesetNotes(chart, 'per-note');
    const effectiveTotal = resolveEffectiveTotal('beatoraja', chart, noteCount);
    // Legacy BMS NONSTOP stage ranks apply only to LR2. Mixed bmson courses explicitly carry each stage's units.
    const stageTables =
      chart.sourceFormat === 'bmson'
        ? (chart.judgeRank.stageRanks ?? []).map((change) => ({
            timeUs: change.timeUs,
            tables: constrain(
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
          }))
        : [];
    const tables =
      stageTables.find((change) => change.timeUs === 0)?.tables ?? constrain(resolveBeatorajaWindowTables(chart));
    const mode = resolveBeatorajaMode(chart.laneMode);
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
      longNoteReleaseMarginUs: { note: mode === BEATORAJA_MODES.PMS ? 200_000 : 0, scratch: 0 },
      headBadSkipsTail: false,
      comboBreaksOnEmptyPoor,
      mineTrigger: 'hold',
      hcnTick: { heldJudge: 1, heldRate: 0.5, releasedJudge: 3, releasedRate: 0.5 },
      gauge: courseGauge(effectiveTotal) ?? resolveBeatorajaGauge(gaugeId, effectiveTotal, noteCount, chart.laneMode),
      ...(options.gaugeAutoShift === 'SURVIVAL_TO_GROOVE' && course === undefined
        ? { gaugeFallback: resolveBeatorajaGauge('NORMAL', effectiveTotal, noteCount, chart.laneMode) }
        : {}),
      noteCount,
      effectiveTotal,
      moneyScore: false,
      emptyPoorCountsInPoorDisplay: false,
    };
  }

  const noteCount = countRulesetNotes(chart, 'charge');
  const effectiveTotal = resolveEffectiveTotal('____', chart, baseNotes);
  const ____Tables = constrain(_____WINDOWS);
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
    comboBreaksOnEmptyPoor: false,
    // That-Which-Must-Not-Be-Named has no mines; LR2's model stands in until there is evidence otherwise.
    mineTrigger: 'press-or-hold',
    hcnTick: { heldJudge: 0, heldRate: 1, releasedJudge: 5, releasedRate: 1 },
    gauge: courseGauge(effectiveTotal) ?? resolve____Gauge(gaugeId, noteCount),
    noteCount,
    effectiveTotal,
    moneyScore: false,
    emptyPoorCountsInPoorDisplay: false,
  };
}
