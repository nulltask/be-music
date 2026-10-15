import type { JudgeWindowSetUs, LongNoteStyle, RulesetConfig } from './definitions.ts';
import { classifyRulesetJudge, RULESET_JUDGE_NONE, type RulesetJudgeIndex } from './judge.ts';

/**
 * Long-note and multi-note rules that both the live engine (`core/judge-core.ts`) and the play-log simulator
 * (`playlog/simulate.ts`) apply. They are pure functions of the ruleset and the notes involved, so the two judges
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
  ruleset: Pick<RulesetConfig, 'ignoreLateBadOnLnHead'>,
  judge: number,
  late: boolean,
  playedMode: RulesetLongNoteMode | undefined,
): boolean {
  return ruleset.ignoreLateBadOnLnHead && judge === 3 && late && playedMode === 1;
}

/** A judgment index best to worst, 0 PGREAT … 3 BAD, 4 POOR. */
export type LnJudgeIndex = 0 | 1 | 2 | 3 | 4;

/** An LN judgment and the signed timing it was made at (`dmUs = markTime - inputTime`, positive = EARLY). */
export interface LnTimedJudge {
  judge: LnJudgeIndex;
  dmUs: number;
}

/**
 * The single judgment of an LN (long-note mode 1) released before its tail: `head` is the deferred head judgment,
 * `releaseDmUs` is `tailTime - releaseTime` (positive, the release came first) and `endWindows` the ruleset's
 * long-note-end window set for the lane. See {@link RulesetConfig.lnEarlyRelease} for the two rules.
 */
export function resolveLnEarlyRelease(
  ruleset: Pick<RulesetConfig, 'lnEarlyRelease'>,
  head: LnTimedJudge,
  releaseDmUs: number,
  endWindows: JudgeWindowSetUs,
): LnTimedJudge {
  if (ruleset.lnEarlyRelease === 'head-unless-beyond-good') {
    return releaseDmUs > endWindows.judges[2][1] ? { judge: 3, dmUs: releaseDmUs } : head;
  }
  const tail = classifyRulesetJudge(releaseDmUs, endWindows);
  const tailJudge: LnJudgeIndex = tail === RULESET_JUDGE_NONE ? 4 : tail;
  const judge: LnJudgeIndex = tailJudge > head.judge ? tailJudge : head.judge;
  const dmUs = Math.abs(head.dmUs) > Math.abs(releaseDmUs) ? head.dmUs : releaseDmUs;
  return { judge: judge >= 3 && dmUs > 0 ? 3 : judge, dmUs };
}

/** beatoraja's Hell Charge tick period (`JudgeManager.hcnmduration`, 200 ms). */
export const HCN_TICK_US = 200_000;

/**
 * beatoraja's Hell Charge gauge ticks (`JudgeManager` L289-L340), shared by the engine and the play-log simulator.
 *
 * While an HCN passes the judge line (from its head, once the head is judged, until its tail) a signed counter runs:
 * up while the lane gains (a key on it is down, or the tail was released at GOOD or better), down otherwise. Each time
 * it passes +{@link HCN_TICK_US} the gauge gains one tick and the counter drops back by a period; each time it passes
 * −{@link HCN_TICK_US} the gauge loses one. Whatever is left is dropped when the tail passes.
 *
 * Time is whole microseconds; a tick falls on the first microsecond the counter is beyond the period, and like every
 * timed judgment it is reported once time has moved past it.
 */
export class HcnTickCounter {
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
