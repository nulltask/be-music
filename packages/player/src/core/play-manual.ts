import { formatSeconds, resolveAltModifierLabel } from '../utils.ts';
import {
  createJudgeCoreState,
  isJudgeCoreSettled,
  isJudgingClosed,
  resolveJudgeInputChannels,
  runJudgeCoreStep,
  type JudgeCoreInput,
  type JudgeCoreState,
} from './judge-core.ts';
import { resolveJudgeNowMsFromPressedAt } from './engine-clock.ts';
import { formatJudgeWindowSet, printLaneMap, writeRuntimeEventLog } from './engine-trace.ts';
import type { PlaySession } from './play-session.ts';
import type { JudgeStrategy, PlayJudge, StrategyDrifts } from './play-strategy.ts';

/**
 * The manual judge strategy: the deterministic judge core (`judge-core.ts`) fed the play clock's time once per tick and
 * every key the player presses and releases, stamped with the instant it went down (`pressedAt`).
 */

/** Manual play's drifts from the auto driver (see {@link StrategyDrifts}); the replay strategy shares them. */
export const MANUAL_DRIFTS: StrategyDrifts = {
  abortsAtClockTime: false,
  tracesEscapeAsComplete: false,
  startsChartAfterLeadInEscape: true,
  startsInputRuntimeAfterLeadIn: true,
  horizon: 'lead-in-and-reach',
  closingFrame: false,
  queuesLaneKeysoundsAsRealtimeAudio: false,
  omitsEndOnFailure: false,
  recordsTempoInReplay: false,
  followsReplayTempoChangesAlways: false,
};

/**
 * The judge core of a manual play or a replay. `judgeMsPerChartSecond` is the millisecond domain the hold-grace
 * windows run in: live play runs them on the playback clock at the tempo it started at (after a tempo change, on
 * chart time at that tempo, `TempoClock.initialTempoMsAt`, so the domain stays linear in chart time); a replay has no
 * wall clock to honour, so it runs them on chart time and its judgments do not depend on `speed`.
 */
export function createPlayJudgeCore(session: PlaySession, judgeMsPerChartSecond: number): JudgeCoreState {
  const { playbackChart, resolvedJson } = session;
  return createJudgeCoreState(
    {
      ruleset: session.ruleset,
      scorableNotes: playbackChart.scorableNotes,
      landmineNotes: playbackChart.landmineNotes,
      invisibleNotes: playbackChart.invisibleNotes,
      laneSoundNotes: playbackChart.laneSoundNotes,
      scratchChannels: new Set(
        playbackChart.laneBindings.filter((binding) => binding.isScratch).map((binding) => binding.channel),
      ),
      autoScratch: session.autoScratch,
      judgeMsPerChartSecond,
      wavResources: session.wavResources,
      idBase: session.idBase,
      sourceFormat: resolvedJson.sourceFormat,
      // LR2 negative-BPM reversal (#134): timing stays monotonic (the resolver integrates |BPM|), but from this chart
      // time on LR2's event pump freezes and presses are judged on the mirrored clock. The realtime audio streams are
      // already cut there (`collectRealtimeAudioTriggers` / `collectRealtimeAudioVolumeEvents`).
      reversalSeconds: session.resolvedChart.reversal?.seconds,
      endOnFailure: session.endOnFailure,
    },
    session.score,
  );
}

/** The parts of a {@link PlayJudge} every judge-core strategy shares. */
export function judgeCoreJudge(
  session: PlaySession,
  judgeCore: JudgeCoreState,
): Pick<PlayJudge, 'isSettled' | 'isClosed' | 'finish' | 'settledThroughSeconds'> {
  return {
    isSettled: () => isJudgeCoreSettled(judgeCore),
    isClosed: () => isJudgingClosed(judgeCore),
    finish: () =>
      runJudgeCoreStep(judgeCore, { kind: 'finish', totalSeconds: session.totalSeconds }, session.applyJudgeEffect),
    settledThroughSeconds: () => judgeCore.advancedThroughSeconds,
  };
}

/** The no-TUI introduction of a manual play (and a replay). */
export function writeManualIntro(session: PlaySession): void {
  const { writeOutput, playbackChart, ruleset } = session;
  const highSpeedModifierLabel = resolveAltModifierLabel();
  writeOutput('Manual play start\n');
  writeOutput(`Lane mode: ${playbackChart.laneDisplayMode}\n`);
  if (session.randomPatternSummary) {
    writeOutput(`${session.randomPatternSummary}\n`);
  }
  if (session.autoScratch) {
    writeOutput('Mode: AUTO SCRATCH (16ch/26ch only)\n');
  }
  writeOutput(`Judge window (${ruleset.id}): ${formatJudgeWindowSet(ruleset.windows.note)}\n`);
  writeOutput('Press Space to pause/resume.\n');
  writeOutput('Press Shift+R to restart.\n');
  writeOutput(`Press ${highSpeedModifierLabel}+odd lane key to decrease HIGH-SPEED.\n`);
  writeOutput(`Press ${highSpeedModifierLabel}+even lane key to increase HIGH-SPEED.\n`);
  writeOutput('Press Ctrl+C to quit.\n');
  writeOutput('Press Esc to stop and open result.\n');
  printLaneMap(writeOutput, playbackChart.laneBindings);
}

function createManualJudge(session: PlaySession): PlayJudge {
  const { tempoClock, uiEnabled, writeOutput, tracer, applyJudgeEffect } = session;
  const { inputTokenToChannels } = session.playbackChart;
  const judgeCore = createPlayJudgeCore(session, 1000 / tempoClock.initialTempo);
  const step = (input: JudgeCoreInput): void => {
    runJudgeCoreStep(judgeCore, input, applyJudgeEffect);
  };
  const candidateChannelsBuffer = new Set<string>();
  const mapInputChannels = (tokens: readonly string[], additionalTokens?: readonly string[]): ReadonlySet<string> =>
    resolveJudgeInputChannels(
      judgeCore.config,
      inputTokenToChannels,
      candidateChannelsBuffer,
      tokens,
      additionalTokens,
    );
  const traceInput = (seconds: number, action: string, tokens: readonly string[]): void => {
    writeRuntimeEventLog(writeOutput, 'input', [
      ['time', formatSeconds(seconds)],
      ['action', action],
      ['tokens', tokens.join(',')],
    ]);
  };

  return {
    ...judgeCoreJudge(session, judgeCore),
    judge: (tick) => {
      step({ kind: 'advance', nowSec: tick.nowSec, nowMs: tempoClock.initialTempoMsAt(tick.nowMs) });
    },
    judgedThroughSeconds: (tick) => tick.nowSec,
    handleLaneCommand: (command) => {
      const clock = session.clock;
      if (clock === undefined) {
        // Before the chart starts there is nothing to judge.
        return;
      }
      const commandSeconds = (): number => tempoClock.chartSecondsAt(clock.nowMs());
      if (command.kind === 'kitty-state') {
        if (!uiEnabled) {
          if (command.pressTokens.length > 0) traceInput(commandSeconds(), 'press', command.pressTokens);
          if (command.repeatTokens.length > 0) traceInput(commandSeconds(), 'repeat', command.repeatTokens);
          if (command.releaseTokens.length > 0) traceInput(commandSeconds(), 'release', command.releaseTokens);
        }
        step({ kind: 'hold', channels: mapInputChannels(command.pressTokens, command.repeatTokens) });
        const releasedChannels = mapInputChannels(command.releaseTokens);
        if (releasedChannels.size > 0) {
          const releaseNowMs = clock.nowMs();
          step({
            kind: 'release',
            channels: releasedChannels,
            tokens: command.releaseTokens,
            nowSec: tempoClock.chartSecondsAt(releaseNowMs),
            nowMs: tempoClock.initialTempoMsAt(releaseNowMs),
            // The play log records the release at the key event's own instant, like a press.
            recordSec: tempoClock.chartSecondsAt(resolveJudgeNowMsFromPressedAt(releaseNowMs, command.pressedAt)),
          });
        }
        return;
      }
      if (clock.isPaused()) {
        return;
      }
      // The runtime adapter (web / node) stamps the OS-level key event as `pressedAt`; moving the playback clock back by
      // the wall-clock delta judges the press at the player's true timing instead of the engine's drain time (see
      // `resolveJudgeNowMsFromPressedAt` for the bounds).
      const pressedAtMs = resolveJudgeNowMsFromPressedAt(clock.nowMs(), command.pressedAt);
      const nowSec = tempoClock.chartSecondsAt(pressedAtMs);
      if (!uiEnabled) {
        traceInput(nowSec, 'lane-input', command.tokens);
      }
      // The volume changes due by the write head apply to the keysound the press plays.
      session.volumeChanges.triggerUntil(tempoClock.chartSecondsAt(clock.scheduledMs()));
      tracer.flushUntil(nowSec);
      const candidateChannels = mapInputChannels(command.tokens);
      if (candidateChannels.size === 0) {
        return;
      }
      step({
        kind: 'press',
        channels: candidateChannels,
        tokens: command.tokens,
        nowSec,
        nowMs: tempoClock.initialTempoMsAt(pressedAtMs),
      });
    },
  };
}

/** Manual play: the player's keys, judged live. */
export const manualStrategy: JudgeStrategy = {
  mode: 'manual',
  drifts: MANUAL_DRIFTS,
  estimatesActiveAudio: false,
  writeIntro: writeManualIntro,
  createJudge: createManualJudge,
};
