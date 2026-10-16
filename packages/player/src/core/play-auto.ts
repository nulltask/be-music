import { resolveAltModifierLabel } from '../utils.ts';
import { createAutoJudgeState, isAutoJudgeSettled, runAutoJudgeStep, type AutoJudgeInput } from './auto-judge-core.ts';
import { clampToReversal } from './judge-core.ts';
import { printLaneMap, writePlayableSampleTriggerEventLog } from './engine-trace.ts';
import { createRealtimeAudioCursor } from './play-audio-cursor.ts';
import type { PlaySession } from './play-session.ts';
import type { JudgeStrategy, PlayJudge, StrategyDrifts } from './play-strategy.ts';

/**
 * The AUTO judge strategy: the auto judge core (`auto-judge-core.ts`) resolves every note as chart time reaches it,
 * and the strategy queues each note's keysound against the audio write head, ahead of its judgment.
 */

/** AUTO play's drifts from manual play (see {@link StrategyDrifts}). */
const AUTO_DRIFTS: StrategyDrifts = {
  closingFrame: true,
  queuesLaneKeysoundsAsRealtimeAudio: true,
  omitsEndOnFailure: true,
  recordsTempoInReplay: true,
  followsReplayTempoChangesAlways: true,
};

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

function createAutoJudge(session: PlaySession): PlayJudge {
  const { playbackChart, uiEnabled, writeOutput, wavResources, idBase, audioSession, totalSeconds } = session;
  const { scorableNotes } = playbackChart;
  const autoJudge = createAutoJudgeState(
    {
      ruleset: session.ruleset,
      scorableNotes,
      landmineNotes: playbackChart.landmineNotes,
      invisibleNotes: playbackChart.invisibleNotes,
      keyLabels: new Map(playbackChart.laneBindings.map((binding) => [binding.channel, binding.keyLabel])),
      // LR2 negative-BPM reversal (#134): AUTO play freezes there like manual play — no judging and no audio past it
      // (the realtime streams are cut in `collectRealtimeAudioTriggers`), and a mirrored display clock.
      reversalSeconds: session.resolvedChart.reversal?.seconds,
    },
    session.score,
  );
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

  return {
    judge: (tick) => {
      noteKeysounds.triggerUntil(tick.scheduledSec);
      step({ kind: 'advance', nowSec: tick.nowSec });
      judgedThroughSeconds = tick.nowSec;
    },
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
  drifts: AUTO_DRIFTS,
  estimatesActiveAudio: true,
  writeIntro: writeAutoIntro,
  createJudge: createAutoJudge,
};
