import type { BeMusicEvent } from '@be-music/json';
import type { TimedLandmineNote } from '../playable-notes.ts';
import { judgeWindowLateReachUs, pgreatWindowReachUs } from '../ruleset/judge.ts';
import { isChargeLongNoteMode } from '../ruleset/long-note.ts';
import {
  combineLongNoteJudges,
  insertPendingAutoLongNote,
  longNoteScoresTail,
  resolveLoggedLongNoteMode,
  resolveLongNoteEndSeconds,
  resolveManualTimedJudge,
  resolveRulesetLongNoteMode,
  toUiLongNoteMode,
  type TimedManualJudge,
} from './judge-rules.ts';
import { resolveLandmineGaugeEffect } from './landmine.ts';
import { applyJudgeToSummary } from './scoring.ts';
import {
  applyGaugeDelta,
  applyGaugeJudge,
  applyResolvedManualJudge,
  applyTailMissPoor,
  badWindowSeconds,
  judgeWindowsFor,
  markInvisibleJudged,
  markLandmineJudged,
  markScorableJudged,
  noteOwesTailMiss,
  resolveMissDeadlineSeconds,
  setCombo,
  windowTablesAt,
} from './judge-core-score.ts';
import {
  type ActiveLongNoteState,
  HELL_CHARGE_GAUGE_DRAIN_PER_SECOND,
  HELL_CHARGE_GAUGE_GAIN_PER_SECOND,
  JUDGE_TIME_EPSILON_SECONDS,
  type JudgeCoreEffectSink,
  type JudgeCoreState,
  LANDMINE_EXPLOSION_SAMPLE_KEY,
  LONG_NOTE_REPEAT_HOLD_GRACE_MS,
} from './judge-core-types.ts';

/**
 * Judge-core time steps: long-note holds and tails, HCN ticks, mines, auto-scratch, misses
 * and the end-of-play charge.
 */

// ---- mines ----------------------------------------------------------------------------------------------------

function isLandmineChannelHeld(state: JudgeCoreState, channel: string, nowMs: number): boolean {
  if (state.heldChannels.has(channel)) {
    return true;
  }
  // Non-kitty input carries no release events, so "held" is approximated with the same short grace window the LN
  // hold logic uses for terminal key repeat.
  const lastPressMs = state.lastLanePressMs.get(channel);
  return lastPressMs !== undefined && nowMs - lastPressMs <= LONG_NOTE_REPEAT_HOLD_GRACE_MS;
}

/** The explosion sample event of a mine, or `undefined` when the chart has no `#WAV00`. */
export function resolveLandmineExplosionEvent(
  landmineEvent: BeMusicEvent,
  resources: Readonly<Record<string, string>>,
): BeMusicEvent | undefined {
  const sourcePath = resources[LANDMINE_EXPLOSION_SAMPLE_KEY];
  if (typeof sourcePath !== 'string' || sourcePath.length === 0) {
    return undefined;
  }
  return {
    ...landmineEvent,
    value: LANDMINE_EXPLOSION_SAMPLE_KEY,
  };
}

function detonateLandmine(
  state: JudgeCoreState,
  landmine: TimedLandmineNote,
  nowSec: number,
  emit: JudgeCoreEffectSink,
): void {
  if (!markLandmineJudged(state, landmine)) {
    return;
  }
  const { config } = state;
  const landmineGaugeEffect = resolveLandmineGaugeEffect(landmine.event, config.idBase, config.sourceFormat);
  const landmineExplosionEvent = resolveLandmineExplosionEvent(landmine.event, config.wavResources);
  if (landmineExplosionEvent) {
    emit({
      kind: 'sound',
      source: 'mine-hit',
      event: landmineExplosionEvent,
      seconds: nowSec,
      channel: landmine.channel,
    });
  }
  // LR2 — a mine hit drains the gauge and plays the explosion sample, nothing else: no verdict, no combo break, no
  // judge-counter change (beatoraja's JudgeManager likewise only calls `gauge.addValue`). The raw-delta path also
  // bypasses the HARD guts softening and #TOTAL damage multiplier, matching `GrooveGauge.addValue`.
  applyGaugeDelta(state, nowSec, landmineGaugeEffect.gaugeDelta, 'mine-hit', emit);
  emit({
    kind: 'trace',
    name: 'mine-hit',
    seconds: nowSec,
    fields: [
      ['channel', landmine.channel],
      ['value', landmineGaugeEffect.objectValue],
      ['damage', landmineGaugeEffect.damage],
    ],
  });
}

/**
 * LR2 mine model (LR2's own changelog, 080114 entry): a mine explodes when its lane's key is held as the mine crosses
 * the judge line ("キー押したまま地雷通過"), or on a press within the PGREAT window of the judge line ("ピカグレ範囲内で
 * キーを押す"). Mines that cross with the key up are retired silently once the PGREAT window closes behind them.
 * Runs on every advance and on every press.
 */
export function processLandminePassage(
  state: JudgeCoreState,
  nowSec: number,
  nowMs: number,
  emit: JudgeCoreEffectSink,
): void {
  const { config } = state;
  const landmineNotes = config.landmineNotes;
  // Reach form keeps the early / late legs separate — nothing guarantees a ruleset's window table is symmetric.
  const [pgreatLateUs, pgreatEarlyUs] = pgreatWindowReachUs(windowTablesAt(config, nowSec).note);
  const pgreatLateSeconds = pgreatLateUs / 1e6;
  const pgreatEarlySeconds = pgreatEarlyUs / 1e6;
  while (state.landmineExpireCursor < landmineNotes.length) {
    const landmine = landmineNotes[state.landmineExpireCursor]!;
    if (landmine.judged) {
      state.landmineExpireCursor += 1;
      continue;
    }
    if (nowSec - landmine.seconds <= pgreatLateSeconds) {
      break;
    }
    // The PGREAT window can be narrower than a step, so a held-through mine may enter AND leave it between two
    // passage calls. The hold-through leg therefore anchors to the crossing itself: when the window closes behind a
    // mine, detonate if the lane was held at the moment the mine crossed the judge line — a kitty key that is still
    // down counts, as does a non-kitty press within the hold-grace window BEFORE the crossing. A press AFTER the
    // crossing never detonates here: that is the press leg, and it already missed PGREAT.
    const crossingMs = nowMs - (nowSec - landmine.seconds) * config.judgeMsPerChartSecond;
    const lastPressMs = state.lastLanePressMs.get(landmine.channel);
    const pressedBeforeCrossing = lastPressMs !== undefined && lastPressMs <= crossingMs;
    const heldAtCrossing = pressedBeforeCrossing
      ? crossingMs - lastPressMs <= LONG_NOTE_REPEAT_HOLD_GRACE_MS || state.heldChannels.has(landmine.channel)
      : lastPressMs === undefined && state.heldChannels.has(landmine.channel);
    if (heldAtCrossing) {
      detonateLandmine(state, landmine, nowSec, emit);
    } else {
      markLandmineJudged(state, landmine);
    }
    state.landmineExpireCursor += 1;
  }
  for (let index = state.landmineExpireCursor; index < landmineNotes.length; index += 1) {
    const landmine = landmineNotes[index]!;
    if (landmine.seconds - nowSec > pgreatEarlySeconds) {
      break;
    }
    if (landmine.judged) {
      continue;
    }
    if (!isLandmineChannelHeld(state, landmine.channel, nowMs)) {
      continue;
    }
    detonateLandmine(state, landmine, nowSec, emit);
  }
}

function markExpiredInvisibleNotes(state: JudgeCoreState, referenceSeconds: number): void {
  const invisibleNotes = state.config.invisibleNotes;
  const horizon = badWindowSeconds(state.config);
  while (state.invisibleExpireCursor < invisibleNotes.length) {
    const invisible = invisibleNotes[state.invisibleExpireCursor]!;
    if (invisible.judged) {
      state.invisibleExpireCursor += 1;
      continue;
    }
    if (referenceSeconds - invisible.seconds <= horizon) {
      break;
    }
    markInvisibleJudged(state, invisible);
    state.invisibleExpireCursor += 1;
  }
}

// ---- auto scratch ---------------------------------------------------------------------------------------------

function applyAutoScratchJudgements(state: JudgeCoreState, referenceSeconds: number, emit: JudgeCoreEffectSink): void {
  const { config } = state;
  if (!config.autoScratch) {
    return;
  }
  const autoScratchNotes = state.autoScratchNotes;
  while (state.autoScratchCursor < autoScratchNotes.length) {
    const note = autoScratchNotes[state.autoScratchCursor]!;
    if (note.judged) {
      state.autoScratchCursor += 1;
      continue;
    }
    if (referenceSeconds < note.seconds) {
      break;
    }
    state.autoScratchCursor += 1;
    if (!markScorableJudged(state, note)) {
      continue;
    }
    emit({ kind: 'sound', source: 'auto-scratch', event: note.event, seconds: note.seconds, channel: note.channel });
    const endSeconds = resolveLongNoteEndSeconds(note);
    emit({ kind: 'ui', command: { kind: 'flash-lane', channel: note.channel } });
    if (typeof note.endBeat === 'number' && Number.isFinite(note.endBeat) && note.endBeat > note.beat) {
      note.visibleUntilBeat = note.endBeat;
      emit({ kind: 'ui', command: { kind: 'hold-lane-until-beat', channel: note.channel, beat: note.endBeat } });
    }
    if (endSeconds !== undefined) {
      emit({
        kind: 'long-note',
        seconds: note.seconds,
        channel: note.channel,
        state: 'start',
        mode: resolveLoggedLongNoteMode(note),
        event: note.event,
        endSeconds,
      });
      insertPendingAutoLongNote(state.pendingAutoScratchLongNotes, note, endSeconds);
      emit({
        kind: 'ui',
        command: {
          kind: 'long-note-start',
          channel: note.channel,
          beat: note.beat,
          mode: toUiLongNoteMode(resolveRulesetLongNoteMode(config.ruleset.longNoteStyle, note) ?? 2),
        },
      });
      continue;
    }
    applyAutoPerfect(state, note.channel, referenceSeconds, emit);
    emit({ kind: 'poor-trace', action: 'clear', seconds: referenceSeconds });
  }
}

function applyAutoPerfect(state: JudgeCoreState, channel: string, seconds: number, emit: JudgeCoreEffectSink): void {
  applyJudgeToSummary(state.summary, 'PERFECT', state.scoreTracker);
  applyGaugeJudge(state, seconds, 'PERFECT', emit);
  emit({ kind: 'poor-bga', action: 'clear', seconds });
  setCombo(state, seconds, state.combo + 1, 'judge', emit, 'PERFECT', channel);
  emit({
    kind: 'trace',
    name: 'auto-judge',
    seconds,
    fields: [
      ['result', 'PERFECT'],
      ['channel', channel],
    ],
  });
  emit({ kind: 'judge-combo', judge: 'PERFECT', combo: state.combo, channel });
}

function drainPendingAutoScratchLongNotes(
  state: JudgeCoreState,
  referenceSeconds: number,
  emit: JudgeCoreEffectSink,
): void {
  const pendingNotes = state.pendingAutoScratchLongNotes;
  const safeReferenceSeconds = Math.max(0, referenceSeconds) + JUDGE_TIME_EPSILON_SECONDS;
  while (pendingNotes.length > 0) {
    const pending = pendingNotes[0]!;
    if (pending.endSeconds > safeReferenceSeconds) {
      break;
    }
    pendingNotes.shift();
    emit({
      kind: 'long-note',
      seconds: pending.endSeconds,
      channel: pending.note.channel,
      state: 'complete',
      mode: resolveLoggedLongNoteMode(pending.note),
      event: pending.note.event,
      endSeconds: pending.endSeconds,
    });
    applyAutoPerfect(state, pending.note.channel, referenceSeconds, emit);
    if (longNoteScoresTail(state.config.ruleset.longNoteStyle, pending.note)) {
      // Charge modes judge the head and the tail separately; the turntable's auto-scratch clears both.
      applyJudgeToSummary(state.summary, 'PERFECT', state.scoreTracker);
      applyGaugeJudge(state, referenceSeconds, 'PERFECT', emit);
      setCombo(state, referenceSeconds, state.combo + 1, 'judge', emit, 'PERFECT', pending.note.channel);
      emit({ kind: 'judge-combo', judge: 'PERFECT', combo: state.combo, channel: pending.note.channel });
    }
    // Pair the `hold-lane-until-beat` emitted at the head so the LN-hold timer / lane laser fade out at the tail.
    emit({ kind: 'ui', command: { kind: 'long-note-end', channel: pending.note.channel, outcome: 'complete' } });
    emit({ kind: 'ui', command: { kind: 'release-lane', channel: pending.note.channel } });
  }
}

// ---- misses ---------------------------------------------------------------------------------------------------

function applyExpiredScorableJudgements(
  state: JudgeCoreState,
  referenceSeconds: number,
  emit: JudgeCoreEffectSink,
): void {
  const { config } = state;
  const scorableNotes = config.scorableNotes;
  while (state.scorableMissCursor < scorableNotes.length) {
    const note = scorableNotes[state.scorableMissCursor]!;
    if (note.judged) {
      state.scorableMissCursor += 1;
      continue;
    }
    if (referenceSeconds - note.seconds <= resolveMissDeadlineSeconds(config, note)) {
      break;
    }
    state.scorableMissCursor += 1;
    if (!markScorableJudged(state, note)) {
      continue;
    }
    if (typeof note.endBeat === 'number' && Number.isFinite(note.endBeat) && note.endBeat > note.beat) {
      note.visibleUntilBeat = note.endBeat;
    }
    applyJudgeToSummary(state.summary, 'POOR', state.scoreTracker);
    applyGaugeJudge(state, referenceSeconds, 'POOR', emit, 'miss');
    emit({ kind: 'poor-bga', action: 'trigger', seconds: referenceSeconds });
    emit({
      kind: 'trace',
      name: 'judge',
      seconds: referenceSeconds,
      fields: [
        ['result', 'POOR'],
        ['channel', note.channel],
        ['deltaMs', Math.round((referenceSeconds - note.seconds) * 1000)],
        ['reason', 'miss'],
      ],
    });
    emit({ kind: 'poor-trace', action: 'trigger', seconds: referenceSeconds });
    setCombo(state, referenceSeconds, 0, 'miss', emit, 'POOR', note.channel);
    // Miss-without-press: positive `signedDeltaMs` because the deadline passed without an input — the "late" band.
    emit({
      kind: 'judge-combo',
      judge: 'POOR',
      combo: state.combo,
      channel: note.channel,
      signedDeltaMs: (referenceSeconds - note.seconds) * 1000,
    });
    if (noteOwesTailMiss(config.ruleset, note)) {
      applyTailMissPoor(state, referenceSeconds, emit);
      emit({
        kind: 'trace',
        name: 'judge',
        seconds: referenceSeconds,
        fields: [
          ['result', 'POOR'],
          ['channel', note.channel],
          ['reason', 'charge-tail-miss'],
        ],
      });
    }
  }
}

// ---- long notes -----------------------------------------------------------------------------------------------

function finalizeActiveLongNote(
  state: JudgeCoreState,
  channel: string,
  judge: TimedManualJudge,
  atSeconds: number,
  emit: JudgeCoreEffectSink,
): void {
  state.activeLongNotes.delete(channel);
  state.longHoldUntilMs.delete(channel);
  state.longHoldReleaseSeconds.delete(channel);
  // Pair the head's `hold-lane-until-beat` so the renderer fades the LN-hold timer and lane laser out right here.
  emit({
    kind: 'ui',
    command: {
      kind: 'long-note-end',
      channel,
      outcome: judge.kind === 'BAD' || judge.kind === 'POOR' ? 'dropped' : 'complete',
    },
  });
  emit({ kind: 'ui', command: { kind: 'release-lane', channel } });
  applyResolvedManualJudge(state, channel, judge, atSeconds, emit);
}

/**
 * The judgment a long note's tail contributes. Charge modes already scored the head on the press, so the tail is its
 * own judgment; LN mode defers both and resolves them into the worse of the two.
 */
function resolveLongNoteTailJudge(hold: ActiveLongNoteState, tail: TimedManualJudge): TimedManualJudge {
  return hold.headScored ? tail : combineLongNoteJudges(hold.headJudge, tail);
}

function stopLongNoteSound(
  hold: ActiveLongNoteState,
  channel: string,
  nowSec: number,
  state: 'release' | 'break',
  emit: JudgeCoreEffectSink,
): void {
  emit({
    kind: 'long-note',
    seconds: nowSec,
    channel,
    state,
    mode: hold.mode,
    event: hold.note.event,
    endSeconds: hold.endSeconds,
  });
  emit({
    kind: 'stop-sound',
    channel,
    seconds: nowSec,
    reason: state === 'release' ? 'long-note-release' : 'long-note-break',
    event: hold.note.event,
  });
  hold.audioStopped = true;
}

/**
 * One judgment step at a single chart instant: long-note hold / tail resolution, auto-scratch, misses, mines and
 * invisible-note expiry.
 */
export function advanceJudgeState(
  state: JudgeCoreState,
  nowSec: number,
  nowMs: number,
  emit: JudgeCoreEffectSink,
): void {
  const { config } = state;
  for (const channel of state.heldChannels) {
    if (!state.activeLongNotes.has(channel)) {
      continue;
    }
    state.longHoldUntilMs.set(channel, nowMs + LONG_NOTE_REPEAT_HOLD_GRACE_MS);
  }

  for (const [channel, hold] of state.activeLongNotes.entries()) {
    const holdUntilMs = state.longHoldUntilMs.get(channel);
    const isHolding = holdUntilMs !== undefined && nowMs <= holdUntilMs;
    // The tail is judged against the release instant when there was one — a frame can be hundreds of chart
    // milliseconds wide at high `speed`, and quantizing to it would turn a clean release into a GOOD.
    const releaseSeconds = state.longHoldReleaseSeconds.get(channel);
    const tailJudgeSeconds = releaseSeconds ?? nowSec;
    if (hold.mode === 1 && holdUntilMs !== undefined && nowMs > holdUntilMs && tailJudgeSeconds < hold.endSeconds) {
      if (!hold.audioStopped) {
        stopLongNoteSound(hold, channel, nowSec, 'release', emit);
      }
      finalizeActiveLongNote(
        state,
        channel,
        { kind: 'BAD', signedDeltaMs: (tailJudgeSeconds - hold.endSeconds) * 1000 },
        tailJudgeSeconds,
        emit,
      );
      continue;
    }
    if (hold.mode === 3) {
      const accumulateUntilSeconds = Math.min(nowSec, hold.endSeconds);
      if (accumulateUntilSeconds > hold.gaugeDrainCursorSeconds) {
        const elapsedSeconds = accumulateUntilSeconds - hold.gaugeDrainCursorSeconds;
        if (isHolding) {
          // HCN GAIN — held cleanly through this step (upstream `gauge.update(1, 0.5f)` per 200 ms tick).
          applyGaugeDelta(state, nowSec, elapsedSeconds * HELL_CHARGE_GAUGE_GAIN_PER_SECOND, 'hold-gain', emit);
        } else {
          // HCN DRAIN — hold broken during this step (upstream `gauge.update(3, 0.5f)` per 200 ms tick).
          applyGaugeDelta(state, nowSec, -elapsedSeconds * HELL_CHARGE_GAUGE_DRAIN_PER_SECOND, 'hold-drain', emit);
        }
      }
      hold.gaugeDrainCursorSeconds = accumulateUntilSeconds;
      if (!isHolding && !hold.audioStopped) {
        stopLongNoteSound(hold, channel, nowSec, 'break', emit);
      }
    }

    if (nowSec >= hold.endSeconds) {
      if (
        isChargeLongNoteMode(hold.mode) &&
        isHolding &&
        nowSec < hold.endSeconds + judgeWindowLateReachUs(judgeWindowsFor(config, channel, hold.endSeconds, true)) / 1e6
      ) {
        // Charge modes judge the tail on the RELEASE. Still holding past the tail is not yet a judgment — the player
        // has until the tail's late window closes to let go, exactly as the play-log simulator models it.
        continue;
      }
      if (hold.mode === 1) {
        emit({
          kind: 'long-note',
          seconds: nowSec,
          channel,
          state: 'complete',
          mode: hold.mode,
          event: hold.note.event,
          endSeconds: hold.endSeconds,
        });
        finalizeActiveLongNote(state, channel, hold.headJudge, nowSec, emit);
        continue;
      }
      if (hold.mode === 3 && hold.endSeconds > hold.gaugeDrainCursorSeconds) {
        // Catch the HCN accumulator up to the tail mark; the residual slice takes the current step's hold state.
        const elapsedSeconds = hold.endSeconds - hold.gaugeDrainCursorSeconds;
        applyGaugeDelta(
          state,
          nowSec,
          isHolding
            ? elapsedSeconds * HELL_CHARGE_GAUGE_GAIN_PER_SECOND
            : -elapsedSeconds * HELL_CHARGE_GAUGE_DRAIN_PER_SECOND,
          isHolding ? 'hold-gain' : 'hold-drain',
          emit,
        );
        hold.gaugeDrainCursorSeconds = hold.endSeconds;
      }
      emit({
        kind: 'long-note',
        seconds: nowSec,
        channel,
        state: 'complete',
        mode: hold.mode,
        event: hold.note.event,
        endSeconds: hold.endSeconds,
      });
      const finalJudge =
        hold.mode === 3 && !isHolding && releaseSeconds === undefined
          ? resolveLongNoteTailJudge(hold, { kind: 'POOR', signedDeltaMs: (nowSec - hold.endSeconds) * 1000 })
          : resolveLongNoteTailJudge(
              hold,
              resolveManualTimedJudge(
                (tailJudgeSeconds - hold.endSeconds) * 1000,
                judgeWindowsFor(config, channel, hold.endSeconds, true),
              ),
            );
      finalizeActiveLongNote(state, channel, finalJudge, tailJudgeSeconds, emit);
      continue;
    }

    if (hold.mode === 2 && holdUntilMs !== undefined && nowMs > holdUntilMs) {
      if (!hold.audioStopped) {
        stopLongNoteSound(hold, channel, nowSec, 'release', emit);
      }
      finalizeActiveLongNote(
        state,
        channel,
        resolveLongNoteTailJudge(
          hold,
          resolveManualTimedJudge(
            (tailJudgeSeconds - hold.endSeconds) * 1000,
            judgeWindowsFor(config, channel, hold.endSeconds, true),
          ),
        ),
        tailJudgeSeconds,
        emit,
      );
    }
  }

  drainPendingAutoScratchLongNotes(state, nowSec, emit);
  for (const [channel, suppressUntil] of state.longNoteSuppressUntilSeconds.entries()) {
    if (nowSec >= suppressUntil) {
      state.longNoteSuppressUntilSeconds.delete(channel);
    }
  }

  applyAutoScratchJudgements(state, nowSec, emit);
  applyExpiredScorableJudgements(state, nowSec, emit);

  processLandminePassage(state, nowSec, nowMs, emit);
  markExpiredInvisibleNotes(state, nowSec);
}

/**
 * Safety net for notes the per-step sweep never reached (an audio tail that outran the loop, a hold still open at the
 * end). Counted from the notes themselves rather than from `summary.total`: the total is the ruleset's EX-SCORE
 * denominator, and under IIDX a missed charge note owes only ONE judgment even though it counts for two.
 */
export function finishJudgeState(state: JudgeCoreState, totalSeconds: number, emit: JudgeCoreEffectSink): void {
  const { ruleset } = state.config;
  let missingCount = 0;
  for (const note of state.config.scorableNotes) {
    if (note.judged) {
      continue;
    }
    note.judged = true;
    missingCount += 1;
    if (noteOwesTailMiss(ruleset, note)) {
      missingCount += 1;
    }
  }
  for (const hold of state.activeLongNotes.values()) {
    // The head already scored; only the unresolved tail is outstanding.
    if (hold.headScored) {
      missingCount += 1;
    }
  }
  state.activeLongNotes.clear();
  if (missingCount === 0) {
    return;
  }
  for (let index = 0; index < missingCount; index += 1) {
    applyJudgeToSummary(state.summary, 'POOR', state.scoreTracker);
    applyGaugeJudge(state, totalSeconds, 'POOR', emit, 'remaining-notes');
  }
  emit({ kind: 'poor-bga', action: 'trigger', seconds: totalSeconds });
  emit({
    kind: 'trace',
    name: 'judge',
    seconds: totalSeconds,
    fields: [
      ['result', 'POOR'],
      ['reason', 'remaining-notes'],
      ['count', missingCount],
    ],
  });
  emit({ kind: 'poor-trace', action: 'trigger', seconds: totalSeconds });
  setCombo(state, totalSeconds, 0, 'remaining-notes', emit, 'POOR');
  emit({ kind: 'judge-combo', judge: 'POOR', combo: state.combo });
  emit({ kind: 'frame', seconds: totalSeconds });
}
