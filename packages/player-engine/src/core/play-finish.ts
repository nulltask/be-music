import { formatSeconds } from '../utils.ts';
import { renderSummary, writeRuntimeEventLog } from './engine-trace.ts';
import { PlayerInterruptedError, type PlayerSummary } from './engine-types.ts';
import type { GaugeType } from '../ruleset/gauge-type.ts';
import type { PlayControls } from './play-controls.ts';
import type { PlayOutcome } from './play-loop.ts';
import type { PlaySession } from './play-session.ts';
import type { PlayJudge } from './play-strategy.ts';

/**
 * Ends a play the same way whatever judged it: an ESC returns the summary of an aborted play, a restart or Ctrl+C
 * throws {@link PlayerInterruptedError}, anything else completes (or fails). The replay is finalized and handed to
 * the host (unless the play sought), the no-TUI trace records the end, and the summary is written out.
 */
export function finishPlay(
  session: PlaySession,
  judge: PlayJudge,
  controls: PlayControls,
  outcome: PlayOutcome,
): PlayerSummary {
  const { options, summary, totalSeconds, replayRecorder, writeOutput } = session;
  const { interruptedReason, endedOnFailure } = outcome;
  // View changes the host sent as the play ended, after the loop's last drain, still belong to it.
  controls.recordPendingViewChanges();
  if (interruptedReason === 'ctrl-c' || interruptedReason === 'restart') {
    throw new PlayerInterruptedError(interruptedReason);
  }
  if (session.ruleset.comboBreaksOnEmptyPoor && summary.emptyPoor > 0) {
    summary.fullCombo = summary.total > 0 && session.score.scoreTracker.combo === summary.total;
  }
  const aborted = interruptedReason === 'escape';
  const reason = aborted ? 'escape' : endedOnFailure ? 'failed' : 'complete';
  if (!session.uiEnabled) {
    writeRuntimeEventLog(writeOutput, 'playback-end', [
      ['time', formatSeconds(totalSeconds)],
      ['reason', reason],
    ]);
    session.stateLogger.logResult(totalSeconds, { reason, summary });
  }
  // A play that sought is practice: its replay was discarded at the first seek.
  if (replayRecorder && session.seekGeneration === 0) {
    options.onReplayRecorded?.(
      replayRecorder.finalize({
        summary,
        maxCombo: session.score.scoreTracker.maxCombo,
        ...(session.secondPlayer !== undefined
          ? {
              secondPlayer: {
                summary: session.secondPlayer.summary,
                maxCombo: session.secondPlayer.score.scoreTracker.maxCombo,
                gauge: (session.secondPlayer.gauge ??
                  session.options.gauge2P ??
                  session.options.gauge ??
                  'GROOVE') as GaugeType,
              },
            }
          : {}),
        ...(aborted
          ? {
              aborted: true,
              // Where the judge had settled through, so a re-simulation stops there and a course counts the stage's
              // time up to it.
              abortedAtSeconds: judge.settledThroughSeconds(),
            }
          : {}),
      }),
    );
  }
  writeOutput(renderSummary(summary, session.ruleset.moneyScore));
  return summary;
}
