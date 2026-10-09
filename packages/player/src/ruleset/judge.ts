import type { JudgeWindowSetUs, RulesetWindowTables } from './definitions.ts';

/**
 * Judge index inside a window set, best to worst: 0 PGREAT, 1 GREAT, 2 GOOD, 3 BAD. Matches the ordering the gauge
 * tables use, so a classification result indexes straight into {@link GaugeJudgeIndex} territory.
 */
export type RulesetJudgeIndex = 0 | 1 | 2 | 3;

/** Returned when the timing delta falls outside every scoreable window — the press judges nothing. */
export const RULESET_JUDGE_NONE = -1;

export type RulesetJudgeClassification = RulesetJudgeIndex | typeof RULESET_JUDGE_NONE;

/**
 * Which of a ruleset's four window tables a judgment reads. Every ruleset ships all four; the ones that do not
 * distinguish a context simply repeat the same table (LR2 uses one table for keys and scratch, PMS has no scratch
 * at all), so callers never need to know which rulesets differentiate.
 */
export interface JudgeWindowContext {
  /** Scratch lanes (`16` / `26`) — wider than key lanes under beatoraja's five- and seven-key rules. */
  scratch?: boolean;
  /** Long-note ends — a separate table with no empty-POOR window, and asymmetric legs under beatoraja. */
  longNoteEnd?: boolean;
}

export function selectJudgeWindowSet(tables: RulesetWindowTables, context: JudgeWindowContext): JudgeWindowSetUs {
  if (context.longNoteEnd === true) {
    return context.scratch === true ? tables.longScratchEnd : tables.longNoteEnd;
  }
  return context.scratch === true ? tables.scratch : tables.note;
}

/**
 * Classify a timing delta against one window set. `dmUs` follows the module's convention —
 * `dmUs = noteTimeUs - inputTimeUs`, so POSITIVE is an EARLY (FAST) press and NEGATIVE is a LATE (SLOW) one.
 *
 * Walks the windows inner to outer and returns the first that contains the delta, so a set whose tables are not
 * monotonic still resolves to the strictest matching judge.
 */
export function classifyRulesetJudge(dmUs: number, set: JudgeWindowSetUs): RulesetJudgeClassification {
  for (let index = 0; index < set.judges.length; index += 1) {
    const window = set.judges[index]!;
    if (dmUs >= window[0] && dmUs <= window[1]) {
      // The tuple only holds the four scoreable windows, so the index is always a valid judge index.
      return index as RulesetJudgeIndex;
    }
  }
  return RULESET_JUDGE_NONE;
}

/**
 * How far AFTER a note a press can still land and be judged (µs, positive). Past this the note is unreachable and
 * the miss sweep retires it. Taken as the widest late leg across all four windows rather than the BAD leg alone,
 * since nothing guarantees the tables are monotonic on both sides.
 */
export function judgeWindowLateReachUs(set: JudgeWindowSetUs): number {
  let reach = 0;
  for (const window of set.judges) {
    if (-window[0] > reach) reach = -window[0];
  }
  return reach;
}

/** How far BEFORE a note a press can still land and be judged (µs, positive) — the mirror of the late reach. */
export function judgeWindowEarlyReachUs(set: JudgeWindowSetUs): number {
  let reach = 0;
  for (const window of set.judges) {
    if (window[1] > reach) reach = window[1];
  }
  return reach;
}

/**
 * The PGREAT window as positive reaches `[lateUs, earlyUs]` — the range LR2 uses for mine press detonation (its
 * changelog: a mine explodes on a press "within the PGREAT range", not GOOD; holding through a mine detonates at
 * the crossing instead). Returned in reach form rather than raw bounds so callers comparing elapsed time do not
 * have to re-derive the signs.
 */
export function pgreatWindowReachUs(set: JudgeWindowSetUs): readonly [number, number] {
  const [lateBound, earlyBound] = set.judges[0];
  return [-lateBound, earlyBound];
}
