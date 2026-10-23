import type { JudgeWindowSetUs, LongNoteStyle, RulesetConfig } from './definitions.ts';
import { classifyRulesetJudge, judgeWindowLateReachUs, RULESET_JUDGE_NONE, type RulesetJudgeIndex } from './judge.ts';

/**
 * Long-note and multi-note rules that both the live engine (`core/judge-core.ts`) and the replay simulator
 * (`replay/simulate.ts`) apply. They are pure functions of the ruleset and the notes involved, so the two judges
 * cannot drift on them.
 */

/** A long note's mode: 1 LN (one deferred judgment), 2 CN, 3 HCN (charge modes judge head and tail separately). */
export type RulesetLongNoteMode = 1 | 2 | 3;

/**
 * How the active ruleset plays a long note, which is not always what the chart's `#LNMODE` asks for:
 *
 * - LR2 (`'ln'`) plays every long note as an LN — one deferred judgment (an early release follows `lnEarlyRelease`).
 * - beatoraja (`'per-note'`) honours the chart: 1 = LN, 2 = CN, 3 = HCN.
 * - IIDX (`'charge'`) has no LN at all — every long note is a charge note, HCN where the chart says 3.
 */
export function resolveEffectiveLongNoteMode(
  style: LongNoteStyle,
  chartMode: RulesetLongNoteMode,
): RulesetLongNoteMode {
  switch (style) {
    case 'ln':
      return 1;
    case 'charge':
      return chartMode === 3 ? 3 : 2;
    default:
      return chartMode;
  }
}

/** True for the modes that score the head on the press and the tail on the release (two judgments per note). */
export function isChargeLongNoteMode(mode: RulesetLongNoteMode): boolean {
  return mode === 2 || mode === 3;
}

/**
 * True when a long note the player never held owes a SECOND miss for its tail. Charge modes score head and tail
 * separately, so a note missed at the head owes two POORs — except under IIDX, where a broken head cancels the tail
 * outright (`headBadSkipsTail`). `playedMode` is the mode the ruleset plays the note as, `undefined` for a tap.
 */
export function longNoteOwesTailMiss(
  ruleset: Pick<RulesetConfig, 'headBadSkipsTail'>,
  playedMode: RulesetLongNoteMode | undefined,
): boolean {
  return !ruleset.headBadSkipsTail && playedMode !== undefined && isChargeLongNoteMode(playedMode);
}

/**
 * LR2: a long-note head has no LATE BAD — a press that would judge an LN head as a late BAD falls through to whatever
 * else is in reach instead. `judge` is a best-to-worst judge index (3 = BAD), `late` is true when the note lies
 * before the press, and `playedMode` is as above.
 */
export function ignoresLateLongNoteHeadBad(
  ruleset: Pick<RulesetConfig, 'ignoreLateBadOnLNHead'>,
  judge: number,
  late: boolean,
  playedMode: RulesetLongNoteMode | undefined,
): boolean {
  return ruleset.ignoreLateBadOnLNHead && judge === 3 && late && playedMode === 1;
}

/**
 * How far after a note a press can still judge it (µs) — past this the note is missed. An LN head under LR2 has no
 * late BAD ({@link ignoresLateLongNoteHeadBad}), so it is missed once time moves past its late GOOD leg (OpenLR2
 * `ProcLongnote`, LR2f.cpp:7542); every other note reaches as far as its windows do.
 */
export function noteLateReachUs(
  ruleset: Pick<RulesetConfig, 'ignoreLateBadOnLNHead'>,
  set: JudgeWindowSetUs,
  playedMode: RulesetLongNoteMode | undefined,
): number {
  if (!ruleset.ignoreLateBadOnLNHead || playedMode !== 1) {
    return judgeWindowLateReachUs(set);
  }
  let reach = 0;
  for (const window of set.judges.slice(0, 3)) {
    if (-window[0] > reach) reach = -window[0];
  }
  return reach;
}

/** A judgment index best to worst, 0 PGREAT … 3 BAD, 4 POOR. */
export type LNJudgeIndex = 0 | 1 | 2 | 3 | 4;

/** An LN judgment and the signed timing it was made at (`dmUs = markTime - inputTime`, positive = EARLY). */
export interface LNTimedJudge {
  judge: LNJudgeIndex;
  dmUs: number;
}

/**
 * The single judgment of an LN (long-note mode 1) released before its tail: `head` is the deferred head judgment,
 * `releaseDmUs` is `tailTime - releaseTime` (positive, the release came first) and `endWindows` the ruleset's
 * long-note-end window set for the lane. See {@link RulesetConfig.lnEarlyRelease} for the two rules.
 */
export function resolveLNEarlyRelease(
  ruleset: Pick<RulesetConfig, 'lnEarlyRelease'>,
  head: LNTimedJudge,
  releaseDmUs: number,
  endWindows: JudgeWindowSetUs,
): LNTimedJudge {
  if (ruleset.lnEarlyRelease === 'head-unless-beyond-good') {
    return releaseDmUs > endWindows.judges[2][1] ? { judge: 3, dmUs: releaseDmUs } : head;
  }
  const tail = classifyRulesetJudge(releaseDmUs, endWindows);
  const tailJudge: LNJudgeIndex = tail === RULESET_JUDGE_NONE ? 4 : tail;
  const judge: LNJudgeIndex = tailJudge > head.judge ? tailJudge : head.judge;
  const dmUs = Math.abs(head.dmUs) > Math.abs(releaseDmUs) ? head.dmUs : releaseDmUs;
  return { judge: judge >= 3 && dmUs > 0 ? 3 : judge, dmUs };
}

/** beatoraja's Hell Charge tick period (`JudgeManager.hcnmduration`, 200 ms). */
export const HCN_TICK_US = 200_000;

/**
 * beatoraja's Hell Charge gauge ticks (`JudgeManager` L289-L340), shared by the engine and the replay simulator.
 *
 * While an HCN passes the judge line (from its head, once the head is judged, until its tail) a signed counter runs:
 * up while the lane gains (a key on it is down, or the tail was released at GOOD or better), down otherwise. Each time
 * it passes +{@link HCN_TICK_US} the gauge gains one tick and the counter drops back by a period; each time it passes
 * −{@link HCN_TICK_US} the gauge loses one. Whatever is left is dropped when the tail passes.
 *
 * Time is whole microseconds; a tick falls on the first microsecond the counter is beyond the period, and like every
 * timed judgment it is reported once time has moved past it.
 */
export class HCNTickCounter {
  private counterUs = 0;
  private atUs: number;
  private gaining = false;

  constructor(startUs: number) {
    this.atUs = startUs;
  }

  /** Runs the counter up to (not including) `untilUs`, reporting each tick: `gain` up or down, and its microsecond. */
  advance(untilUs: number, onTick: (gain: boolean, atUs: number) => void): void {
    while (this.atUs < untilUs) {
      const tickAtUs = this.nextTickUs();
      if (tickAtUs >= untilUs) {
        this.counterUs += (this.gaining ? 1 : -1) * (untilUs - this.atUs);
        this.atUs = untilUs;
        return;
      }
      this.counterUs = this.gaining ? 1 : -1;
      this.atUs = tickAtUs;
      onTick(this.gaining, tickAtUs);
    }
  }

  /** Switches between gaining and losing at `atUs`, after running the counter up to it. */
  setGaining(gaining: boolean, atUs: number, onTick: (gain: boolean, atUs: number) => void): void {
    this.advance(atUs, onTick);
    this.gaining = gaining;
  }

  /** The microsecond of the next tick if nothing changes. */
  nextTickUs(): number {
    return this.gaining
      ? this.atUs + (HCN_TICK_US - this.counterUs) + 1
      : this.atUs + (this.counterUs + HCN_TICK_US) + 1;
  }
}

/** A Hell Charge note passing the judge line, chained to the lane's next one judged before this one has passed. */
export interface HCNPassingLink<T> {
  /** The tail's microsecond: the ticks stop there. */
  endUs: number;
  next?: T;
}

/**
 * Adds a Hell Charge passing that ticks from `startUs` to a lane's chain (ordered by tail) and returns the chain's new
 * head. beatoraja ticks the HCN that is crossing the judge line (`JudgeManager` L235-L242, L307), so a note judged
 * early queues behind the one still passing, and a head judged only after its tail passed (missed late) never ticks:
 * then the chain comes back unchanged.
 */
export function addHCNPassing<T extends HCNPassingLink<T>>(
  head: T | undefined,
  passing: T,
  startUs: number,
): T | undefined {
  if (startUs >= passing.endUs) {
    return head;
  }
  if (head === undefined || passing.endUs < head.endUs) {
    passing.next = head;
    return passing;
  }
  head.next = addHCNPassing(head.next, passing, startUs);
  return head;
}

/** The note a press consumed, as the multi-BAD collector sees it. Times are in any one unit, compared only. */
export interface MultiBadConsumedNote {
  time: number;
  isLong: boolean;
  judge: RulesetJudgeIndex;
}

/** Another unjudged note inside the BAD window but outside the GOOD window of the same press. */
export interface MultiBadCandidateNote {
  time: number;
  isLong: boolean;
}

/**
 * @deprecated Legacy lr2oraja predicate; LR2 gameplay uses a forward re-judge chain.
 * lr2oraja `MultiBadCollector` pruning: once a press consumed `consumed`, a note sitting in the BAD-but-not-GOOD band
 * on the pressed lanes also resolves as a BAD — except that notes AFTER the consumed one only fall when the consumed
 * note was itself a BAD and not a long note, and long notes BEFORE the consumed one are always spared.
 */
export function isMultiBadCollectorTarget(consumed: MultiBadConsumedNote, note: MultiBadCandidateNote): boolean {
  if ((consumed.judge !== 3 || consumed.isLong) && note.time > consumed.time) {
    return false;
  }
  return !(note.isLong && note.time < consumed.time);
}
