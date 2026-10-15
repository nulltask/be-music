import type { PlaylogInputEvent } from '../playlog/format.ts';
import { advanceJudgeState, finishJudgeState, nextTimedJudgmentUs } from './judge-core-advance.ts';
import { handleLanePress, handleLaneRelease } from './judge-core-press.ts';
import {
  type JudgeCoreConfig,
  type JudgeCoreEffect,
  type JudgeCoreEffectSink,
  type JudgeCoreInput,
  type JudgeCoreScore,
  type JudgeCoreState,
} from './judge-core-types.ts';

/**
 * The deterministic judge core of manual play.
 *
 * Everything that decides a judgment — note selection, the ruleset windows, long-note holds and tails, the HCN gauge
 * ticks, mines, auto-scratch, misses, combo, score and gauge — lives in a {@link JudgeCoreState} that only
 * {@link runJudgeCoreStep} changes. A step takes one {@link JudgeCoreInput} stamped with chart time (and the
 * millisecond domain the hold-grace windows run in) and reports what happened as {@link JudgeCoreEffect}s, in order.
 * The core never reads a clock, never touches audio, the UI or the log, and never schedules anything: the same
 * state and the same inputs always produce the same effects. Drivers own the rest:
 *
 * - live play (`manualPlay`) steps it from the playback clock once per frame and on every key event;
 * - a replay steps it from one judgment instant to the next, merged with the recorded inputs ({@link advanceJudgeCoreReplay}),
 *   so its judgments do not depend on tick timing or `speed`.
 *
 * Effects are delivered synchronously through a sink, so a driver that reads the shared {@link JudgeCoreState.summary}
 * while handling one (the no-TUI state logger does) sees it exactly as it was when the effect was produced.
 */

export * from './judge-core-types.ts';
export { clampToReversal, maxJudgeReachSeconds, noteOwesTailMiss, toJudgeClock } from './judge-core-score.ts';
export { resolveLandmineExplosionEvent } from './judge-core-advance.ts';

/** Builds the initial judge state of a play. */
export function createJudgeCoreState(config: JudgeCoreConfig, score: JudgeCoreScore): JudgeCoreState {
  const scorableNoteSecondsByChannel = new Map<string, number[]>();
  for (const note of config.scorableNotes) {
    const noteTimes = scorableNoteSecondsByChannel.get(note.channel);
    if (noteTimes) {
      noteTimes.push(note.seconds);
    } else {
      scorableNoteSecondsByChannel.set(note.channel, [note.seconds]);
    }
  }
  return {
    config,
    summary: score.summary,
    scoreTracker: score.scoreTracker,
    applyGaugeJudge: score.applyGaugeJudge,
    applyGaugeDelta: score.applyGaugeDelta,
    applyGaugeTick: score.applyGaugeTick,
    drainGaugeToZero: score.drainGaugeToZero,
    combo: 0,
    heldChannels: new Set(),
    activeLongNotes: new Map(),
    longHoldUntilMs: new Map(),
    longHoldReleaseSeconds: new Map(),
    longNoteSuppressUntilSeconds: new Map(),
    laneHolds: new Map(),
    keyStateInput: false,
    advancedThroughSeconds: 0,
    pendingAutoScratchLongNotes: [],
    autoScratchNotes: config.autoScratch
      ? config.scorableNotes.filter((note) => config.scratchChannels.has(note.channel))
      : [],
    scorableNoteSecondsByChannel,
    autoScratchCursor: 0,
    scorableMissCursor: 0,
    landmineExpireCursor: 0,
    landminePhases: new Map(),
    hcnPassing: new Map(),
    invisibleExpireCursor: 0,
    remainingScorableNotes: config.scorableNotes.length,
    remainingLandmineNotes: config.landmineNotes.length,
    remainingInvisibleNotes: config.invisibleNotes.length,
  };
}

/** Applies one input to the state, delivering the effects to `emit` in the order they happen. */
export function runJudgeCoreStep(state: JudgeCoreState, input: JudgeCoreInput, emit: JudgeCoreEffectSink): void {
  switch (input.kind) {
    case 'advance':
      advanceJudgeState(state, input.nowSec, input.nowMs, emit);
      return;
    case 'press':
      handleLanePress(state, input.channels, input.tokens, input.nowMs, input.nowSec, emit);
      return;
    case 'hold':
      state.keyStateInput = true;
      for (const channel of input.channels) {
        state.heldChannels.add(channel);
        emit({ kind: 'ui', command: { kind: 'press-lane', channel } });
      }
      return;
    case 'release':
      handleLaneRelease(state, input, emit);
      return;
    case 'finish':
      finishJudgeState(state, input.totalSeconds, emit);
      return;
  }
}

/** {@link runJudgeCoreStep} collecting the effects into an array — `step(state, input) → effects`. */
export function stepJudgeCore(state: JudgeCoreState, input: JudgeCoreInput): JudgeCoreEffect[] {
  const effects: JudgeCoreEffect[] = [];
  runJudgeCoreStep(state, input, (effect) => {
    effects.push(effect);
  });
  return effects;
}

/** True once nothing is left to judge: every note resolved and no long note or auto-scratch tail outstanding. */
export function isJudgeCoreSettled(state: JudgeCoreState): boolean {
  return (
    state.remainingScorableNotes === 0 &&
    state.remainingLandmineNotes === 0 &&
    state.remainingInvisibleNotes === 0 &&
    state.pendingAutoScratchLongNotes.length === 0 &&
    state.activeLongNotes.size === 0
  );
}

/**
 * Maps key tokens onto the lanes they press, dropping auto-played scratch lanes. Fills and returns `buffer`, which is
 * cleared first — the result is only valid until the next call with the same buffer.
 */
export function resolveJudgeInputChannels(
  config: Pick<JudgeCoreConfig, 'autoScratch' | 'scratchChannels'>,
  inputTokenToChannels: ReadonlyMap<string, readonly string[]>,
  buffer: Set<string>,
  tokens: readonly string[],
  additionalTokens?: readonly string[],
): Set<string> {
  buffer.clear();
  const collect = (list: readonly string[]): void => {
    for (const token of list) {
      const mapped = inputTokenToChannels.get(token);
      if (!mapped) {
        continue;
      }
      mapped.forEach((channel) => buffer.add(channel));
    }
  };
  collect(tokens);
  if (additionalTokens && additionalTokens.length > 0) {
    collect(additionalTokens);
  }
  if (config.autoScratch) {
    for (const channel of buffer) {
      if (config.scratchChannels.has(channel)) {
        buffer.delete(channel);
      }
    }
  }
  return buffer;
}

// ---- replay ---------------------------------------------------------------------------------------------------

/** A recorded input stream being re-driven through the core. */
export interface JudgeCoreReplay {
  readonly events: readonly PlaylogInputEvent[];
  cursor: number;
  /** The chart second the judge state has been advanced to. */
  judgedThroughSeconds: number;
  /** The same instant in whole microseconds. */
  judgedThroughUs: number;
}

/** Sorts a play log's inputs into replay order. */
export function createJudgeCoreReplay(inputs: readonly PlaylogInputEvent[]): JudgeCoreReplay {
  return {
    events: [...inputs].sort((left, right) => left.timeUs - right.timeUs || left.seq - right.seq),
    cursor: 0,
    judgedThroughSeconds: Number.NEGATIVE_INFINITY,
    judgedThroughUs: Number.NEGATIVE_INFINITY,
  };
}

function processReplayEventsUntil(
  state: JudgeCoreState,
  replay: JudgeCoreReplay,
  untilSec: number,
  emit: JudgeCoreEffectSink,
): void {
  const { config } = state;
  while (replay.cursor < replay.events.length) {
    const event = replay.events[replay.cursor]!;
    const eventSec = event.timeUs / 1_000_000;
    if (eventSec > untilSec) break;
    replay.cursor += 1;
    const channels = new Set(event.channels);
    if (config.autoScratch) {
      for (const channel of channels) {
        if (config.scratchChannels.has(channel)) {
          channels.delete(channel);
        }
      }
    }
    if (channels.size === 0) continue;
    const eventMs = eventSec * config.judgeMsPerChartSecond;
    if (event.action === 'down') {
      runJudgeCoreStep(state, { kind: 'hold', channels }, emit);
      emit({ kind: 'input-time', seconds: eventSec });
      runJudgeCoreStep(
        state,
        { kind: 'press', channels, tokens: event.tokens ?? [], nowSec: eventSec, nowMs: eventMs },
        emit,
      );
    } else {
      runJudgeCoreStep(
        state,
        {
          kind: 'release',
          channels,
          tokens: event.tokens ?? [],
          nowSec: eventSec,
          nowMs: eventMs,
          recordSec: eventSec,
        },
        emit,
      );
    }
  }
}

/**
 * Advances a replay's judge state up to `untilSec`, stepping from one instant to the next: to each replay event's own
 * microsecond, and to the microsecond after each timed judgment ({@link nextTimedJudgmentUs}) — a tail, a miss
 * deadline, an AUTO SCRATCH note, a mine check — so every step settles the judgments of exactly one instant, in the
 * order the play-log simulator settles them. The state is stepped to each event's instant BEFORE the event is applied,
 * so a release resolves its long note before a later press on that lane can refresh the hold, and misses, tails and
 * presses reach the gauge in chart-time order — the gauge clamps at its bounds, so the order of judgments is part of
 * the result. The steps depend only on the chart and the inputs, never on how the calls are spaced.
 */
export function advanceJudgeCoreReplay(
  state: JudgeCoreState,
  replay: JudgeCoreReplay,
  untilSec: number,
  emit: JudgeCoreEffectSink,
): void {
  const msPerSecond = state.config.judgeMsPerChartSecond;
  const untilUs = Math.round(untilSec * 1e6);
  for (;;) {
    const nextEvent = replay.events[replay.cursor];
    const nextEventUs = nextEvent === undefined ? Number.POSITIVE_INFINITY : nextEvent.timeUs;
    const stepUs = Math.min(nextEventUs, nextTimedJudgmentUs(state, replay.judgedThroughUs) + 1);
    if (!(stepUs <= untilUs)) {
      if (untilUs > replay.judgedThroughUs) {
        replay.judgedThroughUs = untilUs;
        replay.judgedThroughSeconds = untilSec;
      }
      return;
    }
    const stepSec = stepUs / 1e6;
    advanceJudgeState(state, stepSec, stepSec * msPerSecond, emit);
    replay.judgedThroughUs = stepUs;
    replay.judgedThroughSeconds = stepSec;
    if (nextEventUs <= stepUs) {
      processReplayEventsUntil(state, replay, stepSec, emit);
    }
  }
}
