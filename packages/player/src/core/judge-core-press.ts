import { findFirstIndexNumberAtOrAfter } from '@be-music/utils/core';
import { findLaneSoundCandidate, lowerBoundBySeconds } from '../judging.ts';
import type { TimedPlayableNote } from '../playable-notes.ts';
import { classifyRulesetJudge, RULESET_JUDGE_NONE, type RulesetJudgeIndex } from '../ruleset/judge.ts';
import { ignoresLateLongNoteHeadBad, isChargeLongNoteMode, isMultiBadCollectorTarget } from '../ruleset/long-note.ts';
import { preferJudgeCandidate, type JudgeSelectionCandidate } from '../ruleset/selection.ts';
import {
  isLongPlayableNote,
  resolveManualTimedJudge,
  resolveRulesetLongNoteMode,
  toUiLongNoteMode,
} from './judge-rules.ts';
import { laneHoldHistory, processLandminePassage } from './judge-core-advance.ts';
import { recordLaneDown, recordLaneUp } from './lane-hold.ts';
import {
  applyGaugeJudge,
  applyResolvedManualJudge,
  applyTailMissPoor,
  judgeWindowsFor,
  markScorableJudged,
  maxJudgeEarlyReachSeconds,
  maxJudgeReachSeconds,
  noteOwesTailMiss,
  setCombo,
} from './judge-core-score.ts';
import {
  type JudgeCoreEffectSink,
  type JudgeCoreInput,
  type JudgeCoreState,
  LONG_NOTE_INITIAL_HOLD_GRACE_MS,
  LONG_NOTE_REPEAT_HOLD_GRACE_MS,
} from './judge-core-types.ts';

/**
 * Judge-core input handling: which note a press resolves against, multi-BAD, empty POOR and
 * releases.
 */

// ---- presses --------------------------------------------------------------------------------------------------

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
  const inputTimeUs = nowSec * 1e6;
  let best: TimedPlayableNote | undefined;
  let bestSelection: JudgeSelectionCandidate | undefined;
  // `scorableNotes` is sorted by time, so the scan visits candidates in the ascending order the selection algorithms
  // assume (`lowest` keeps the first, the others may displace it).
  for (
    let index = lowerBoundBySeconds(scorableNotes, nowSec - reachSeconds);
    index < scorableNotes.length;
    index += 1
  ) {
    const note = scorableNotes[index]!;
    if (note.seconds - nowSec > reachSeconds) {
      break;
    }
    if (note.judged || !candidateChannels.has(note.channel)) {
      continue;
    }
    const windows = judgeWindowsFor(config, note.channel, note.seconds);
    const judge = classifyRulesetJudge((note.seconds - nowSec) * 1e6, windows);
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
      noteTimeUs: note.seconds * 1e6,
      dmUs: (note.seconds - nowSec) * 1e6,
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
 * lr2oraja `MultiBadCollector`: once a press has consumed its note, every OTHER unjudged note on the pressed lanes
 * that sits inside the BAD window but outside the GOOD window also resolves as a BAD (pruned by
 * {@link isMultiBadCollectorTarget}).
 */
function applyMultiBadCollector(
  state: JudgeCoreState,
  nowSec: number,
  candidateChannels: ReadonlySet<string>,
  consumed: TimedPlayableNote,
  consumedJudge: RulesetJudgeIndex,
  emit: JudgeCoreEffectSink,
): void {
  const { config } = state;
  const scorableNotes = config.scorableNotes;
  const reachSeconds = maxJudgeReachSeconds(config, nowSec);
  const consumedNote = { time: consumed.seconds, isLong: isLongPlayableNote(consumed), judge: consumedJudge };
  const extras: TimedPlayableNote[] = [];
  for (
    let index = lowerBoundBySeconds(scorableNotes, nowSec - reachSeconds);
    index < scorableNotes.length;
    index += 1
  ) {
    const note = scorableNotes[index]!;
    if (note.seconds - nowSec > reachSeconds) {
      break;
    }
    if (note === consumed || note.judged || !candidateChannels.has(note.channel)) {
      continue;
    }
    if (state.activeLongNotes.get(note.channel)?.note === note) {
      continue;
    }
    const windows = judgeWindowsFor(config, note.channel, note.seconds);
    const dmUs = (note.seconds - nowSec) * 1e6;
    const bad = windows.judges[3];
    const good = windows.judges[2];
    if (dmUs < bad[0] || dmUs > bad[1]) {
      continue;
    }
    if (dmUs >= good[0] && dmUs <= good[1]) {
      continue;
    }
    if (!isMultiBadCollectorTarget(consumedNote, { time: note.seconds, isLong: isLongPlayableNote(note) })) {
      continue;
    }
    extras.push(note);
  }
  for (const note of extras) {
    if (!markScorableJudged(state, note)) {
      continue;
    }
    applyResolvedManualJudge(
      state,
      note.channel,
      { kind: 'BAD', signedDeltaMs: (nowSec - note.seconds) * 1000 },
      nowSec,
      emit,
    );
    if (noteOwesTailMiss(config.ruleset, note)) {
      applyTailMissPoor(state, nowSec, emit);
    }
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
      const dmUs = (noteSeconds - nowSec) * 1e6;
      if (dmUs >= missWindow[0] && dmUs <= missWindow[1]) {
        return true;
      }
    }
  }
  return false;
}

function isLongNoteRepeatSuppressedInput(
  state: JudgeCoreState,
  candidateChannels: ReadonlySet<string>,
  nowSec: number,
): boolean {
  for (const channel of candidateChannels) {
    const suppressUntil = state.longNoteSuppressUntilSeconds.get(channel);
    if (suppressUntil !== undefined && nowSec < suppressUntil) {
      return true;
    }
  }
  return false;
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
  // Play-log press event — recorded BEFORE any judging so the log stays a raw input replay.
  emit({ kind: 'record-input', action: 'down', seconds: nowSec, tokens, channels: candidateChannels });

  for (const mappedChannel of candidateChannels) {
    emit({ kind: 'ui', command: { kind: 'flash-lane', channel: mappedChannel } });
  }

  let refreshedHold = false;
  for (const channel of candidateChannels) {
    if (!state.activeLongNotes.has(channel)) {
      continue;
    }
    state.longHoldUntilMs.set(channel, nowMs + LONG_NOTE_REPEAT_HOLD_GRACE_MS);
    refreshedHold = true;
  }

  // Mines — record the press instant (when the mine crossing is settled later, the lane is asked whether it was down
  // then), then settle the mines on these lanes: under LR2's model (`mineTrigger: 'press-or-hold'`) the press itself
  // counts as "key ON" and detonates any mine inside the PGREAT window; under beatoraja's (`'hold'`) only a key down as
  // a mine crosses counts. Detonation never consumes the press: the regular note judgment below still runs.
  for (const channel of candidateChannels) {
    recordLaneDown(laneHoldHistory(state, channel), tokens, nowMs);
  }
  processLandminePassage(state, nowSec, nowMs, emit);

  const selected = selectPressCandidate(state, nowSec, candidateChannels);

  if (!selected) {
    if (refreshedHold) {
      // Active LN re-tap inside the hold-grace window — input is part of the sustain, not a phantom press.
      return;
    }
    if (isLongNoteRepeatSuppressedInput(state, candidateChannels, nowSec)) {
      // LN repeat-suppress window — same intent as the hold path above, just on the cooldown side.
      return;
    }
    const fallback = findLaneSoundCandidate(
      config.laneSoundNotes,
      candidateChannels,
      nowSec,
      maxJudgeEarlyReachSeconds(config, nowSec),
    );
    if (fallback) {
      emit({
        kind: 'sound',
        source: 'lane-fallback',
        event: fallback.event,
        seconds: nowSec,
        channel: fallback.channel,
      });
      if (config.freeZoneChannels.has(fallback.channel)) {
        // Free zone keysound — authored for empty-press playback. No POOR cue; this is intended audio.
        return;
      }
    }
    if (!hasEmptyPoorReferenceNote(state, candidateChannels, nowSec)) {
      // No note in the ruleset's miss window — the press is harmless: only the lane keysound plays.
      return;
    }
    // Empty POOR (空POOR): a phantom press near a note but outside every judgable window. It costs gauge and fires the
    // POOR cue without consuming the note, so it never reaches EX-SCORE. Repeatable per note (LR2's
    // `MissCondition.ALWAYS`). Whether it breaks the combo is the ruleset's call.
    state.summary.emptyPoor += 1;
    applyGaugeJudge(state, nowSec, 'EMPTY_POOR', emit, 'empty-poor');
    if (ruleset.comboBreaksOnEmptyPoor) {
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
    return;
  }

  const candidate = selected.note;
  if (!markScorableJudged(state, candidate)) {
    return;
  }
  const channel = candidate.channel;
  const signedDeltaMs = (nowSec - candidate.seconds) * 1000;
  const collectMultiBad = (): void => {
    if (ruleset.multiBad) {
      applyMultiBadCollector(state, nowSec, candidateChannels, candidate, selected.judge, emit);
    }
  };
  emit({ kind: 'ui', command: { kind: 'flash-lane', channel } });
  emit({ kind: 'sound', source: 'manual-note', event: candidate.event, seconds: nowSec, channel });
  const endSeconds = candidate.endSeconds;
  if (typeof endSeconds === 'number' && Number.isFinite(endSeconds) && endSeconds > candidate.seconds) {
    const longNoteMode = resolveRulesetLongNoteMode(ruleset.longNoteStyle, candidate);
    const previousSuppressUntil = state.longNoteSuppressUntilSeconds.get(channel) ?? Number.NEGATIVE_INFINITY;
    if (endSeconds > previousSuppressUntil) {
      state.longNoteSuppressUntilSeconds.set(channel, endSeconds);
    }
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
        command: { kind: 'long-note-start', channel, beat: candidate.beat, mode: toUiLongNoteMode(longNoteMode) },
      });
    }
    const headJudge = resolveManualTimedJudge(signedDeltaMs, judgeWindowsFor(config, channel, nowSec));
    if (longNoteMode !== undefined && isChargeLongNoteMode(longNoteMode)) {
      // Charge modes score the head right here — it is a judgment of its own, not half of a deferred one.
      applyResolvedManualJudge(state, channel, headJudge, nowSec, emit);
      if (ruleset.headBadSkipsTail && (headJudge.kind === 'BAD' || headJudge.kind === 'POOR')) {
        // IIDX: a broken charge-note head cancels the tail; the note is finished with a single judgment.
        state.activeLongNotes.delete(channel);
        state.longHoldUntilMs.delete(channel);
        emit({ kind: 'ui', command: { kind: 'long-note-end', channel, outcome: 'dropped' } });
        emit({ kind: 'ui', command: { kind: 'release-lane', channel } });
        collectMultiBad();
        return;
      }
      state.activeLongNotes.set(channel, {
        endSeconds,
        note: candidate,
        mode: longNoteMode,
        headJudge,
        headScored: true,
        gaugeDrainCursorSeconds: nowSec,
        audioStopped: false,
      });
      state.longHoldUntilMs.set(channel, nowMs + LONG_NOTE_INITIAL_HOLD_GRACE_MS);
      state.longHoldReleaseSeconds.delete(channel);
      collectMultiBad();
      return;
    }
    if (longNoteMode === 1) {
      state.activeLongNotes.set(channel, {
        endSeconds,
        note: candidate,
        mode: 1,
        headJudge,
        headScored: false,
        gaugeDrainCursorSeconds: nowSec,
        audioStopped: false,
      });
      state.longHoldUntilMs.set(channel, nowMs + LONG_NOTE_INITIAL_HOLD_GRACE_MS);
      state.longHoldReleaseSeconds.delete(channel);
      collectMultiBad();
      return;
    }
    state.activeLongNotes.delete(channel);
    state.longHoldUntilMs.delete(channel);
    collectMultiBad();
    return;
  }
  state.activeLongNotes.delete(channel);
  state.longHoldUntilMs.delete(channel);

  applyResolvedManualJudge(
    state,
    channel,
    resolveManualTimedJudge(signedDeltaMs, judgeWindowsFor(config, channel, nowSec)),
    nowSec,
    emit,
  );
  collectMultiBad();
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
    });
  }
  state.keyStateInput = true;
  // The release's own instant (a live driver drains it later than it happened; the play log records the instant).
  const releaseMs = input.nowMs - (input.nowSec - input.recordSec) * state.config.judgeMsPerChartSecond;
  for (const channel of input.channels) {
    recordLaneUp(laneHoldHistory(state, channel), input.tokens, releaseMs);
    state.heldChannels.delete(channel);
    emit({ kind: 'ui', command: { kind: 'release-lane', channel } });
    if (state.activeLongNotes.has(channel)) {
      state.longHoldUntilMs.set(channel, input.nowMs);
      state.longHoldReleaseSeconds.set(channel, input.nowSec);
    }
  }
}
