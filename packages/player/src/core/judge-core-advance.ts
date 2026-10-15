import type { BeMusicEvent } from '@be-music/json';
import type { TimedLandmineNote, TimedPlayableNote } from '../playable-notes.ts';
import { judgeWindowLateReachUs, pgreatWindowReachUs } from '../ruleset/judge.ts';
import { isChargeLongNoteMode } from '../ruleset/long-note.ts';
import {
  combineLongNoteJudges,
  insertPendingAutoLongNote,
  longNoteScoresTail,
  resolveLoggedLongNoteMode,
  resolveLongNoteEndSeconds,
  resolveLongNoteEarlyReleaseJudge,
  resolveManualTimedJudge,
  resolveRulesetLongNoteMode,
  toUiLongNoteMode,
  type PendingAutoLongNoteState,
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
  clampToReversal,
  compareJudgeChannels,
  judgeWindowsFor,
  markInvisibleJudged,
  markLandmineJudged,
  markScorableJudged,
  noteOwesTailMiss,
  resolveMissDeadlineSeconds,
  resolveMissDeadlineUs,
  setCombo,
  toJudgeClock,
  toJudgeUs,
  windowTablesAt,
} from './judge-core-score.ts';
import {
  type ActiveLongNoteState,
  HELL_CHARGE_GAUGE_DRAIN_PER_SECOND,
  HELL_CHARGE_GAUGE_GAIN_PER_SECOND,
  type JudgeCoreEffectSink,
  type JudgeCoreState,
  LANDMINE_EXPLOSION_SAMPLE_KEY,
  LONG_NOTE_REPEAT_HOLD_GRACE_MS,
} from './judge-core-types.ts';
import { createLaneHoldHistory, type LaneHoldHistory, wasLaneDownAt, wasLanePressedWithin } from './lane-hold.ts';

/**
 * Judge-core time steps: long-note holds and tails, HCN ticks, mines, auto-scratch, misses
 * and the end-of-play charge.
 */

// ---- mines ----------------------------------------------------------------------------------------------------

/** The press / release history of `channel`, created on first use. */
export function laneHoldHistory(state: JudgeCoreState, channel: string): LaneHoldHistory {
  let history = state.laneHolds.get(channel);
  if (history === undefined) {
    history = createLaneHoldHistory();
    state.laneHolds.set(channel, history);
  }
  return history;
}

/**
 * Whether `channel`'s key was down at `atMs`. With release events (key-state input, replays) that is read off the
 * recorded presses and releases, so it does not matter when the question is asked or in what order the driver applied
 * the inputs around `atMs`; an input at `atMs` itself comes first. Without them a press counts as held for the same
 * short grace window the long-note hold logic uses for terminal key repeat.
 */
function wasLaneDownAtMs(state: JudgeCoreState, channel: string, atMs: number): boolean {
  const history = state.laneHolds.get(channel);
  if (state.keyStateInput) {
    // A key-state hold that came without a press is only known to be down now.
    if (history === undefined || history.spans.length === 0) return state.heldChannels.has(channel);
    return wasLaneDownAt(history, atMs);
  }
  return history !== undefined && wasLanePressedWithin(history, atMs - LONG_NOTE_REPEAT_HOLD_GRACE_MS, atMs);
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

/** Upper bound (µs) on any ruleset's PGREAT reach, so a mine scan can stop at mines too far ahead to matter. */
const LANDMINE_SCAN_AHEAD_US = 1_000_000;

/**
 * Mines, by the ruleset's `mineTrigger`. LR2 (`'press-or-hold'`, LR2's own changelog, 080114 entry): a mine explodes
 * when its lane's key is down as the mine enters the PGREAT window or crosses the judge line ("キー押したまま地雷通過"),
 * or on a press within the PGREAT window ("ピカグレ範囲内でキーを押す", {@link detonateLandminesOnPress}); it settles
 * once the window closes behind it. beatoraja (`'hold'`, `JudgeManager` L244): only the key being down as the mine
 * crosses counts, and the mine settles there.
 *
 * Each check is a timed judgment at its own microsecond (the entry, the crossing, the settling), taken once time has
 * moved past it and in time order with the other mines, asking whether the lane was down at that instant. The play-log
 * simulator schedules the same checks, so both detonate the same mines in the same order.
 */
export function processLandminePassage(
  state: JudgeCoreState,
  nowSec: number,
  nowMs: number,
  emit: JudgeCoreEffectSink,
): void {
  const { config } = state;
  const landmineNotes = config.landmineNotes;
  const reversalSeconds = config.reversalSeconds;
  const pressDetonates = config.ruleset.mineTrigger === 'press-or-hold';
  const nowUs = toJudgeUs(nowSec);
  const due: Array<{ atUs: number; landmine: TimedLandmineNote; phase: 1 | 2 | 3 }> = [];
  for (let index = state.landmineExpireCursor; index < landmineNotes.length; index += 1) {
    const landmine = landmineNotes[index]!;
    if (reversalSeconds !== undefined && landmine.seconds >= reversalSeconds) {
      // Mines at or behind the LR2 reversal are frozen with the pump (#134) — they neither detonate nor retire.
      break;
    }
    const mineUs = toJudgeUs(landmine.seconds);
    if (mineUs - LANDMINE_SCAN_AHEAD_US >= nowUs) {
      break;
    }
    if (landmine.judged) {
      continue;
    }
    // Reach form keeps the early / late legs separate — nothing guarantees a ruleset's window table is symmetric.
    const [pgreatLateUs, pgreatEarlyUs] = pgreatWindowReachUs(windowTablesAt(config, landmine.seconds).note);
    const phase = state.landminePhases.get(landmine) ?? 0;
    if (pressDetonates && phase < 1 && mineUs - pgreatEarlyUs < nowUs) {
      due.push({ atUs: mineUs - pgreatEarlyUs, landmine, phase: 1 });
    }
    if (phase < 2 && mineUs < nowUs) {
      due.push({ atUs: mineUs, landmine, phase: 2 });
    }
    // Under the hold-only rule a mine settles as it crosses; LR2 waits for the PGREAT window to close.
    const settleUs = pressDetonates ? mineUs + pgreatLateUs : mineUs;
    if (settleUs < nowUs) {
      due.push({ atUs: settleUs, landmine, phase: 3 });
    }
  }
  due.sort(
    (left, right) =>
      left.atUs - right.atUs ||
      compareJudgeChannels(left.landmine.channel, right.landmine.channel) ||
      left.phase - right.phase,
  );
  for (const check of due) {
    if (check.landmine.judged) {
      continue;
    }
    state.landminePhases.set(check.landmine, check.phase);
    if (check.phase === 3) {
      markLandmineJudged(state, check.landmine);
      continue;
    }
    const atMs = nowMs - (nowSec - check.atUs / 1e6) * config.judgeMsPerChartSecond;
    if (wasLaneDownAtMs(state, check.landmine.channel, atMs)) {
      detonateLandmine(state, check.landmine, nowSec, emit);
    }
  }
  while (state.landmineExpireCursor < landmineNotes.length && landmineNotes[state.landmineExpireCursor]!.judged) {
    state.landmineExpireCursor += 1;
  }
}

/**
 * LR2's press leg (`mineTrigger: 'press-or-hold'`): a press detonates every unsettled mine on the pressed lanes whose
 * PGREAT window contains it. Detonation never consumes the press: the note judgment still runs.
 */
export function detonateLandminesOnPress(
  state: JudgeCoreState,
  channels: ReadonlySet<string>,
  nowSec: number,
  emit: JudgeCoreEffectSink,
): void {
  const { config } = state;
  if (config.ruleset.mineTrigger !== 'press-or-hold') {
    return;
  }
  const reversalSeconds = config.reversalSeconds;
  if (reversalSeconds !== undefined && nowSec >= reversalSeconds) {
    // The press leg is dead past the reversal (#134).
    return;
  }
  const landmineNotes = config.landmineNotes;
  const nowUs = toJudgeUs(nowSec);
  for (let index = state.landmineExpireCursor; index < landmineNotes.length; index += 1) {
    const landmine = landmineNotes[index]!;
    if (reversalSeconds !== undefined && landmine.seconds >= reversalSeconds) {
      // The early reach must not detonate mines positioned behind the reversal (#134).
      break;
    }
    const mineUs = toJudgeUs(landmine.seconds);
    if (mineUs - LANDMINE_SCAN_AHEAD_US > nowUs) {
      break;
    }
    if (landmine.judged || !channels.has(landmine.channel)) {
      continue;
    }
    // LR2 reads the PGREAT window in force at the press (`#EXRANK` can change it).
    const [pgreatLateUs, pgreatEarlyUs] = pgreatWindowReachUs(windowTablesAt(config, nowSec).note);
    if (mineUs - pgreatEarlyUs <= nowUs && nowUs - mineUs <= pgreatLateUs) {
      detonateLandmine(state, landmine, nowSec, emit);
    }
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

/**
 * AUTO SCRATCH: the scratch notes whose time has passed, and the auto-played long notes whose tail has, in time order
 * (a tail before a head at the same instant, then channel order), each at its own microsecond.
 */
function applyAutoScratchJudgements(state: JudgeCoreState, referenceSeconds: number, emit: JudgeCoreEffectSink): void {
  const { config } = state;
  const nowUs = toJudgeUs(referenceSeconds);
  for (;;) {
    const due: Array<{ atUs: number; channel: string; order: number; run: () => void }> = [];
    for (const pending of state.pendingAutoScratchLongNotes) {
      const atUs = toJudgeUs(pending.endSeconds);
      if (atUs < nowUs) {
        due.push({
          atUs,
          channel: pending.note.channel,
          order: 0,
          run: () => completeAutoScratchLongNote(state, pending, referenceSeconds, emit),
        });
      }
    }
    if (config.autoScratch) {
      const autoScratchNotes = state.autoScratchNotes;
      for (let index = state.autoScratchCursor; index < autoScratchNotes.length; index += 1) {
        const note = autoScratchNotes[index]!;
        const atUs = toJudgeUs(note.seconds);
        if (atUs >= nowUs) {
          break;
        }
        if (note.judged) {
          continue;
        }
        due.push({
          atUs,
          channel: note.channel,
          order: 1,
          run: () => startAutoScratchNote(state, note, referenceSeconds, emit),
        });
      }
    }
    if (due.length === 0) {
      break;
    }
    due.sort(
      (left, right) =>
        left.atUs - right.atUs || left.order - right.order || compareJudgeChannels(left.channel, right.channel),
    );
    for (const entry of due) {
      entry.run();
    }
    while (
      state.autoScratchCursor < state.autoScratchNotes.length &&
      state.autoScratchNotes[state.autoScratchCursor]!.judged
    ) {
      state.autoScratchCursor += 1;
    }
  }
}

function startAutoScratchNote(
  state: JudgeCoreState,
  note: TimedPlayableNote,
  referenceSeconds: number,
  emit: JudgeCoreEffectSink,
): void {
  const { config } = state;
  if (!markScorableJudged(state, note)) {
    return;
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
    if (longNoteScoresTail(config.ruleset.longNoteStyle, note)) {
      // Charge modes judge the head and the tail separately: auto scratch clears the head now, the tail at the tail
      // (beatoraja's autoplay).
      applyAutoPerfect(state, note.channel, referenceSeconds, emit);
    }
    emit({
      kind: 'ui',
      command: {
        kind: 'long-note-start',
        channel: note.channel,
        beat: note.beat,
        mode: toUiLongNoteMode(resolveRulesetLongNoteMode(config.ruleset.longNoteStyle, note) ?? 2),
      },
    });
    return;
  }
  applyAutoPerfect(state, note.channel, referenceSeconds, emit);
  emit({ kind: 'poor-trace', action: 'clear', seconds: referenceSeconds });
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

function completeAutoScratchLongNote(
  state: JudgeCoreState,
  pending: PendingAutoLongNoteState,
  referenceSeconds: number,
  emit: JudgeCoreEffectSink,
): void {
  const index = state.pendingAutoScratchLongNotes.indexOf(pending);
  if (index < 0) {
    return;
  }
  state.pendingAutoScratchLongNotes.splice(index, 1);
  emit({
    kind: 'long-note',
    seconds: pending.endSeconds,
    channel: pending.note.channel,
    state: 'complete',
    mode: resolveLoggedLongNoteMode(pending.note),
    event: pending.note.event,
    endSeconds: pending.endSeconds,
  });
  // The LN's one judgment, or a charge note's tail (its head was cleared at the head).
  applyAutoPerfect(state, pending.note.channel, referenceSeconds, emit);
  // Pair the `hold-lane-until-beat` emitted at the head so the LN-hold timer / lane laser fade out at the tail.
  emit({ kind: 'ui', command: { kind: 'long-note-end', channel: pending.note.channel, outcome: 'complete' } });
  emit({ kind: 'ui', command: { kind: 'release-lane', channel: pending.note.channel } });
}

// ---- misses ---------------------------------------------------------------------------------------------------

function applyExpiredScorableJudgements(
  state: JudgeCoreState,
  referenceSeconds: number,
  emit: JudgeCoreEffectSink,
): void {
  const { config } = state;
  const scorableNotes = config.scorableNotes;
  const nowUs = toJudgeUs(referenceSeconds);
  // Every note past its own deadline, whatever lane it is on (the deadlines differ by lane and by `#EXRANK`), missed in
  // time order and, at one instant, in channel order.
  const due: Array<{ atUs: number; note: TimedPlayableNote }> = [];
  for (let index = state.scorableMissCursor; index < scorableNotes.length; index += 1) {
    const note = scorableNotes[index]!;
    if (toJudgeUs(note.seconds) >= nowUs) {
      break;
    }
    if (note.judged) {
      continue;
    }
    const deadlineUs = resolveMissDeadlineUs(config, note);
    if (deadlineUs < nowUs) {
      due.push({ atUs: deadlineUs, note });
    }
  }
  due.sort((left, right) => left.atUs - right.atUs || compareJudgeChannels(left.note.channel, right.note.channel));
  for (const { note } of due) {
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
  while (state.scorableMissCursor < scorableNotes.length && scorableNotes[state.scorableMissCursor]!.judged) {
    state.scorableMissCursor += 1;
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

/** The microsecond past which a charge tail still held is a missed POOR: the tail's late window closes there. */
function resolveChargeTailDeadlineUs(state: JudgeCoreState, channel: string, hold: ActiveLongNoteState): number {
  return (
    toJudgeUs(hold.endSeconds) + judgeWindowLateReachUs(judgeWindowsFor(state.config, channel, hold.endSeconds, true))
  );
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

  // Holds are judged on the judge clock: past an LR2 reversal it is the mirrored `t' = 2R - now`, which never reaches
  // a tail beyond R — a hold spanning the reversal stays open while held and BADs on release, as in LR2
  // (`LR2f.cpp:7613-7616`). Judgments, logs and UI cues keep the true clock.
  const judgeSec = toJudgeClock(config, nowSec);
  const judgeUs = toJudgeUs(judgeSec);
  // Tails reached at one instant settle in channel order, the tie-break the play-log simulator uses.
  const holds = [...state.activeLongNotes.entries()].sort(([left], [right]) => compareJudgeChannels(left, right));
  for (const [channel, hold] of holds) {
    const holdUntilMs = state.longHoldUntilMs.get(channel);
    const isHolding = holdUntilMs !== undefined && nowMs <= holdUntilMs;
    // The tail is judged against the release instant when there was one — a frame can be hundreds of chart
    // milliseconds wide at high `speed`, and quantizing to it would turn a clean release into a GOOD.
    const releaseSeconds = state.longHoldReleaseSeconds.get(channel);
    const tailJudgeSeconds = releaseSeconds === undefined ? judgeSec : toJudgeClock(config, releaseSeconds);
    // When the tail resolves on the true clock (the release instant, or this step).
    const tailAtSeconds = releaseSeconds ?? nowSec;
    if (hold.mode === 1 && holdUntilMs !== undefined && nowMs > holdUntilMs && tailJudgeSeconds < hold.endSeconds) {
      if (!hold.audioStopped) {
        stopLongNoteSound(hold, channel, nowSec, 'release', emit);
      }
      // Let go before the tail: the ruleset decides whether that is a BAD or keeps (or worsens) the head judgment.
      finalizeActiveLongNote(
        state,
        channel,
        resolveLongNoteEarlyReleaseJudge(
          config.ruleset,
          hold.headJudge,
          (tailJudgeSeconds - hold.endSeconds) * 1000,
          judgeWindowsFor(config, channel, tailJudgeSeconds, true),
        ),
        tailAtSeconds,
        emit,
      );
      continue;
    }
    if (hold.mode === 3) {
      const accumulateUntilSeconds = Math.min(judgeSec, hold.endSeconds);
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

    // A tail settles once time has moved past it (whole microseconds, like every timed judgment).
    if (judgeUs > toJudgeUs(hold.endSeconds)) {
      if (
        isChargeLongNoteMode(hold.mode) &&
        isHolding &&
        judgeUs <= resolveChargeTailDeadlineUs(state, channel, hold)
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
      // A charge tail that was never let go is a missed POOR, whether the hold broke (HCN) or ran past the tail's late
      // window: only a release is judged against the windows (beatoraja's `CN end poor`).
      const finalJudge =
        isChargeLongNoteMode(hold.mode) && releaseSeconds === undefined
          ? resolveLongNoteTailJudge(hold, { kind: 'POOR', signedDeltaMs: (judgeSec - hold.endSeconds) * 1000 })
          : resolveLongNoteTailJudge(
              hold,
              resolveManualTimedJudge(
                (tailJudgeSeconds - hold.endSeconds) * 1000,
                judgeWindowsFor(config, channel, tailJudgeSeconds, true),
              ),
            );
      finalizeActiveLongNote(state, channel, finalJudge, tailAtSeconds, emit);
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
            judgeWindowsFor(config, channel, tailJudgeSeconds, true),
          ),
        ),
        tailAtSeconds,
        emit,
      );
    }
  }

  for (const [channel, suppressUntil] of state.longNoteSuppressUntilSeconds.entries()) {
    if (nowSec >= suppressUntil) {
      state.longNoteSuppressUntilSeconds.delete(channel);
    }
  }

  // Clamped to the reversal: notes whose miss deadline falls before it are still missed on time, while everything past
  // it stays unjudged forever — matching LR2's frozen judge pump.
  applyAutoScratchJudgements(state, clampToReversal(config, nowSec), emit);
  applyExpiredScorableJudgements(state, clampToReversal(config, nowSec), emit);

  processLandminePassage(state, nowSec, nowMs, emit);
  markExpiredInvisibleNotes(state, nowSec);
}

/**
 * The earliest microsecond, at or after `afterUs`, at which a timed judgment falls due: a long-note tail, a charge
 * tail's late window or a release waiting to settle, an AUTO SCRATCH note or tail, a miss deadline, a mine check. A
 * judgment falls due once time has moved past its microsecond, so a replay that steps to the microsecond after each
 * settles one instant per step, in the same order as the play-log simulator. `Infinity` when nothing is pending.
 */
export function nextTimedJudgmentUs(state: JudgeCoreState, afterUs: number): number {
  const { config } = state;
  const reversalUs =
    config.reversalSeconds === undefined ? Number.POSITIVE_INFINITY : toJudgeUs(config.reversalSeconds);
  let next = Number.POSITIVE_INFINITY;
  const consider = (atUs: number): void => {
    if (atUs >= afterUs && atUs < next) {
      next = atUs;
    }
  };
  for (const [channel, hold] of state.activeLongNotes) {
    const holdUntilMs = state.longHoldUntilMs.get(channel);
    if (!state.heldChannels.has(channel) && holdUntilMs !== undefined && Number.isFinite(holdUntilMs)) {
      consider(toJudgeUs(holdUntilMs / config.judgeMsPerChartSecond));
    }
    if (toJudgeUs(hold.endSeconds) >= reversalUs) {
      // The mirrored judge clock never reaches a tail past the LR2 reversal.
      continue;
    }
    consider(toJudgeUs(hold.endSeconds));
    if (isChargeLongNoteMode(hold.mode)) {
      consider(resolveChargeTailDeadlineUs(state, channel, hold));
    }
  }
  for (const pending of state.pendingAutoScratchLongNotes) {
    if (toJudgeUs(pending.endSeconds) < reversalUs) consider(toJudgeUs(pending.endSeconds));
  }
  if (config.autoScratch) {
    for (let index = state.autoScratchCursor; index < state.autoScratchNotes.length; index += 1) {
      const note = state.autoScratchNotes[index]!;
      if (!note.judged && toJudgeUs(note.seconds) >= afterUs) {
        if (toJudgeUs(note.seconds) < reversalUs) consider(toJudgeUs(note.seconds));
        break;
      }
    }
  }
  const scorableNotes = config.scorableNotes;
  for (let index = state.scorableMissCursor; index < scorableNotes.length; index += 1) {
    const note = scorableNotes[index]!;
    if (toJudgeUs(note.seconds) > next) {
      break;
    }
    if (note.judged) {
      continue;
    }
    const deadlineUs = resolveMissDeadlineUs(config, note);
    if (deadlineUs < reversalUs) consider(deadlineUs);
  }
  const pressDetonates = config.ruleset.mineTrigger === 'press-or-hold';
  const landmineNotes = config.landmineNotes;
  for (let index = state.landmineExpireCursor; index < landmineNotes.length; index += 1) {
    const landmine = landmineNotes[index]!;
    const mineUs = toJudgeUs(landmine.seconds);
    if (mineUs >= reversalUs || mineUs - LANDMINE_SCAN_AHEAD_US > next) {
      break;
    }
    if (landmine.judged) {
      continue;
    }
    const [pgreatLateUs, pgreatEarlyUs] = pgreatWindowReachUs(windowTablesAt(config, landmine.seconds).note);
    const phase = state.landminePhases.get(landmine) ?? 0;
    if (pressDetonates && phase < 1) consider(mineUs - pgreatEarlyUs);
    if (phase < 2) consider(mineUs);
    consider(pressDetonates ? mineUs + pgreatLateUs : mineUs);
  }
  return next;
}

/**
 * Safety net for notes the per-step sweep never reached (an audio tail that outran the loop, a hold still open at the
 * end). Counted from the notes themselves rather than from `summary.total`: the total is the ruleset's EX-SCORE
 * denominator, and under IIDX a missed charge note owes only ONE judgment even though it counts for two.
 */
export function finishJudgeState(state: JudgeCoreState, totalSeconds: number, emit: JudgeCoreEffectSink): void {
  const { config } = state;
  const { ruleset, reversalSeconds } = config;
  let missingCount = 0;
  // Notes the LR2 negative-BPM reversal left unreachable (#134). LR2 never misses them — its mirrored judge clock
  // recedes before their deadline — and zeroes HP when the play ends with them outstanding.
  let outstandingPastReversal = false;
  for (const note of config.scorableNotes) {
    if (note.judged) {
      continue;
    }
    note.judged = true;
    if (reversalSeconds !== undefined && note.seconds + resolveMissDeadlineSeconds(config, note) >= reversalSeconds) {
      outstandingPastReversal = true;
      continue;
    }
    missingCount += 1;
    if (noteOwesTailMiss(ruleset, note)) {
      missingCount += 1;
    }
  }
  for (const hold of state.activeLongNotes.values()) {
    if (reversalSeconds !== undefined) {
      // A hold still open at the end of a reversed run spans the reversal: the mirrored clock never reaches its tail,
      // so LR2 never judges it.
      outstandingPastReversal = true;
      continue;
    }
    // The head already scored; only the unresolved tail is outstanding.
    if (hold.headScored) {
      missingCount += 1;
    }
  }
  state.activeLongNotes.clear();
  if (missingCount > 0) {
    chargeRemainingNotes(state, totalSeconds, missingCount, emit);
  }
  if (outstandingPastReversal) {
    // LR2 sets HP = 0 when a play ends with notes unjudged (OpenLR2 `LR2f.cpp:12980-12982`, LR2body.exe 0x42c525), so
    // a reversed run that leaves notes behind is always FAILED. be-music still ends the song at its precomputed end
    // instead of waiting for ESC (documented deviation), but reports the same result.
    drainGaugeAtReversalEnd(state, totalSeconds, emit);
  }
}

/** Empties the gauge at the end of a reversed run with notes outstanding (see {@link finishJudgeState}). */
function drainGaugeAtReversalEnd(state: JudgeCoreState, totalSeconds: number, emit: JudgeCoreEffectSink): void {
  state.drainGaugeToZero();
  emit({
    kind: 'trace',
    name: 'gauge',
    seconds: totalSeconds,
    fields: [
      ['value', 0],
      ['reason', 'notes-outstanding-past-reversal'],
    ],
  });
  emit({ kind: 'frame', seconds: totalSeconds });
}

function chargeRemainingNotes(
  state: JudgeCoreState,
  totalSeconds: number,
  missingCount: number,
  emit: JudgeCoreEffectSink,
): void {
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
