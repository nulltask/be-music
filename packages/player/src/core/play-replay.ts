import type { PlaylogInputEvent } from '../playlog/format.ts';
import {
  advanceJudgeCoreReplay,
  createJudgeCoreReplay,
  runJudgeCoreStep,
  type JudgeCoreEffectSink,
  type JudgeCoreState,
} from './judge-core.ts';
import { createKeyStateInference } from './play-key-inference.ts';
import type { PlaySession } from './play-session.ts';
import type { JudgeStrategy, PlayJudge } from './play-strategy.ts';
import { createPlayJudgeCore, judgeCoreJudge, writeManualIntro } from './play-manual.ts';

/**
 * The replay judge strategy: the manual judge core re-driven by a recorded play-log input stream
 * (`PlayerOptions.replayInputs`). It steps the core from one judgment instant to the next (`advanceJudgeCoreReplay`)
 * up to each tick's chart time, so the replayed judgments depend on neither tick timing nor `speed`. Live lane and key
 * input is ignored; pause, HIGH-SPEED, tempo, view and interrupt commands still work.
 *
 * A log recorded before the engine inferred releases for input that reports none (a terminal without the kitty
 * keyboard protocol) has its presses go through the same key-state inference a live play's would
 * (`play-key-inference.ts`), with its graces on chart time, and the replay records the releases it infers.
 */
function createReplayJudge(session: PlaySession): PlayJudge {
  const judgeCore = createPlayJudgeCore(session, 1000);
  const inputs = session.options.replayInputs ?? [];
  if (isRecordedWithoutReleases(inputs)) {
    return createInferringReplayJudge(session, judgeCore, inputs);
  }
  const { applyJudgeEffect } = session;
  const replay = createJudgeCoreReplay(inputs);
  return {
    ...judgeCoreJudge(session, judgeCore),
    beforeAudio: (tick) => {
      advanceJudgeCoreReplay(judgeCore, replay, tick.nowSec, applyJudgeEffect);
    },
    judge: () => undefined,
    // A replay has only judged up to its last chart-time step, which can trail the tick by up to one step.
    judgedThroughSeconds: () => replay.judgedThroughSeconds,
    // Everything due by the last step's chart time has been judged, whether or not a judgment fell on it.
    settledThroughSeconds: () => Math.max(0, replay.judgedThroughSeconds),
    beforeFinish: () => {
      if (replay.events.length > 0) {
        // The loop can end once every note is judged while inputs are still queued — typically the release that
        // follows the last note. Drain them so the re-recorded play log carries the whole input stream no matter how
        // far the final tick overshot.
        advanceJudgeCoreReplay(judgeCore, replay, replay.events.at(-1)!.timeUs / 1_000_000, applyJudgeEffect);
      }
    },
  };
}

/**
 * Whether `inputs` came from input that reported no key releases, logged before the engine inferred them: not one
 * release, and a lane pressed again with no release in between — a key repeat, or the lane's next note. Input that
 * reports releases logs that only when two keys on one lane are both held to the end of the play.
 */
export function isRecordedWithoutReleases(inputs: readonly PlaylogInputEvent[]): boolean {
  if (inputs.some((input) => input.action === 'up')) return false;
  const pressed = new Set<string>();
  for (const input of inputs) {
    for (const channel of input.channels) {
      if (pressed.has(channel)) return true;
      pressed.add(channel);
    }
  }
  return false;
}

/**
 * A replay of a log without releases: each recorded press goes through the key-state inference at its own instant,
 * and each inferred release comes at the instant its grace lapses, with every timed judgment in between settled at its
 * own instant, as a replay of the log it re-records would settle them.
 */
function createInferringReplayJudge(
  session: PlaySession,
  judgeCore: JudgeCoreState,
  inputs: readonly PlaylogInputEvent[],
): PlayJudge {
  const { applyJudgeEffect } = session;
  const { config } = judgeCore;
  const presses = createJudgeCoreReplay(inputs).events;
  // Steps the core's timed judgments only; the presses and releases come from the inference.
  const timed = createJudgeCoreReplay([]);
  const emit: JudgeCoreEffectSink = (effect) => {
    keyState.observe(effect);
    applyJudgeEffect(effect);
  };
  const keyState = createKeyStateInference(judgeCore, (input) => runJudgeCoreStep(judgeCore, input, emit));
  let cursor = 0;

  /** Settles every timed judgment and inferred release before chart second `seconds`, each at its own instant. */
  const settleBefore = (seconds: number): void => {
    for (let lapse = keyState.nextReleaseSeconds(); lapse < seconds; lapse = keyState.nextReleaseSeconds()) {
      advanceJudgeCoreReplay(judgeCore, timed, lapse, emit);
      keyState.releaseThrough(lapse);
    }
  };

  const advanceTo = (untilSec: number): void => {
    while (cursor < presses.length) {
      const event = presses[cursor]!;
      const eventSec = event.timeUs / 1_000_000;
      if (eventSec > untilSec) break;
      cursor += 1;
      const channels = new Set(event.channels);
      if (config.autoScratch) {
        for (const channel of config.scratchChannels) channels.delete(channel);
      }
      if (channels.size === 0) continue;
      const eventMs = eventSec * config.judgeMsPerChartSecond;
      settleBefore(eventSec);
      advanceJudgeCoreReplay(judgeCore, timed, eventSec, emit);
      // The state steps to the press's own instant before the press, once per instant, as a replay steps to an input.
      if (judgeCore.advancedThroughSeconds < eventSec) {
        runJudgeCoreStep(judgeCore, { kind: 'advance', nowSec: eventSec, nowMs: eventMs }, emit);
      }
      emit({ kind: 'input-time', seconds: eventSec });
      keyState.press(channels, event.tokens ?? [], eventSec, eventMs);
    }
    settleBefore(untilSec);
    keyState.releaseBefore(untilSec);
    advanceJudgeCoreReplay(judgeCore, timed, untilSec, emit);
  };

  return {
    ...judgeCoreJudge(session, judgeCore),
    beforeAudio: (tick) => advanceTo(tick.nowSec),
    judge: () => undefined,
    judgedThroughSeconds: () => timed.judgedThroughSeconds,
    settledThroughSeconds: () => Math.max(0, timed.judgedThroughSeconds),
    beforeFinish: () => {
      // Every press, and the releases inferred after the last of them, even when the loop ended before they were due.
      advanceTo(presses.at(-1)!.timeUs / 1_000_000);
      settleBefore(Number.POSITIVE_INFINITY);
    },
  };
}

/** A replay: a recorded play's inputs, re-driven at their recorded chart times. */
export const replayStrategy: JudgeStrategy = {
  mode: 'manual',
  estimatesActiveAudio: false,
  writeIntro: writeManualIntro,
  createJudge: createReplayJudge,
};
