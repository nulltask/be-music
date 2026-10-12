import type { LongNoteStyle, RulesetConfig } from './definitions.ts';
import type { RulesetJudgeIndex } from './judge.ts';

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
 * - LR2 (`'ln'`) plays every long note as an LN — one deferred judgment, early release is a BAD.
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
