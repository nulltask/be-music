import { resolveBmsJudgeWindowsMsForPercent, bmsExRankValueToJudgeRankPercent } from '../core/judge-window.ts';
import type { BeMusicPlaylog, PlaylogChart } from './format.ts';

/**
 * Ruleset tables for the playlog simulators.
 *
 * Every numeric constant here was read from primary sources (2026-08 HEAD):
 * - beatoraja: `exch-bms2/beatoraja` — `play/JudgeProperty.java`, `play/JudgeAlgorithm.java`,
 *   `play/JudgeManager.java`, `play/GaugeProperty.java`, `play/GrooveGauge.java`, `play/BMSPlayerRule.java`.
 * - LR2: `wcko87/lr2oraja` / `seraxis/lr2oraja-endlessdream` (`JudgeProperty.LR2`, `JudgeWindowRule.LR2`,
 *   `GaugeProperty` LR2 variants with `death = 2` / guts `{32, 0.6}`, `MultiBadCollector`) cross-checked against
 *   the OpenLR2 transcription (`GOMazk/OpenLR2` — `Scene04_Play.cpp`, `LR2_bmsload.cpp`).
 * - IIDX: community measurements (iidx.org compendium; dbm_capture / leisurely1 measurements). IIDX internals are
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

export type PlaylogRulesetId = 'lr2' | 'beatoraja' | 'iidx';

export type BeatorajaJudgeAlgorithm = 'combo' | 'duration' | 'lowest' | 'score';

/** How a ruleset plays the chart's long notes. */
export type LongNoteStyle =
  /** LR2: every long note is an LN — one deferred judgment, early release = BAD. */
  | 'ln'
  /** beatoraja: per-note lnMode decides LN (1) vs CN (2) vs HCN (3). */
  | 'per-note'
  /** IIDX: every long note is a CN (HCN when the chart says mode 3) — head and tail judged separately. */
  | 'charge';

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
  /** Versioned ruleset id written into the result (`'lr2/1'` etc.). */
  id: string;
  rulesetId: PlaylogRulesetId;
  windows: RulesetWindowTables;
  /**
   * LR2 dynamic `#EXRANKxx` support: returns the window tables active at `timeUs`. Rulesets without dynamic
   * rank support return the static tables.
   */
  windowsAt: (timeUs: number) => RulesetWindowTables;
  selection: BeatorajaJudgeAlgorithm;
  /** LR2 multi-BAD: one press BADs every other in-BAD-window (but out-of-GOOD-window) note on the lane. */
  multiBad: boolean;
  /** LR2: a long-note head is never judged as a LATE bad — the press is ignored instead. */
  ignoreLateBadOnLnHead: boolean;
  longNoteStyle: LongNoteStyle;
  /** IIDX: a BAD / POOR on a charge-note head skips the tail judgment entirely. */
  headBadSkipsTail: boolean;
  comboBreaksOnEmptyPoor: boolean;
  /** HCN hold-state gauge tick interval (µs). */
  hcnTickUs: number;
  /** HCN tick deltas as `[heldJudgeIndex, heldRate, releasedJudgeIndex, releasedRate]` (beatoraja model). */
  hcnTick: { heldJudge: number; heldRate: number; releasedJudge: number; releasedRate: number };
  gauge: GaugeSpec;
  /** EX-SCORE denominator note count (longs count 1 for LN styles, 2 for charge styles). */
  noteCount: number;
  /** Effective TOTAL after the ruleset's default formula. */
  effectiveTotal: number;
  /** LR2 money score (`(4PG + 2GR + GD) × 50000 / notes`, floored). */
  moneyScore: boolean;
}

export interface ResolveRulesetOptions {
  /** Overrides the gauge picked from `playlog.play.gauge`. Ruleset-scoped id (see gauge tables). */
  gauge?: string;
  /** beatoraja note-selection algorithm (default `'combo'`, beatoraja's own default). */
  judgeAlgorithm?: BeatorajaJudgeAlgorithm;
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

function resolveLr2WindowTables(percent: number, overrideBadMs: number | undefined): RulesetWindowTables {
  const windows = resolveBmsJudgeWindowsMsForPercent(percent, overrideBadMs);
  const note = scale(windows);
  const longEnd = lr2LongNoteEnd(windows);
  return { note, scratch: note, longNoteEnd: longEnd, longScratchEnd: longEnd };
}

/** beatoraja judgerank percent per `BMSPlayerRule.validate` (NORMAL window rule). */
function resolveBeatorajaJudgeRank(chart: PlaylogChart, rankTable: readonly number[]): number {
  const exRank = chart.judgeRank.sourceExRank;
  if (typeof exRank === 'number' && exRank > 0) {
    if (chart.sourceFormat === 'bmson') {
      return exRank;
    }
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
 * `judgerank / 100`, clamp every leg to the BAD leg, then enforce inner-to-outer monotonicity.
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
      const badLeg = flat[3 * 2 + side]!;
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

function resolveBeatorajaWindowTables(chart: PlaylogChart): RulesetWindowTables {
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

// IIDX community-consensus windows (iidx.org): PG ±1F / GR ±2F / GD ±7F / BD ±15F at 60 fps.
const IIDX_NOTE: JudgeWindowSetUs = {
  judges: [
    [-16667, 16667],
    [-33333, 33333],
    [-116667, 116667],
    [-250000, 250000],
  ],
  // The IIDX empty-POOR window has never been measured precisely; beatoraja's MS window (late 150 ms /
  // early 500 ms) is used as the stand-in.
  ms: [-150000, 500000],
};
// IIDX CN release windows are "significantly wider" but unmeasured — beatoraja's SEVENKEYS long-note end
// windows are used as the stand-in.
const IIDX_LN_END: JudgeWindowSetUs = {
  judges: [
    [-120000, 120000],
    [-160000, 160000],
    [-200000, 200000],
    [-280000, 220000],
  ],
};

const IIDX_WINDOWS: RulesetWindowTables = {
  note: IIDX_NOTE,
  scratch: IIDX_NOTE,
  longNoteEnd: IIDX_LN_END,
  longScratchEnd: IIDX_LN_END,
};

/** LR2 default TOTAL (OpenLR2 `LR2_bmsload.cpp`): piecewise-linear in the note count, ×0.8. */
export function resolveLr2DefaultTotal(noteCount: number): number {
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
 * IIDX gauge recovery unit ("a value", percent per PGREAT/GREAT) — iidx.org measurement: `260 / n` up to 338
 * notes, `760.5 / (n + 650)` beyond, rounded to the nearest 0.02 %.
 */
export function resolveIidxGaugeUnit(noteCount: number): number {
  const n = Math.max(1, noteCount);
  const raw = n <= 338 ? 260 / n : 760.5 / (n + 650);
  return Math.round(raw / 0.02 + 1e-9) * 0.02;
}

/**
 * lr2oraja `MODIFY_DAMAGE` — LR2 HARD/EX-HARD damage multiplier from TOTAL (fix1) and note count (fix2).
 */
export function resolveLr2HardDamageMultiplier(total: number, noteCount: number): number {
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

function resolveLr2Gauge(gaugeId: string, total: number, noteCount: number): GaugeSpec {
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
      const damage = resolveLr2HardDamageMultiplier(total, noteCount);
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
      const damage = resolveLr2HardDamageMultiplier(total, noteCount);
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
      // lr2oraja HAZARD_LR2 (beatoraja-derived values — LR2's own G-ATTACK/P-ATTACK family has no exact analog).
      return {
        id: 'DEATH',
        min: 0,
        max: 100,
        initial: 100,
        border: 0,
        survival: true,
        death: 2,
        values: [0.15, 0.06, 0, -100, -100, -10],
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

function resolveBeatorajaGauge(gaugeId: string, total: number, noteCount: number): GaugeSpec {
  switch (gaugeId) {
    case 'ASSIST-EASY':
      return {
        id: 'ASSIST-EASY',
        min: 2,
        max: 100,
        initial: 20,
        border: 60,
        survival: false,
        values: totalModifier([1.0, 1.0, 0.5, -1.5, -3.0, -0.5], total, noteCount),
        guts: [],
      };
    case 'EASY':
      return {
        id: 'EASY',
        min: 2,
        max: 100,
        initial: 20,
        border: 80,
        survival: false,
        values: totalModifier([1.0, 1.0, 0.5, -1.5, -4.5, -1.0], total, noteCount),
        guts: [],
      };
    case 'HARD': {
      const recover = resolveBeatorajaHardRecoverMultiplier(total, noteCount);
      return {
        id: 'HARD',
        min: 0,
        max: 100,
        initial: 100,
        border: 0,
        survival: true,
        values: scalePositive([0.15, 0.12, 0.03, -5.0, -10.0, -5.0], recover),
        guts: BEATORAJA_HARD_GUTS,
      };
    }
    case 'EX-HARD': {
      const recover = resolveBeatorajaHardRecoverMultiplier(total, noteCount);
      return {
        id: 'EX-HARD',
        min: 0,
        max: 100,
        initial: 100,
        border: 0,
        survival: true,
        values: scalePositive([0.15, 0.06, 0, -8.0, -16.0, -8.0], recover),
        guts: [],
      };
    }
    case 'HAZARD':
      return {
        id: 'HAZARD',
        min: 0,
        max: 100,
        initial: 100,
        border: 0,
        survival: true,
        values: [0.15, 0.06, 0, -100, -100, -10],
        guts: [],
      };
    default:
      return {
        id: 'NORMAL',
        min: 2,
        max: 100,
        initial: 20,
        border: 80,
        survival: false,
        values: totalModifier([1.0, 1.0, 0.5, -3.0, -6.0, -2.0], total, noteCount),
        guts: [],
      };
  }
}

function resolveIidxGauge(gaugeId: string, noteCount: number): GaugeSpec {
  const a = resolveIidxGaugeUnit(noteCount);
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
        // Low Life Adjustment: at or below 30 %, BAD / POOR damage is halved (iidx.org).
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

/** Maps the play-log's LR2-family gauge pick onto each ruleset's own gauge id. */
function resolveDefaultGaugeId(rulesetId: PlaylogRulesetId, playGauge: string): string {
  switch (playGauge) {
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

function countRulesetNotes(chart: PlaylogChart, style: LongNoteStyle): number {
  let count = 0;
  for (const note of chart.notes) {
    if (note.type === 'normal') {
      count += 1;
    } else if (note.type === 'long') {
      const mode = note.lnMode ?? chart.lnMode;
      const chargeHeadAndTail = style === 'charge' || (style === 'per-note' && (mode === 2 || mode === 3));
      count += chargeHeadAndTail ? 2 : 1;
    }
  }
  return count;
}

function resolveEffectiveTotal(rulesetId: PlaylogRulesetId, chart: PlaylogChart, baseNoteCount: number): number {
  const raw = chart.total;
  if (rulesetId === 'beatoraja') {
    const fallback = resolveBeatorajaDefaultTotal(baseNoteCount);
    if (chart.sourceFormat === 'bmson') {
      // bmson `info.total` is a percentage of the default TOTAL in beatoraja.
      return typeof raw === 'number' && raw > 0 ? (raw / 100) * fallback : fallback;
    }
    return typeof raw === 'number' && raw > 0 ? raw : fallback;
  }
  if (typeof raw === 'number' && raw > 0) {
    return raw;
  }
  return resolveLr2DefaultTotal(baseNoteCount);
}

/** Number of scorable base notes (longs count 1) — the TOTAL formulas all use this denominator. */
function countBaseNotes(chart: PlaylogChart): number {
  let count = 0;
  for (const note of chart.notes) {
    if (note.type === 'normal' || note.type === 'long') {
      count += 1;
    }
  }
  return count;
}

export function resolveRulesetConfig(
  playlog: BeMusicPlaylog,
  rulesetId: PlaylogRulesetId,
  options: ResolveRulesetOptions = {},
): RulesetConfig {
  const chart = playlog.chart;
  const baseNotes = countBaseNotes(chart);
  const gaugeId = options.gauge ?? resolveDefaultGaugeId(rulesetId, playlog.play.gauge);
  const overrideBadMs = playlog.play.judgeWindowOverrideMs;

  if (rulesetId === 'lr2') {
    const noteCount = countRulesetNotes(chart, 'ln');
    const effectiveTotal = resolveEffectiveTotal('lr2', chart, baseNotes);
    const timeline = chart.judgeRank.timeline ?? [];
    const staticTables = resolveLr2WindowTables(chart.judgeRank.percent, overrideBadMs);
    const timelineTables = timeline.map((change) => ({
      timeUs: change.timeUs,
      tables: resolveLr2WindowTables(bmsExRankValueToJudgeRankPercent(change.exRankValue), overrideBadMs),
    }));
    return {
      id: 'lr2/1',
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
      ignoreLateBadOnLnHead: true,
      longNoteStyle: 'ln',
      headBadSkipsTail: false,
      comboBreaksOnEmptyPoor: false,
      hcnTickUs: 200_000,
      hcnTick: { heldJudge: 1, heldRate: 0.5, releasedJudge: 3, releasedRate: 0.5 },
      gauge: resolveLr2Gauge(gaugeId, effectiveTotal, baseNotes),
      noteCount,
      effectiveTotal,
      moneyScore: true,
    };
  }

  if (rulesetId === 'beatoraja') {
    const noteCount = countRulesetNotes(chart, 'per-note');
    const effectiveTotal = resolveEffectiveTotal('beatoraja', chart, baseNotes);
    const tables = resolveBeatorajaWindowTables(chart);
    const mode = resolveBeatorajaMode(chart.laneMode);
    // FIVEKEYS / PMS break combo on an empty POOR (JudgeProperty combo[MS] = false).
    const comboBreaksOnEmptyPoor = mode === BEATORAJA_MODES.FIVEKEYS || mode === BEATORAJA_MODES.PMS;
    return {
      id: 'beatoraja/1',
      rulesetId: 'beatoraja',
      windows: tables,
      windowsAt: () => tables,
      selection: options.judgeAlgorithm ?? 'combo',
      multiBad: false,
      ignoreLateBadOnLnHead: false,
      longNoteStyle: 'per-note',
      headBadSkipsTail: false,
      comboBreaksOnEmptyPoor,
      hcnTickUs: 200_000,
      hcnTick: { heldJudge: 1, heldRate: 0.5, releasedJudge: 3, releasedRate: 0.5 },
      gauge: resolveBeatorajaGauge(gaugeId, effectiveTotal, baseNotes),
      noteCount,
      effectiveTotal,
      moneyScore: false,
    };
  }

  const noteCount = countRulesetNotes(chart, 'charge');
  const effectiveTotal = resolveEffectiveTotal('lr2', chart, baseNotes);
  return {
    id: 'iidx/1',
    rulesetId: 'iidx',
    windows: IIDX_WINDOWS,
    windowsAt: () => IIDX_WINDOWS,
    selection: 'lowest',
    multiBad: false,
    ignoreLateBadOnLnHead: false,
    longNoteStyle: 'charge',
    headBadSkipsTail: true,
    comboBreaksOnEmptyPoor: false,
    hcnTickUs: 200_000,
    hcnTick: { heldJudge: 0, heldRate: 1, releasedJudge: 5, releasedRate: 1 },
    gauge: resolveIidxGauge(gaugeId, noteCount),
    noteCount,
    effectiveTotal,
    moneyScore: false,
  };
}
