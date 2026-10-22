import { resolveAltModifierLabel } from '../utils.ts';
import {
  createAutoJudgeState,
  isAutoJudgeSettled,
  runAutoJudgeStep,
  type AutoJudgeConfig,
  type AutoJudgeInput,
} from './auto-judge-core.ts';
import { clampToReversal } from './judge-core.ts';
import { resolveLongNoteEndSeconds, resolveRulesetLongNoteMode, toUILongNoteMode } from './judge-rules.ts';
import { printLaneMap, writePlayableSampleTriggerEventLog } from './engine-trace.ts';
import { createRealtimeAudioCursor } from './play-audio-cursor.ts';
import type { PlaySession } from './play-session.ts';
import { createSeekRebuildSink } from './play-seek.ts';
import type { JudgeStrategy, PlayJudge, PlayJudgeSeek } from './play-strategy.ts';

/**
 * The AUTO judge strategy: the auto judge core (`auto-judge-core.ts`) resolves every note as chart time reaches it,
 * and the strategy queues each note's keysound against the audio write head, ahead of its judgment.
 */

function writeAutoIntro(session: PlaySession): void {
  const { writeOutput, playbackChart } = session;
  const highSpeedModifierLabel = resolveAltModifierLabel();
  writeOutput('Auto play start\n');
  writeOutput(`Lane mode: ${playbackChart.laneDisplayMode}\n`);
  if (session.randomPatternSummary) {
    writeOutput(`${session.randomPatternSummary}\n`);
  }
  printLaneMap(writeOutput, playbackChart.laneBindings);
  writeOutput('Press Space to pause/resume. Press Shift+R to restart.\n');
  writeOutput('Press Ctrl+C or Esc to quit.\n');
  writeOutput(`Press ${highSpeedModifierLabel}+odd lane key to decrease HIGH-SPEED.\n`);
  writeOutput(`Press ${highSpeedModifierLabel}+even lane key to increase HIGH-SPEED.\n`);
}

/**
 * The chart seconds a play from the start judges at up to `seconds`, in order: every note's time and every long note's
 * end. Stepping a fresh judge through them makes its judgments in the order a play from the start made them.
 */
function rebuildSteps(config: AutoJudgeConfig, seconds: number): number[] {
  const steps = new Set<number>();
  for (const note of config.scorableNotes) {
    if (note.seconds <= seconds) steps.add(note.seconds);
    const endSeconds = resolveLongNoteEndSeconds(note);
    if (endSeconds !== undefined && endSeconds <= seconds) steps.add(endSeconds);
  }
  return [...steps].sort((a, b) => a - b);
}

function createAutoJudge(session: PlaySession): PlayJudge {
  const { playbackChart, uiEnabled, writeOutput, wavResources, idBase, audioSession, totalSeconds } = session;
  const { scorableNotes } = playbackChart;
  const config: AutoJudgeConfig = {
    ruleset: session.ruleset,
    scorableNotes,
    landmineNotes: playbackChart.landmineNotes,
    invisibleNotes: playbackChart.invisibleNotes,
    keyLabels: new Map(playbackChart.laneBindings.map((binding) => [binding.channel, binding.keyLabel])),
    // LR2 negative-BPM reversal (#134): AUTO play freezes there like manual play — no judging and no audio past it
    // (the realtime streams are cut in `collectRealtimeAudioTriggers`), and a mirrored display clock.
    reversalSeconds: session.resolvedChart.reversal?.seconds,
  };
  let autoJudge = createAutoJudgeState(config, session.score);
  const step = (input: AutoJudgeInput): void => {
    runAutoJudgeStep(autoJudge, input, session.applyJudgeEffect);
  };
  // Note keysounds freeze with the judge pump at an LR2 negative-BPM reversal (#134).
  const noteKeysounds = createRealtimeAudioCursor(
    scorableNotes,
    (note) => {
      if (!uiEnabled) {
        writePlayableSampleTriggerEventLog(
          writeOutput,
          note.event,
          note.seconds,
          wavResources,
          'auto-note',
          note.channel,
          idBase,
        );
      }
      audioSession?.triggerEvent?.(note.event);
    },
    (seconds) => clampToReversal(autoJudge.config, seconds),
  );
  let judgedThroughSeconds = 0;

  /** A fresh judge re-simulated from the start to `seconds`, the keysounds still ringing there started partway. */
  const seek = (seconds: number): PlayJudgeSeek => {
    autoJudge = createAutoJudgeState(config, session.score);
    const rebuild = createSeekRebuildSink(session.summary);
    for (const at of [...rebuildSteps(config, seconds), seconds]) {
      runAutoJudgeStep(autoJudge, { kind: 'advance', nowSec: at }, rebuild.emit);
    }
    noteKeysounds.seek(seconds, (note, offsetSeconds) => audioSession?.triggerEventAt?.(note.event, offsetSeconds));
    judgedThroughSeconds = seconds;
    return {
      judgments: rebuild.judgments,
      heldLongNotes: autoJudge.pendingLongNotes.map(({ note }) => ({
        channel: note.channel,
        beat: note.beat,
        endBeat: typeof note.endBeat === 'number' && note.endBeat > note.beat ? note.endBeat : undefined,
        mode: toUILongNoteMode(resolveRulesetLongNoteMode(config.ruleset.longNoteStyle, note) ?? 2),
      })),
    };
  };

  return {
    judge: (tick) => {
      noteKeysounds.triggerUntil(tick.scheduledSec);
      step({ kind: 'advance', nowSec: tick.nowSec });
      judgedThroughSeconds = tick.nowSec;
    },
    // A replay seeks once it re-drives its tempo changes from the second sought too (not yet).
    ...(session.replay ? {} : { seek }),
    judgedThroughSeconds: (tick) => tick.nowSec,
    isSettled: () => noteKeysounds.done && isAutoJudgeSettled(autoJudge),
    isClosed: () => false,
    finish: () => step({ kind: 'finish', totalSeconds }),
    settledThroughSeconds: () => judgedThroughSeconds,
  };
}

/** AUTO play: every note played and judged PGREAT on time. */
export const autoStrategy: JudgeStrategy = {
  mode: 'auto',
  estimatesActiveAudio: true,
  writeIntro: writeAutoIntro,
  createJudge: createAutoJudge,
};
