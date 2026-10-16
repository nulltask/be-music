import { advanceJudgeCoreReplay, createJudgeCoreReplay } from './judge-core.ts';
import type { PlaySession } from './play-session.ts';
import type { JudgeStrategy, PlayJudge } from './play-strategy.ts';
import { createPlayJudgeCore, judgeCoreJudge, MANUAL_DRIFTS, writeManualIntro } from './play-manual.ts';

/**
 * The replay judge strategy: the manual judge core re-driven by a recorded play-log input stream
 * (`PlayerOptions.replayInputs`). It steps the core from one judgment instant to the next (`advanceJudgeCoreReplay`)
 * up to each tick's chart time, so the replayed judgments depend on neither tick timing nor `speed`. Live lane and key
 * input is ignored; pause, HIGH-SPEED, tempo, view and interrupt commands still work.
 */
function createReplayJudge(session: PlaySession): PlayJudge {
  const { applyJudgeEffect } = session;
  const judgeCore = createPlayJudgeCore(session, 1000);
  const replay = createJudgeCoreReplay(session.options.replayInputs ?? []);
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

/** A replay: a recorded play's inputs, re-driven at their recorded chart times. */
export const replayStrategy: JudgeStrategy = {
  mode: 'manual',
  drifts: MANUAL_DRIFTS,
  estimatesActiveAudio: false,
  writeIntro: writeManualIntro,
  createJudge: createReplayJudge,
};
