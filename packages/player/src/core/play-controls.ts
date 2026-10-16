import { formatSeconds } from '../utils.ts';
import {
  applyPlaybackHighSpeedAction,
  applyPlaybackTempoChange,
  consumePlaybackInputCommands,
  recordPendingViewChanges,
  togglePlaybackPause,
} from './playback-support.ts';
import { writeRuntimeEventLog } from './engine-trace.ts';
import type { PlayerInterruptReason } from './engine-types.ts';
import type { PlaySession } from './play-session.ts';
import type { PlayJudge } from './play-strategy.ts';

/**
 * Playback controls: the input commands every play takes the same way — pause, HIGH-SPEED, tempo changes (live, or a
 * replay following its log's), view changes for the play log and interrupts — and the lane commands it hands its judge.
 */
export interface PlayControls {
  /** Drains the input bus and applies every command on it. */
  consume(): void;
  /** Applies the replay's recorded tempo changes due by `nowSec`. */
  followReplayTempoChanges(nowSec: number): void;
  /** The chart has started: applies a pause sent during the lead-in. */
  chartStarted(): void;
  /** Records the view changes still on the input bus once the loop is over (sent as the play ended). */
  recordPendingViewChanges(): void;
  /** The interrupt the play received, if any. */
  readonly interruptedReason: PlayerInterruptReason | undefined;
}

export function createPlayControls(session: PlaySession, judge: PlayJudge): PlayControls {
  const {
    options,
    tempoClock,
    uiEnabled,
    writeOutput,
    audioSession,
    activeStateSignals,
    playlogRecorder,
    inputSignals,
    strategy: { drifts },
  } = session;
  let highSpeed = session.highSpeed;
  let interruptedReason: PlayerInterruptReason | undefined;
  // The chart second a command takes effect at: the play clock's, or the chart's start before it runs.
  const commandSeconds = (): number => (session.clock ? tempoClock.chartSecondsAt(session.clock.nowMs()) : 0);

  // A pause sent during the lead-in holds the chart at its start.
  let pauseAtStart = false;
  const togglePause = (): void => {
    if (session.clock === undefined) {
      pauseAtStart = !pauseAtStart;
      return;
    }
    togglePlaybackPause({
      playbackClock: session.clock,
      audioSession,
      activeStateSignals,
      onStateChange: !uiEnabled
        ? (state, nowMs) => {
            writeRuntimeEventLog(writeOutput, 'playback-state', [
              ['time', formatSeconds(tempoClock.chartSecondsAt(nowMs))],
              ['state', state],
            ]);
          }
        : undefined,
    });
  };

  const changeTempo = (tempo: number): void => {
    applyPlaybackTempoChange({
      tempoClock,
      // Before the chart starts (the lead-in) a change sets the tempo it starts at.
      nowMs: session.clock?.nowMs() ?? 0,
      tempo,
      setAudioTempo: (next) => audioSession?.setTempo?.(next),
      // A replay's tempo only sets how fast it is re-driven: its re-recorded log carries none.
      recordTempoChange: (seconds, next) => {
        if (!session.replay) playlogRecorder?.recordTempoChange(seconds, next);
      },
      onTempoChange: (change) => {
        if (!uiEnabled) {
          writeRuntimeEventLog(writeOutput, 'tempo-change', [
            ['time', formatSeconds(change.seconds)],
            ['value', `x${change.tempo}`],
          ]);
        }
        options.onTempoChange?.(change);
      },
    });
  };

  // A replay follows its log's tempo changes as its chart time reaches each.
  const replayTempoChanges =
    session.replay || drifts.followsReplayTempoChangesAlways ? (options.replayTempoChanges ?? []) : [];
  let replayTempoChangeIndex = 0;

  const handleLaneCommand = judge.handleLaneCommand?.bind(judge);

  return {
    consume: () => {
      consumePlaybackInputCommands({
        inputSignals,
        isInterrupted: () => interruptedReason !== undefined,
        setInterruptedReason: (reason) => {
          interruptedReason = reason;
        },
        onTogglePause: togglePause,
        onHighSpeedAction: (action) => {
          highSpeed = applyPlaybackHighSpeedAction({
            action,
            currentHighSpeed: highSpeed,
            activeStateSignals,
            onHighSpeedChange: options.onHighSpeedChange,
            logHighSpeedChange: !uiEnabled
              ? (nextHighSpeed) => {
                  writeRuntimeEventLog(writeOutput, 'high-speed-change', [
                    ['time', formatSeconds(commandSeconds())],
                    ['value', `x${nextHighSpeed.toFixed(1)}`],
                  ]);
                }
              : undefined,
          });
        },
        onViewChange: (change) => playlogRecorder?.recordViewChange(commandSeconds(), change),
        onTempoChange: changeTempo,
        // Lane and key-state commands go to the judge; a strategy without live key input drops them.
        onUnhandledCommand:
          handleLaneCommand === undefined
            ? undefined
            : (command) => {
                if (command.kind === 'lane-input' || command.kind === 'kitty-state') handleLaneCommand(command);
              },
        logInterrupt: !uiEnabled
          ? (reason) => {
              if (session.clock === undefined) return;
              writeRuntimeEventLog(writeOutput, 'interrupt', [
                ['time', formatSeconds(commandSeconds())],
                ['reason', reason],
              ]);
            }
          : undefined,
      });
    },
    followReplayTempoChanges: (nowSec) => {
      while (replayTempoChangeIndex < replayTempoChanges.length) {
        const change = replayTempoChanges[replayTempoChangeIndex]!;
        if (change.timeUs / 1_000_000 > nowSec) return;
        replayTempoChangeIndex += 1;
        changeTempo(change.tempo);
      }
    },
    chartStarted: () => {
      if (pauseAtStart) {
        pauseAtStart = false;
        togglePause();
      }
    },
    recordPendingViewChanges: () => {
      recordPendingViewChanges(inputSignals, playlogRecorder, Math.max(0, commandSeconds()));
    },
    get interruptedReason() {
      return interruptedReason;
    },
  };
}
