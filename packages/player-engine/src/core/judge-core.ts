import type { ReplayInputEvent } from '../replay/format.ts';
import { advanceJudgeState, finishJudgeState, nextTimedJudgmentUs } from './judge-core-advance.ts';
import { markScorableJudged, markLandmineJudged, markInvisibleJudged } from './judge-core-score.ts';
import { handleLanePress, handleLaneRelease, resolveAnyKeyPressChannels } from './judge-core-press.ts';
import { AnyKeyRoutes, anyKeyRouteKeys } from './any-key.ts';
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
 * millisecond domain the release margins run in) and reports what happened as {@link JudgeCoreEffect}s, in order.
 * It takes key-state input only: lanes are down exactly between their `hold` and `release`. A driver whose input
 * reports no key releases infers them before they reach the core (`play-key-inference.ts`).
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
export {
  clampToReversal,
  isJudgingClosed,
  maxJudgeReachSeconds,
  noteOwesTailMiss,
  toJudgeClock,
} from './judge-core-score.ts';
export { resolveLandmineExplosionEvent } from './judge-core-advance.ts';
export { hasPressCandidate, resolveAnyKeyPressChannels } from './judge-core-press.ts';

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
  const state: JudgeCoreState = {
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
    longNoteSettleMs: new Map(),
    longHoldReleaseSeconds: new Map(),
    laneHolds: new Map(),
    anyKeyRoutes: new AnyKeyRoutes(),
    advancedThroughSeconds: 0,
    pendingAutoScratchLongNotes: [],
    autoScratchNotes: config.autoScratch
      ? config.scorableNotes.filter((note) => (config.autoScratchChannels ?? config.scratchChannels).has(note.channel))
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
  const from = config.practiceFromSeconds;
  if (from !== undefined && Number.isFinite(from) && from > 0) {
    for (const note of config.scorableNotes) {
      if (note.seconds < from) {
        markScorableJudged(state, note);
        // Hide a skipped long note even when its tail lies after the practice start.
        note.visibleUntilBeat = note.beat;
      }
    }
    for (const note of config.landmineNotes) if (note.seconds < from) markLandmineJudged(state, note);
    for (const note of config.invisibleNotes) if (note.seconds < from) markInvisibleJudged(state, note);
    state.advancedThroughSeconds = from;
  }
  return state;
}

/** Applies one input to the state, delivering the effects to `emit` in the order they happen. */
export function runJudgeCoreStep(state: JudgeCoreState, input: JudgeCoreInput, emit: JudgeCoreEffectSink): void {
  switch (input.kind) {
    case 'advance':
      advanceJudgeState(state, input.nowSec, input.nowMs, emit);
      return;
    case 'press':
      if (state.config.anyKey === true) {
        pressAnyKey(state, input, emit);
        return;
      }
      handleLanePress(state, input.channels, input.tokens, input.nowMs, input.nowSec, emit);
      return;
    case 'hold':
      holdLanes(
        state,
        state.config.anyKey === true
          ? state.anyKeyRoutes.routedLanes(anyKeyRouteKeys(input.tokens ?? [], input.channels))
          : input.channels,
        input.inferred === true,
        emit,
      );
      return;
    case 'release':
      if (state.config.anyKey === true) {
        const keys = anyKeyRouteKeys(input.tokens, input.channels);
        handleLaneRelease(
          state,
          { ...input, channels: state.anyKeyRoutes.release(keys, input.channels) },
          emit,
          input.channels,
        );
        return;
      }
      handleLaneRelease(state, input, emit);
      return;
    case 'finish':
      finishJudgeState(state, input.totalSeconds, emit);
      return;
  }
}

/** Holds `channels` down until their release; `inferred` holds show no lane cue. */
function holdLanes(
  state: JudgeCoreState,
  channels: ReadonlySet<string>,
  inferred: boolean,
  emit: JudgeCoreEffectSink,
): void {
  for (const channel of channels) {
    state.heldChannels.add(channel);
    if (!inferred) {
      emit({ kind: 'ui', command: { kind: 'press-lane', channel } });
    }
  }
}

/**
 * An ANY KEY press (#751): routed to the lane of the nearest note in reach (`resolveAnyKeyPressChannels`), which its keys
 * then hold down until they come up. The key's own `hold` may arrive before the press (a replay) or after it (live
 * input), so the press holds the routed lane itself and a `hold` holds only lanes its keys were already routed to. The
 * replay records the keys' own lanes, so a simulation routes the press again.
 */
function pressAnyKey(
  state: JudgeCoreState,
  input: Extract<JudgeCoreInput, { kind: 'press' }>,
  emit: JudgeCoreEffectSink,
): void {
  const lanes = resolveAnyKeyPressChannels(state, input.channels, input.nowSec);
  state.anyKeyRoutes.route(anyKeyRouteKeys(input.tokens, input.channels), lanes);
  holdLanes(state, lanes, false, emit);
  handleLanePress(state, lanes, input.tokens, input.nowMs, input.nowSec, emit, input.channels);
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
  config: Pick<JudgeCoreConfig, 'autoScratch' | 'scratchChannels' | 'autoScratchChannels'>,
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
      if ((config.autoScratchChannels ?? config.scratchChannels).has(channel)) {
        buffer.delete(channel);
      }
    }
  }
  return buffer;
}

// ---- replay ---------------------------------------------------------------------------------------------------

/** A recorded input stream being re-driven through the core. */
export interface JudgeCoreReplay {
  readonly events: readonly ReplayInputEvent[];
  cursor: number;
  /** The chart second the judge state has been advanced to. */
  judgedThroughSeconds: number;
  /** The same instant in whole microseconds. */
  judgedThroughUs: number;
}

/** Sorts a replay's inputs into replay order. */
export function createJudgeCoreReplay(inputs: readonly ReplayInputEvent[]): JudgeCoreReplay {
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
        if ((config.autoScratchChannels ?? config.scratchChannels).has(channel)) {
          channels.delete(channel);
        }
      }
    }
    if (channels.size === 0) continue;
    const eventMs = eventSec * config.judgeMsPerChartSecond;
    if (event.action === 'down') {
      runJudgeCoreStep(state, { kind: 'hold', channels, tokens: event.tokens ?? [] }, emit);
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
          ...(event.inferred === true ? { inferred: true } : {}),
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
 * order the replay simulator settles them. The state is stepped to each event's instant BEFORE the event is applied,
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
