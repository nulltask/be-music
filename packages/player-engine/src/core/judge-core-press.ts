import { breakTrackedCombo } from './scoring.ts';
import { findFirstIndexNumberAtOrAfter } from '@be-music/shared-utils/core';
import { findLaneSoundCandidate, lowerBoundBySeconds } from '../judging.ts';
import type { TimedPlayableNote } from '../playable-notes.ts';
import { classifyRulesetJudge, RULESET_JUDGE_NONE, type RulesetJudgeIndex } from '../ruleset/judge.ts';
import { ignoresLateLongNoteHeadBad, isChargeLongNoteMode } from '../ruleset/long-note.ts';
import { preferJudgeCandidate, type JudgeSelectionCandidate } from '../ruleset/selection.ts';
import {
  isLongPlayableNote,
  judgeDeltaUs,
  RULESET_JUDGE_KINDS,
  resolveLongNoteEarlyReleaseJudge,
  resolveManualTimedJudge,
  resolveRulesetLongNoteMode,
  toUILongNoteMode,
} from './judge-rules.ts';
import {
  advanceJudgeState,
  detonateLandminesOnPress,
  laneHoldHistory,
  processLandminePassage,
  setHCNGaining,
  startHCNPassing,
} from './judge-core-advance.ts';
import { recordLaneDown, recordLaneUp } from './lane-hold.ts';
import {
  applyGaugeJudge,
  applyResolvedManualJudge,
  judgeWindowsFor,
  markScorableJudged,
  maxJudgeEarlyReachSeconds,
  maxJudgeReachSeconds,
  setCombo,
  toJudgeClock,
  toJudgeUs,
  isJudgingClosed,
} from './judge-core-score.ts';
import { type JudgeCoreEffectSink, type JudgeCoreInput, type JudgeCoreState } from './judge-core-types.ts';

/**
 * Judgment-core input handling: which note a press resolves against, multi-BAD, empty POOR and
 * releases.
 */

// ---- presses --------------------------------------------------------------------------------------------------

/**
 * The first note a press scan visits: one microsecond wider than the reach, since the windows are compared in whole
 * microseconds (`judgeDeltaUs`) while note times are float seconds. A note just outside is rejected by its windows.
 */
function scanStartIndex(notes: readonly TimedPlayableNote[], nowSec: number, reachSeconds: number): number {
  return lowerBoundBySeconds(notes, nowSec - reachSeconds - 1e-6);
}

/** True once a scan has passed every note a press at `inputTimeUs` can reach, compared in whole microseconds. */
function isBeyondScanReach(note: TimedPlayableNote, inputTimeUs: number, reachSeconds: number): boolean {
  return toJudgeUs(note.seconds) - inputTimeUs > Math.round(reachSeconds * 1e6);
}

/**
 * The note a press resolves against, chosen by the ruleset's own selection algorithm. Reachability is per note: the
 * note's own lane (key vs scratch) and its own chart time (the `#EXRANKxx` rank in force there) pick its window set,
 * and both legs are checked separately. A note inside the coarse scan radius but outside its own windows is not a
 * candidate, so the press falls through to the lane keysound / empty-POOR path instead of consuming it as a POOR.
 */
function selectPressCandidate(
  state: JudgeCoreState,
  nowSec: number,
  candidateChannels: ReadonlySet<string>,
): { note: TimedPlayableNote; judge: RulesetJudgeIndex } | undefined {
  const { config } = state;
  const { ruleset, scorableNotes } = config;
  const reachSeconds = maxJudgeReachSeconds(config, nowSec);
  const inputTimeUs = Math.round(nowSec * 1e6);
  let best: TimedPlayableNote | undefined;
  let bestSelection: JudgeSelectionCandidate | undefined;
  // `scorableNotes` is sorted by time, so the scan visits candidates in the ascending order the selection algorithms
  // assume (`lowest` keeps the first, the others may displace it).
  for (let index = scanStartIndex(scorableNotes, nowSec, reachSeconds); index < scorableNotes.length; index += 1) {
    const note = scorableNotes[index]!;
    if (isBeyondScanReach(note, inputTimeUs, reachSeconds)) {
      break;
    }
    if (note.judged || !candidateChannels.has(note.channel)) {
      continue;
    }
    // The windows in force at the press, as LR2 reads its judge widths (`#EXRANK` can change them mid-chart).
    const windows = judgeWindowsFor(config, note.channel, nowSec);
    const judge = classifyRulesetJudge(judgeDeltaUs(note.seconds, nowSec), windows);
    if (judge === RULESET_JUDGE_NONE) {
      continue;
    }
    const playedMode =
      typeof note.endSeconds === 'number' && note.endSeconds > note.seconds
        ? resolveRulesetLongNoteMode(ruleset.longNoteStyle, note)
        : undefined;
    if (ignoresLateLongNoteHeadBad(ruleset, judge, note.seconds < nowSec, playedMode)) {
      // LR2: a long-note head has no LATE bad — the press falls through to whatever else is in reach. The mode is the
      // one the ruleset plays, not the chart's `#LNMODE`: LR2 plays a `#LNMODE 2` note as a plain LN too.
      continue;
    }
    const selection: JudgeSelectionCandidate = {
      noteTimeUs: Math.round(note.seconds * 1e6),
      dmUs: judgeDeltaUs(note.seconds, nowSec),
      judge,
      windows,
    };
    if (bestSelection === undefined || preferJudgeCandidate(ruleset.selection, bestSelection, selection, inputTimeUs)) {
      best = note;
      bestSelection = selection;
    }
  }
  return best === undefined || bestSelection === undefined ? undefined : { note: best, judge: bestSelection.judge };
}

/**
 * LR2 ProcSinglenote reuses a BAD press for the next tap on that lane, judging its own delta. A non-BAD,
 * a long note or a note outside BAD reach stops the forward chain. Effect times retain the true clock past reversal.
 */
function applyLR2RejudgeChain(
  state: JudgeCoreState,
  nowSec: number,
  consumed: TimedPlayableNote,
  consumedJudge: RulesetJudgeIndex,
  atSeconds: number,
  emit: JudgeCoreEffectSink,
): void {
  if (consumedJudge !== 3 || isLongPlayableNote(consumed) || isJudgingClosed(state)) return;
  const { config } = state;
  let passedConsumed = false;
  for (
    let index = lowerBoundBySeconds(config.scorableNotes, consumed.seconds);
    index < config.scorableNotes.length;
    index += 1
  ) {
    const note = config.scorableNotes[index]!;
    if (!passedConsumed) {
      passedConsumed = note === consumed;
      continue;
    }
    if (note.judged || note.channel !== consumed.channel) continue;
    if (isLongPlayableNote(note)) break;
    const windows = judgeWindowsFor(config, note.channel, nowSec);
    const deltaUs = judgeDeltaUs(note.seconds, nowSec);
    if (deltaUs < windows.judges[3][0] || deltaUs > windows.judges[3][1]) break;
    if (!markScorableJudged(state, note)) break;
    const judge = resolveManualTimedJudge((nowSec - note.seconds) * 1000, windows);
    emit({ kind: 'ui', command: { kind: 'flash-lane', channel: note.channel } });
    emit({ kind: 'sound', source: 'manual-note', event: note.event, seconds: atSeconds, channel: note.channel });
    applyResolvedManualJudge(state, note.channel, judge, atSeconds, emit);
    if (judge.kind !== 'BAD' || isJudgingClosed(state)) break;
  }
}

/**
 * Is there a note near enough on any pressed lane for a note-less press to charge an empty POOR? The reach is the
 * ruleset's own miss (`ms`) window, which is not symmetric: LR2's is early-only, beatoraja's reaches 500 ms early and
 * 150 ms late. Both neighbours of the press are tested, since the late side matters where the ruleset has one.
 */
function hasEmptyPoorReferenceNote(state: JudgeCoreState, channels: ReadonlySet<string>, nowSec: number): boolean {
  for (const channel of channels) {
    const noteTimes = state.scorableNoteSecondsByChannel.get(channel);
    if (!noteTimes) {
      continue;
    }
    const missWindow = judgeWindowsFor(state.config, channel, nowSec).ms;
    if (!missWindow) {
      continue;
    }
    const index = findFirstIndexNumberAtOrAfter(noteTimes, nowSec);
    for (const neighbour of [index - 1, index]) {
      const noteSeconds = noteTimes[neighbour];
      if (noteSeconds === undefined) {
        continue;
      }
      const dmUs = judgeDeltaUs(noteSeconds, nowSec);
      if (dmUs >= missWindow[0] && dmUs <= missWindow[1]) {
        return true;
      }
    }
  }
  return false;
}

/** Whether a press on `channels` at chart second `nowSec` has a note in reach to judge. Reads the state only. */
export function hasPressCandidate(state: JudgeCoreState, channels: ReadonlySet<string>, nowSec: number): boolean {
  return selectPressCandidate(state, toJudgeClock(state.config, nowSec), channels) !== undefined;
}

export function handleLanePress(
  state: JudgeCoreState,
  candidateChannels: ReadonlySet<string>,
  tokens: readonly string[],
  nowMs: number,
  nowSec: number,
  emit: JudgeCoreEffectSink,
): void {
  const { config } = state;
  const { ruleset } = config;
  // Replay press event — recorded BEFORE any judging so the log stays a raw input replay.
  emit({ kind: 'record-input', action: 'down', seconds: nowSec, tokens, channels: candidateChannels });

  for (const mappedChannel of candidateChannels) {
    emit({ kind: 'ui', command: { kind: 'flash-lane', channel: mappedChannel } });
  }

  // A press on a lane whose long note is still unresolved is part of that long note: it judges no other note there.
  let pressesLongNote = false;
  // Lanes whose long note was let go and is waiting out the ruleset's release margin: pressing again resumes the hold,
  // so the press judges nothing else on them (beatoraja's re-press, `releasetime` reset).
  const resumedChannels = new Set<string>();
  for (const channel of candidateChannels) {
    if (!state.activeLongNotes.has(channel)) {
      continue;
    }
    if (state.longHoldReleaseSeconds.delete(channel)) {
      state.longNoteSettleMs.delete(channel);
      resumedChannels.add(channel);
    }
    pressesLongNote = true;
  }

  // Mines — record the press instant (when the mine crossing is settled later, the lane is asked whether it was down
  // then), then settle the mines on these lanes: under LR2's model (`mineTrigger: 'press-or-hold'`) the press itself
  // counts as "key ON" and detonates any mine inside the PGREAT window; under beatoraja's (`'hold'`) only a key down as
  // a mine crosses counts. Detonation never consumes the press: the regular note judgment below still runs.
  for (const channel of candidateChannels) {
    recordLaneDown(laneHoldHistory(state, channel), tokens, nowMs);
  }
  processLandminePassage(state, nowSec, nowMs, emit);
  detonateLandminesOnPress(state, candidateChannels, nowSec, emit);
  // A key going down on a lane with a passing Hell Charge note makes it gain.
  for (const channel of candidateChannels) {
    setHCNGaining(state, channel, toJudgeUs(nowSec), emit);
  }

  // Past an LR2 negative-BPM reversal the press is judged on the mirrored clock (#134; see `toJudgeClock`): note
  // selection, timing deltas, windows, the lane keysound and the empty-POOR reach all read `judgeSec`, while the
  // judgments, logs, gauge history and UI cues keep the true `nowSec`.
  const judgeSec = toJudgeClock(config, nowSec);
  // A lane whose long note is held is pressed again by another key bound to it: its current note is the long note, so
  // the press never judges another note there; the ruleset says what it does instead.
  const heldLongNoteChannels = [...candidateChannels].filter(
    (channel) => state.activeLongNotes.has(channel) && !resumedChannels.has(channel),
  );
  for (const channel of heldLongNoteChannels) {
    applyPressDuringLongNote(state, channel, judgeSec, nowSec, emit);
  }
  const judgedChannels =
    resumedChannels.size === 0 && heldLongNoteChannels.length === 0
      ? candidateChannels
      : new Set(
          [...candidateChannels].filter(
            (channel) => !resumedChannels.has(channel) && !heldLongNoteChannels.includes(channel),
          ),
        );
  if (judgedChannels.size === 0) {
    return;
  }
  const selected = selectPressCandidate(state, judgeSec, judgedChannels);

  if (!selected) {
    if (pressesLongNote) {
      // The press is part of a long note's sustain, not a phantom press.
      return;
    }
    const fallback = findLaneSoundCandidate(
      config.laneSoundNotes,
      judgedChannels,
      judgeSec,
      maxJudgeEarlyReachSeconds(config, judgeSec),
    );
    if (fallback) {
      emit({
        kind: 'sound',
        source: 'lane-fallback',
        event: fallback.event,
        seconds: nowSec,
        channel: fallback.channel,
      });
    }
    if (!hasEmptyPoorReferenceNote(state, judgedChannels, judgeSec)) {
      // No note in the ruleset's miss window — the press is harmless: only the lane keysound plays.
      return;
    }
    chargeEmptyPoor(state, nowSec, emit);
    return;
  }

  const candidate = selected.note;
  if (!markScorableJudged(state, candidate)) {
    return;
  }
  const channel = candidate.channel;
  const signedDeltaMs = (judgeSec - candidate.seconds) * 1000;
  const rejudgeAfterBad = (): void => {
    if (ruleset.multiBad) {
      applyLR2RejudgeChain(state, judgeSec, candidate, selected.judge, nowSec, emit);
    }
  };
  emit({ kind: 'ui', command: { kind: 'flash-lane', channel } });
  emit({ kind: 'sound', source: 'manual-note', event: candidate.event, seconds: nowSec, channel });
  const endSeconds = candidate.endSeconds;
  if (typeof endSeconds === 'number' && Number.isFinite(endSeconds) && endSeconds > candidate.seconds) {
    const longNoteMode = resolveRulesetLongNoteMode(ruleset.longNoteStyle, candidate);
    emit({
      kind: 'long-note',
      seconds: nowSec,
      channel,
      state: 'start',
      mode: longNoteMode === 2 || longNoteMode === 3 ? longNoteMode : 1,
      event: candidate.event,
      endSeconds,
    });
    candidate.visibleUntilBeat = candidate.endBeat;
    // Light the renderer's LN-hold timer on the head; the matching `release-lane` comes when the note resolves.
    if (longNoteMode !== undefined) {
      emit({
        kind: 'ui',
        command: { kind: 'hold-lane-until-beat', channel, beat: candidate.endBeat ?? candidate.beat },
      });
      emit({
        kind: 'ui',
        command: { kind: 'long-note-start', channel, beat: candidate.beat, mode: toUILongNoteMode(longNoteMode) },
      });
    }
    const headJudge = resolveManualTimedJudge(signedDeltaMs, judgeWindowsFor(config, channel, judgeSec));
    if (longNoteMode !== undefined && isChargeLongNoteMode(longNoteMode)) {
      // Charge modes score the head right here — it is a judgment of its own, not half of a deferred one.
      applyResolvedManualJudge(state, channel, headJudge, nowSec, emit, true);
      startHCNPassing(state, candidate, toJudgeUs(nowSec));
      if (ruleset.headBadSkipsTail && (headJudge.kind === 'BAD' || headJudge.kind === 'POOR')) {
        // That-Which-Must-Not-Be-Named: a broken charge-note head cancels the tail; the note is finished with a single judgment.
        state.activeLongNotes.delete(channel);
        state.longNoteSettleMs.delete(channel);
        emit({ kind: 'ui', command: { kind: 'long-note-end', channel, outcome: 'dropped' } });
        emit({ kind: 'ui', command: { kind: 'release-lane', channel } });
        rejudgeAfterBad();
        return;
      }
      state.activeLongNotes.set(channel, {
        endSeconds,
        note: candidate,
        mode: longNoteMode,
        headJudge,
        headScored: true,
        audioStopped: false,
      });
      state.longNoteSettleMs.delete(channel);
      state.longHoldReleaseSeconds.delete(channel);
      rejudgeAfterBad();
      return;
    }
    if (longNoteMode === 1) {
      state.activeLongNotes.set(channel, {
        endSeconds,
        note: candidate,
        mode: 1,
        headJudge,
        headScored: false,
        audioStopped: false,
      });
      state.longNoteSettleMs.delete(channel);
      state.longHoldReleaseSeconds.delete(channel);
      rejudgeAfterBad();
      return;
    }
    state.activeLongNotes.delete(channel);
    state.longNoteSettleMs.delete(channel);
    rejudgeAfterBad();
    return;
  }
  state.activeLongNotes.delete(channel);
  state.longNoteSettleMs.delete(channel);

  applyResolvedManualJudge(
    state,
    channel,
    resolveManualTimedJudge(signedDeltaMs, judgeWindowsFor(config, channel, judgeSec)),
    nowSec,
    emit,
  );
  rejudgeAfterBad();
}

/**
 * A press on a lane whose long note is held, by the ruleset's {@link PressDuringLongNoteRule}: LR2 judges the LN's head
 * again when the press is within its BAD window and charges an empty POOR otherwise; beatoraja and That-Which-Must-Not-Be-Named ignore it.
 */
function applyPressDuringLongNote(
  state: JudgeCoreState,
  channel: string,
  judgeSec: number,
  nowSec: number,
  emit: JudgeCoreEffectSink,
): void {
  const { config } = state;
  if (config.ruleset.pressDuringLongNote === 'ignore') {
    return;
  }
  const hold = state.activeLongNotes.get(channel)!;
  if (hold.mode === 1 && !hold.headScored) {
    const dmUs = judgeDeltaUs(hold.note.seconds, judgeSec);
    const judge = classifyRulesetJudge(dmUs, judgeWindowsFor(config, channel, judgeSec));
    if (judge !== RULESET_JUDGE_NONE) {
      hold.headJudge = { kind: RULESET_JUDGE_KINDS[judge], signedDeltaMs: -dmUs / 1000 };
      return;
    }
  }
  chargeEmptyPoor(state, nowSec, emit);
}

/**
 * Empty POOR (空POOR): a phantom press near a note but outside every judgable window. It costs gauge and fires the POOR
 * cue without consuming the note, so it never reaches EX-SCORE. Repeatable per note (LR2's `MissCondition.ALWAYS`).
 * Whether it breaks the combo is the ruleset's call.
 */
function chargeEmptyPoor(state: JudgeCoreState, nowSec: number, emit: JudgeCoreEffectSink): void {
  const { ruleset } = state.config;
  if (isJudgingClosed(state)) {
    return;
  }
  state.summary.emptyPoor += 1;
  applyGaugeJudge(state, nowSec, 'EMPTY_POOR', emit, 'empty-poor');
  if (ruleset.comboBreaksOnEmptyPoor) {
    // The score tracker keeps the combo the max combo is measured on, so it breaks too.
    breakTrackedCombo(state.scoreTracker);
    setCombo(state, nowSec, 0, 'judge', emit, 'POOR');
  }
  emit({ kind: 'record-empty-poor' });
  emit({ kind: 'poor-bga', action: 'trigger', seconds: nowSec });
  emit({
    kind: 'trace',
    name: 'judge',
    seconds: nowSec,
    fields: [
      ['result', 'EMPTY_POOR'],
      ['reason', 'empty-poor'],
    ],
  });
  // The UI maps this back to the LR2 `'poor'` skin slot (NOWJUDGE 0/1 share one kind in our model).
  emit({ kind: 'judge-combo', judge: 'POOR', combo: state.combo });
}

export function handleLaneRelease(
  state: JudgeCoreState,
  input: Extract<JudgeCoreInput, { kind: 'release' }>,
  emit: JudgeCoreEffectSink,
): void {
  if (input.channels.size > 0) {
    emit({
      kind: 'record-input',
      action: 'up',
      seconds: input.recordSec,
      tokens: input.tokens,
      channels: input.channels,
      ...(input.inferred === true ? { inferred: true } : {}),
    });
  }
  // The release's own instant (a live driver drains it later than it happened; the replay records the instant).
  const releaseMs = input.nowMs - (input.nowSec - input.recordSec) * state.config.judgeMsPerChartSecond;
  let settleNow = false;
  for (const channel of input.channels) {
    recordLaneUp(laneHoldHistory(state, channel), input.tokens, releaseMs);
    setHCNGaining(state, channel, toJudgeUs(input.nowSec), emit);
    state.heldChannels.delete(channel);
    if (input.inferred !== true) {
      emit({ kind: 'ui', command: { kind: 'release-lane', channel } });
    }
    if (state.activeLongNotes.has(channel)) {
      state.longHoldReleaseSeconds.set(channel, input.nowSec);
      const marginMs = resolveLongNoteReleaseMarginMs(state, channel, input.nowSec);
      // A release settles its long note at once, unless the ruleset lets a BAD-or-worse early release wait out a
      // margin in which the lane can be pressed again (beatoraja's `longnoteMargin`).
      state.longNoteSettleMs.set(channel, marginMs > 0 ? input.nowMs + marginMs : Number.NEGATIVE_INFINITY);
      settleNow ||= marginMs === 0;
    }
  }
  if (settleNow) {
    advanceJudgeState(state, input.nowSec, input.nowMs, emit);
  }
}

/**
 * How long (ms on the judge's clock) a long note released at `nowSec` waits before it settles: the ruleset's release
 * margin when the release would score an early BAD or worse before the tail (`JudgeManager` L509, L537), 0 otherwise.
 */
function resolveLongNoteReleaseMarginMs(state: JudgeCoreState, channel: string, nowSec: number): number {
  const { config } = state;
  const hold = state.activeLongNotes.get(channel)!;
  const margins = config.ruleset.longNoteReleaseMarginUs;
  const marginUs = config.scratchChannels.has(channel) ? margins.scratch : margins.note;
  const judgeSec = toJudgeClock(config, nowSec);
  if (marginUs === 0 || judgeSec >= hold.endSeconds) {
    return 0;
  }
  const releaseDeltaMs = (judgeSec - hold.endSeconds) * 1000;
  const endWindows = judgeWindowsFor(config, channel, judgeSec, true);
  const judge =
    hold.mode === 1
      ? resolveLongNoteEarlyReleaseJudge(config.ruleset, hold.headJudge, releaseDeltaMs, endWindows)
      : resolveManualTimedJudge(releaseDeltaMs, endWindows);
  // beatoraja waits only when the judgment is BAD or worse AND its timing is early (`judge >= 3 && dmtime > 0`); an
  // LN's timing is the head's when the head was further off than the release, so a late head settles at once.
  const waits = (judge.kind === 'BAD' || judge.kind === 'POOR') && judge.signedDeltaMs < 0;
  return waits ? (marginUs / 1e6) * config.judgeMsPerChartSecond : 0;
}
