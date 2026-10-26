import type { BeMusicEvent } from '@be-music/chart-source';
import type { TimedLandmineNote, TimedPlayableNote } from '../playable-notes.ts';
import { judgeWindowLateReachUs, pgreatWindowReachUs } from '../ruleset/judge.ts';
import { addHCNPassing, HCNTickCounter, isChargeLongNoteMode } from '../ruleset/long-note.ts';
import {
  combineLongNoteJudges,
  insertPendingAutoLongNote,
  longNoteScoresTail,
  resolveLoggedLongNoteMode,
  resolveLongNoteEndSeconds,
  resolveLongNoteEarlyReleaseJudge,
  resolveManualTimedJudge,
  resolveRulesetLongNoteMode,
  toUILongNoteMode,
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
  applyHCNGaugeTick,
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
  isJudgingClosed,
} from './judge-core-score.ts';
import {
  type ActiveLongNoteState,
  type HCNPassingState,
  type JudgeCoreEffectSink,
  type JudgeCoreState,
  LANDMINE_EXPLOSION_SAMPLE_KEY,
} from './judge-core-types.ts';
import { createLaneHoldHistory, type LaneHoldHistory, wasLaneDownAt } from './lane-hold.ts';

/**
 * Judgment-core time steps: long-note holds and tails, HCN ticks, mines, auto-scratch, misses
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
 * Whether `channel`'s key was down at `atMs`, read off the recorded presses and releases, so it does not matter when
 * the question is asked or in what order the driver applied the inputs around `atMs`; an input at `atMs` itself comes
 * first.
 */
function wasLaneDownAtMs(state: JudgeCoreState, channel: string, atMs: number): boolean {
  const history = state.laneHolds.get(channel);
  // A key-state hold that came without a press is only known to be down now.
  if (history === undefined || history.spans.length === 0) return state.heldChannels.has(channel);
  return wasLaneDownAt(history, atMs);
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
  if (isJudgingClosed(state)) {
    return;
  }
  const landmineGaugeEffect = resolveLandmineGaugeEffect(landmine.event, config.idBase, config.sourceFormat);
  const landmineExplosionEvent = landmine.silent
    ? undefined
    : resolveLandmineExplosionEvent(landmine.event, config.wavResources);
  if (landmineExplosionEvent) {
    emit({
      kind: 'sound',
      source: 'mine-hit',
      event: landmineExplosionEvent,
      seconds: nowSec,
      channel: landmine.channel,
    });
  }
  // LR2beta3 counts one POOR without applying an ordinary POOR judgment: no combo break or judge gauge damage.
  // beatoraja and the provisional That-Which-Must-Not-Be-Named model remain gauge-only. Raw damage bypasses guts and TOTAL modifiers.
  if (config.ruleset.mineTrigger === 'press-ahead-or-hold') {
    state.summary.poor += 1;
    state.summary.minePoor = (state.summary.minePoor ?? 0) + 1;
  }
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

/** Upper bound (µs) on the scanned mine reach, so a mine scan can stop at mines too far ahead to matter. */
const LANDMINE_SCAN_AHEAD_US = 1_000_000;

/**
 * Held mines detonate at crossing, then retire. The provisional That-Which-Must-Not-Be-Named model also checks PGREAT entry and waits
 * for its late window to close; LR2beta3 has neither extra phase. The same timed events run in the simulator.
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
    // LR2beta3 and hold-only settle at crossing; only the provisional That-Which-Must-Not-Be-Named model keeps a late window.
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
 * LR2beta3 key-down detonates only ahead of the line, strictly inside GREAT. The provisional That-Which-Must-Not-Be-Named model keeps
 * its historical symmetric PGREAT window. Detonation never consumes the press: note judgment still runs.
 */
export function detonateLandminesOnPress(
  state: JudgeCoreState,
  channels: ReadonlySet<string>,
  nowSec: number,
  emit: JudgeCoreEffectSink,
): void {
  const { config } = state;
  if (config.ruleset.mineTrigger === 'hold') {
    return;
  }
  const reversalSeconds = config.reversalSeconds;
  if (reversalSeconds !== undefined && toJudgeUs(nowSec) > toJudgeUs(reversalSeconds)) {
    // The press leg is dead past the reversal (#134); a press at the reversal itself still counts.
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
    // Read the window in force at the press (`#EXRANK` can change it).
    const [pgreatLateUs, pgreatEarlyUs] = pgreatWindowReachUs(windowTablesAt(config, nowSec).note);
    const hit =
      config.ruleset.mineTrigger === 'press-ahead-or-hold'
        ? mineUs >= nowUs && mineUs - nowUs < windowTablesAt(config, nowSec).note.judges[1][1]
        : mineUs - pgreatEarlyUs <= nowUs && nowUs - mineUs <= pgreatLateUs;
    if (hit) {
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
        mode: toUILongNoteMode(resolveRulesetLongNoteMode(config.ruleset.longNoteStyle, note) ?? 2),
      },
    });
    return;
  }
  applyAutoPerfect(state, note.channel, referenceSeconds, emit);
  emit({ kind: 'poor-trace', action: 'clear', seconds: referenceSeconds });
}

function applyAutoPerfect(state: JudgeCoreState, channel: string, seconds: number, emit: JudgeCoreEffectSink): void {
  if (isJudgingClosed(state)) {
    return;
  }
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
  for (const { atUs, note } of due) {
    if (!markScorableJudged(state, note)) {
      continue;
    }
    startHCNPassing(state, note, atUs);
    if (typeof note.endBeat === 'number' && Number.isFinite(note.endBeat) && note.endBeat > note.beat) {
      note.visibleUntilBeat = note.endBeat;
    }
    if (isJudgingClosed(state)) {
      continue;
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
  const heldNote = state.activeLongNotes.get(channel)?.note;
  let passing = state.hcnPassing.get(channel);
  while (passing !== undefined && passing.note !== heldNote) {
    passing = passing.next;
  }
  if (passing !== undefined && isGoodOrBetter(judge.kind)) {
    // A Hell Charge tail released at GOOD or better keeps its lane gaining until the tail passes.
    passing.tailGood = true;
  }
  state.activeLongNotes.delete(channel);
  state.longNoteSettleMs.delete(channel);
  state.longHoldReleaseSeconds.delete(channel);
  if (passing !== undefined) {
    setHCNGaining(state, channel, toJudgeUs(atSeconds), emit);
  }
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
  applyResolvedManualJudge(state, channel, judge, atSeconds, emit, true);
}

// ---- Hell Charge gauge ticks -----------------------------------------------------------------------------------

function isGoodOrBetter(kind: TimedManualJudge['kind']): boolean {
  return kind === 'PERFECT' || kind === 'GREAT' || kind === 'GOOD';
}

/**
 * Starts the gauge ticks of a Hell Charge note whose head was just judged at `judgedUs` (pressed, or missed at its
 * deadline): they run from the later of the head and that instant until the tail passes. AUTO SCRATCH lanes have
 * none.
 */
export function startHCNPassing(state: JudgeCoreState, note: TimedPlayableNote, judgedUs: number): void {
  const { config } = state;
  const endSeconds = resolveLongNoteEndSeconds(note);
  if (endSeconds === undefined || resolveRulesetLongNoteMode(config.ruleset.longNoteStyle, note) !== 3) {
    return;
  }
  if (config.autoScratch && (config.autoScratchChannels ?? config.scratchChannels).has(note.channel)) {
    return;
  }
  for (let passing = state.hcnPassing.get(note.channel); passing !== undefined; passing = passing.next) {
    if (passing.note === note) {
      return;
    }
  }
  const startUs = Math.max(toJudgeUs(note.seconds), judgedUs);
  const counter = new HCNTickCounter(startUs);
  counter.setGaining(isLaneDown(state, note.channel), startUs, () => undefined);
  const passing: HCNPassingState = { note, endUs: toJudgeUs(endSeconds), counter, tailGood: false };
  const chain = addHCNPassing(state.hcnPassing.get(note.channel), passing, startUs);
  if (chain !== undefined) {
    state.hcnPassing.set(note.channel, chain);
  }
}

/** Re-reads whether a lane with a passing Hell Charge note gains (a key on it is down, or its tail went well). */
export function setHCNGaining(state: JudgeCoreState, channel: string, atUs: number, emit: JudgeCoreEffectSink): void {
  for (let passing = state.hcnPassing.get(channel); passing !== undefined; passing = passing.next) {
    passing.counter.setGaining(
      passing.tailGood || isLaneDown(state, channel),
      Math.min(atUs, passing.endUs),
      (gain, tickUs) => applyHCNGaugeTick(state, tickUs / 1e6, gain, emit),
    );
  }
}

function isLaneDown(state: JudgeCoreState, channel: string): boolean {
  return (state.laneHolds.get(channel)?.activeTokens.size ?? 0) > 0;
}

/** Runs every passing Hell Charge note's ticks up to `nowUs` (channel order), and ends those whose tail has passed. */
function advanceHCNPassing(state: JudgeCoreState, nowUs: number, emit: JudgeCoreEffectSink): void {
  const passings = [...state.hcnPassing.entries()].sort(([left], [right]) => compareJudgeChannels(left, right));
  for (const [channel, first] of passings) {
    for (let passing: HCNPassingState | undefined = first; passing !== undefined; passing = passing.next) {
      passing.counter.advance(Math.min(nowUs, passing.endUs), (gain, tickUs) =>
        applyHCNGaugeTick(state, tickUs / 1e6, gain, emit),
      );
      if (nowUs <= passing.endUs) {
        state.hcnPassing.set(channel, passing);
        break;
      }
      if (passing.next === undefined) {
        state.hcnPassing.delete(channel);
      }
    }
  }
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
  state.advancedThroughSeconds = Math.max(state.advancedThroughSeconds, nowSec);

  // Holds are judged on the judge clock: past an LR2 reversal it is the mirrored `t' = 2R - now`, which never reaches
  // a tail beyond R — a hold spanning the reversal stays open while held and BADs on release, as in LR2
  // (`LR2f.cpp:7613-7616`). Judgments, logs and UI cues keep the true clock.
  const judgeSec = toJudgeClock(config, nowSec);
  const judgeUs = toJudgeUs(judgeSec);
  // Tails reached at one instant settle in channel order, the tie-break the replay simulator uses.
  const holds = [...state.activeLongNotes.entries()].sort(([left], [right]) => compareJudgeChannels(left, right));
  for (const [channel, hold] of holds) {
    // A long note is held while its lane is down, and while a let-go one waits out the ruleset's release margin.
    const settleMs = state.heldChannels.has(channel) ? undefined : state.longNoteSettleMs.get(channel);
    const isHolding = state.heldChannels.has(channel) || (settleMs !== undefined && nowMs <= settleMs);
    // The tail is judged against the release instant when there was one — a frame can be hundreds of chart
    // milliseconds wide at high `speed`, and quantizing to it would turn a clean release into a GOOD.
    const releaseSeconds = state.longHoldReleaseSeconds.get(channel);
    const tailJudgeSeconds = releaseSeconds === undefined ? judgeSec : toJudgeClock(config, releaseSeconds);
    // When the tail resolves on the true clock (the release instant, or this step).
    const tailAtSeconds = releaseSeconds ?? nowSec;
    if (hold.mode === 1 && !isHolding && tailJudgeSeconds < hold.endSeconds) {
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
    // A tail settles once time has moved past it (whole microseconds, like every timed judgment).
    if (judgeUs > toJudgeUs(hold.endSeconds)) {
      if (
        isChargeLongNoteMode(hold.mode) &&
        isHolding &&
        judgeUs <= resolveChargeTailDeadlineUs(state, channel, hold)
      ) {
        // Charge modes judge the tail on the RELEASE. Still holding past the tail is not yet a judgment — the player
        // has until the tail's late window closes to let go, exactly as the replay simulator models it.
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

    if (isChargeLongNoteMode(hold.mode) && !isHolding) {
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

  advanceHCNPassing(state, toJudgeUs(nowSec), emit);

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
 * settles one instant per step, in the same order as the replay simulator. `Infinity` when nothing is pending.
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
    const settleMs = state.longNoteSettleMs.get(channel);
    if (!state.heldChannels.has(channel) && settleMs !== undefined && Number.isFinite(settleMs)) {
      consider(toJudgeUs(settleMs / config.judgeMsPerChartSecond));
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
  for (const passing of state.hcnPassing.values()) {
    consider(Math.min(passing.counter.nextTickUs(), passing.endUs));
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
 * denominator, and under That-Which-Must-Not-Be-Named a missed charge note owes only ONE judgment even though it counts for two.
 */
export function finishJudgeState(state: JudgeCoreState, totalSeconds: number, emit: JudgeCoreEffectSink): void {
  const { config } = state;
  if (isJudgingClosed(state)) {
    // A play that ended on failure leaves the rest of the chart unjudged; no end-of-play rule applies.
    return;
  }
  const { ruleset, reversalSeconds } = config;
  // Settle every timed judgment still pending — misses, tails, AUTO SCRATCH, mines, Hell Charge ticks — each at its
  // own instant, as the replay simulator does when its clock runs out.
  for (let afterUs = Number.NEGATIVE_INFINITY; ;) {
    const nextUs = nextTimedJudgmentUs(state, afterUs);
    if (!Number.isFinite(nextUs)) {
      break;
    }
    const stepSec = (nextUs + 1) / 1e6;
    advanceJudgeState(state, stepSec, stepSec * config.judgeMsPerChartSecond, emit);
    afterUs = nextUs + 1;
  }
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
  if (reversalSeconds !== undefined && state.pendingAutoScratchLongNotes.length > 0) {
    // An AUTO SCRATCH long note whose tail lies past the reversal is never cleared either.
    outstandingPastReversal = true;
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
