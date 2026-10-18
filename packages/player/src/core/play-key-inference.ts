import { hasPressCandidate, type JudgeCoreEffect, type JudgeCoreInput, type JudgeCoreState } from './judge-core.ts';
import { compareJudgeChannels } from './judge-core-score.ts';

/** How long the press that hits a long note's head keeps its lane down with no further key event (a repeat delay). */
export const LONG_NOTE_INITIAL_HOLD_GRACE_MS = 380;
/** How long any other press, and each key repeat, keeps its lane down. */
export const LONG_NOTE_REPEAT_HOLD_GRACE_MS = 120;

/**
 * Key state for input that reports no key releases — a terminal without the kitty keyboard protocol, which sends a key
 * as one press and then, while it is held, as repeated presses. The judge core takes key-state input only, so the
 * inference turns that stream into the presses and releases it takes, and the judge, the play log and therefore a
 * replay and the play-log simulators all see the same keys:
 *
 * - a press on a lane that is up is a key going down (`hold` + `press`);
 * - a lane stays down for a grace after each press — {@link LONG_NOTE_INITIAL_HOLD_GRACE_MS} after the press that hits a
 *   long note's head (a terminal's repeat delay), {@link LONG_NOTE_REPEAT_HOLD_GRACE_MS} after any other;
 * - a press on a lane that is down is the held key repeating when the lane's long note is held, or when the press is
 *   the key of a long note it already let go (a long-note key repeat): it keeps the lane down and judges nothing;
 *   otherwise it is a new press on a lane that stays down (a key mashed faster than the grace);
 * - a press on a lane that is up and is the key of a long note it already let go is no press at all;
 * - once a lane's grace lapses with no repeat, its key comes up at that very instant (`release`, recorded as an
 *   `inferred` release), whenever the driver notices.
 *
 * A long-note key repeat is a press before the end of the long note whose head a press on the lane last hit, with no
 * long note held there and no note in reach of the press. The inference learns those heads from the judge core's
 * effects ({@link KeyStateInference.observe}), and forgets each once the judge has advanced to its end.
 *
 * Every step goes to the judge core in chart order, so it judges exactly what the play log records.
 */
export interface KeyStateInference {
  /** A press from the input, at chart second `nowSec` and judge millisecond `nowMs`. */
  press(channels: ReadonlySet<string>, tokens: readonly string[], nowSec: number, nowMs: number): void;
  /** Releases the keys whose grace lapsed before chart second `nowSec`; the judge advances to `nowSec` next. */
  releaseBefore(nowSec: number): void;
  /** An effect the judge core produced: a long-note head a press hit starts that lane's long-note key repeats. */
  observe(effect: JudgeCoreEffect): void;
  /** The input reports key releases after all: its own releases take over every lane held now. */
  stop(): void;
}

interface InferredHold {
  untilSec: number;
  untilMs: number;
  readonly tokens: Set<string>;
}

/**
 * Infers key state for the judge core `state`, sending every input to `step`. The driver hands every effect of the
 * core to {@link KeyStateInference.observe}. `onRelease` hears each inferred release (for the no-TUI trace).
 */
export function createKeyStateInference(
  state: JudgeCoreState,
  step: (input: JudgeCoreInput) => void,
  onRelease?: (seconds: number, tokens: readonly string[]) => void,
): KeyStateInference {
  const holds = new Map<string, InferredHold>();
  // The end of the long note whose head a press on each lane last hit, until the judge advances to it.
  const longNoteEnds = new Map<string, number>();
  // The chart time of the latest inferred release: a press stamped earlier (a key event drained late) is taken there,
  // so the judge, and the play log, see the inputs in order.
  let releasedThroughSec = Number.NEGATIVE_INFINITY;
  let releasedThroughMs = Number.NEGATIVE_INFINITY;
  const extend = (hold: InferredHold | undefined, nowSec: number, nowMs: number, graceMs: number): InferredHold => {
    const untilSec = nowSec + graceMs / state.config.judgeMsPerChartSecond;
    const untilMs = nowMs + graceMs;
    if (hold === undefined) return { untilSec, untilMs, tokens: new Set() };
    hold.untilSec = untilSec;
    hold.untilMs = untilMs;
    return hold;
  };

  /** The judge advances to `nowSec`: the long notes it reaches the end of no longer make key repeats. */
  const advancingTo = (nowSec: number): void => {
    for (const [channel, endSec] of longNoteEnds) {
      if (nowSec >= endSec) longNoteEnds.delete(channel);
    }
  };

  /** Whether a press on `channel` at `nowSec` is the key of a long note it already let go, still repeating. */
  const isLongNoteKeyRepeat = (channel: string, nowSec: number): boolean => {
    if (state.activeLongNotes.has(channel)) return false;
    const endSec = longNoteEnds.get(channel);
    return endSec !== undefined && nowSec < endSec && !hasPressCandidate(state, new Set([channel]), nowSec);
  };

  const release = (channel: string, hold: InferredHold): void => {
    holds.delete(channel);
    if (hold.untilSec > state.advancedThroughSeconds) {
      // The timed judgments due before the release settle first, as a replay of the play log settles them.
      advancingTo(hold.untilSec);
      step({ kind: 'advance', nowSec: hold.untilSec, nowMs: hold.untilMs });
    }
    const tokens = [...hold.tokens];
    step({
      kind: 'release',
      channels: new Set([channel]),
      tokens,
      nowSec: hold.untilSec,
      nowMs: hold.untilMs,
      recordSec: hold.untilSec,
      inferred: true,
    });
    releasedThroughSec = Math.max(releasedThroughSec, hold.untilSec);
    releasedThroughMs = Math.max(releasedThroughMs, hold.untilMs);
    onRelease?.(hold.untilSec, tokens);
  };

  const releaseDue = (isDue: (hold: InferredHold) => boolean): void => {
    const due = [...holds.entries()]
      .filter(([, hold]) => isDue(hold))
      .sort(([leftChannel, left], [rightChannel, right]) => {
        return left.untilSec - right.untilSec || compareJudgeChannels(leftChannel, rightChannel);
      });
    for (const [channel, hold] of due) release(channel, hold);
  };
  const releaseLapsedBefore = (nowSec: number): void => releaseDue((hold) => hold.untilSec < nowSec);

  return {
    press: (channels, tokens, pressSec, pressMs) => {
      const nowSec = Math.max(pressSec, releasedThroughSec);
      const nowMs = Math.max(pressMs, releasedThroughMs);
      releaseLapsedBefore(nowSec);
      const pressed = new Set<string>();
      for (const channel of channels) {
        const hold = holds.get(channel);
        const keyRepeat = isLongNoteKeyRepeat(channel, nowSec);
        if (hold !== undefined && (state.activeLongNotes.has(channel) || keyRepeat)) {
          // The held key repeating: the lane stays down and the press judges nothing.
          for (const token of tokens) hold.tokens.add(token);
          extend(hold, nowSec, nowMs, LONG_NOTE_REPEAT_HOLD_GRACE_MS);
          continue;
        }
        if (hold === undefined && keyRepeat) {
          // The key of a long note it already let go, still repeating: no press.
          continue;
        }
        pressed.add(channel);
      }
      if (pressed.size === 0) return;
      const heldBefore = new Set([...pressed].filter((channel) => state.activeLongNotes.has(channel)));
      step({ kind: 'hold', channels: pressed, inferred: true });
      step({ kind: 'press', channels: pressed, tokens, nowSec, nowMs });
      for (const channel of pressed) {
        // A press that hits a long note's head holds it through the terminal's repeat delay.
        const graceMs =
          !heldBefore.has(channel) && state.activeLongNotes.has(channel)
            ? LONG_NOTE_INITIAL_HOLD_GRACE_MS
            : LONG_NOTE_REPEAT_HOLD_GRACE_MS;
        const hold = extend(holds.get(channel), nowSec, nowMs, graceMs);
        for (const token of tokens) hold.tokens.add(token);
        holds.set(channel, hold);
      }
    },
    releaseBefore: (nowSec) => {
      releaseLapsedBefore(nowSec);
      advancingTo(nowSec);
    },
    observe: (effect) => {
      // A long note AUTO SCRATCH starts is recorded too, but no press on its lane reaches the inference.
      if (effect.kind !== 'long-note' || effect.state !== 'start') return;
      const endSec = longNoteEnds.get(effect.channel) ?? Number.NEGATIVE_INFINITY;
      if (effect.endSeconds > endSec) longNoteEnds.set(effect.channel, effect.endSeconds);
    },
    stop: () => {
      holds.clear();
      longNoteEnds.clear();
    },
  };
}
