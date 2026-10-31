import { advanceJudgeCoreReplay, createJudgeCoreReplay, type JudgeCoreEffect } from './judge-core.ts';
import type { PlaySession } from './play-session.ts';
import type { JudgeStrategy, PlayJudge } from './play-strategy.ts';
import { createPlayJudgeCore, judgeCoreJudge, writeManualIntro } from './play-manual.ts';
import { createSeekRebuildSink } from './play-seek.ts';
import { resolveRulesetLongNoteMode, toUILongNoteMode } from './judge-rules.ts';

/**
 * The replay judge strategy: the manual judge core re-driven by a recorded replay input stream
 * (`PlayerOptions.replayInputs`). It steps the core from one judgment instant to the next (`advanceJudgeCoreReplay`)
 * up to each tick's chart time, so the replayed judgments depend on neither tick timing nor `speed`. Live lane and key
 * input is ignored; pause, HIGH-SPEED, tempo, view and interrupt commands still work.
 *
 * The recorded inputs are replayed as they are. A log recorded before the engine inferred releases for input that
 * reports none (a terminal without the kitty keyboard protocol) has only presses, so each key stays down from its press
 * to the end of the play and every key repeat is a press of its own, as the replay simulators read it.
 */
function createReplayJudge(session: PlaySession): PlayJudge {
  const { applyJudgeEffect } = session;
  let judgeCore = createPlayJudgeCore(session, 1000);
  let replay = createJudgeCoreReplay(session.options.replayInputs ?? []);
  let coreJudge = judgeCoreJudge(session, judgeCore);
  return {
    isSettled: () => coreJudge.isSettled(),
    isClosed: () => coreJudge.isClosed(),
    finish: () => coreJudge.finish(),
    seek: (seconds) => {
      judgeCore = createPlayJudgeCore(session, 1000);
      coreJudge = judgeCoreJudge(session, judgeCore);
      replay = createJudgeCoreReplay(session.options.replayInputs ?? []);
      const rebuilt = createSeekRebuildSink(session.summary);
      // Rebuild silently, retaining keysounds not cut by a later stop on their lane.
      const sounds = new Map<string, Array<Extract<JudgeCoreEffect, { kind: 'sound' }>>>();
      advanceJudgeCoreReplay(judgeCore, replay, seconds, (effect) => {
        rebuilt.emit(effect);
        if (effect.kind === 'sound') {
          const lane = sounds.get(effect.channel) ?? [];
          lane.push(effect);
          sounds.set(effect.channel, lane);
        } else if (effect.kind === 'stop-sound') sounds.delete(effect.channel);
      });
      for (const lane of sounds.values()) {
        for (const sound of lane)
          session.audioSession?.triggerEventAt?.(sound.event, Math.max(0, seconds - sound.seconds));
      }
      return {
        judgments: rebuilt.judgments,
        bmsonBGAInputs: rebuilt.bmsonBGAInputs,
        chartTextInputs: rebuilt.chartTextInputs,
        heldLongNotes: [
          ...[...judgeCore.activeLongNotes.values()]
            .filter(({ note }) => judgeCore.heldChannels.has(note.channel))
            .map(({ note, mode }) => ({
              channel: note.channel,
              beat: note.beat,
              endBeat: note.endBeat,
              mode: toUILongNoteMode(mode),
            })),
          ...judgeCore.pendingAutoScratchLongNotes.map(({ note }) => ({
            channel: note.channel,
            beat: note.beat,
            endBeat: note.endBeat,
            mode: toUILongNoteMode(resolveRulesetLongNoteMode(session.ruleset.longNoteStyle, note) ?? 2),
          })),
        ],
      };
    },
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
        // follows the last note. Drain them so the re-recorded replay carries the whole input stream no matter how
        // far the final tick overshot.
        advanceJudgeCoreReplay(judgeCore, replay, replay.events.at(-1)!.timeUs / 1_000_000, applyJudgeEffect);
      }
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
