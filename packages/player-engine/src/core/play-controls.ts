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
 * replay following its log's), view changes for the replay, seeks and interrupts — and the lane commands it hands its
 * judge.
 */
export interface PlayControls {
  /** Drains the input bus and applies every command on it. */
  consume(): void;
  /** The host opened the chart-start gate, or no command gate was configured. */
  readonly startRequested: boolean;
  /**
   * The seek to apply on this tick, if one is waiting: the last `seek` command drained so far (seeks coalesce, the last
   * one wins), or the play's start (`PlayerOptions.startAtSeconds`) until the chart starts. Taking it clears it.
   */
  takeSeek(): number | undefined;
  /** Applies the replay's recorded tempo changes due by `nowSec`. */
  followReplayTempoChanges(nowSec: number): void;
  /** Restores the replay tempo and cursor at a seek, including while paused. */
  seekReplayTempoChanges(seconds: number, nowMs: number): void;
  /** Interrupts the play at chart second `seconds` (a replay reaching the instant its log was aborted at). */
  interrupt(reason: PlayerInterruptReason, seconds: number): void;
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
    replayRecorder,
    inputSignals,
  } = session;
  let highSpeed = session.highSpeed;
  let startRequested = options.waitForStart !== true;
  let interruptedReason: PlayerInterruptReason | undefined;
  // The chart second a command takes effect at: the play clock's, or the chart's start before it runs.
  const commandSeconds = (): number => (session.clock ? tempoClock.chartSecondsAt(session.clock.nowMs()) : 0);

  // A pause sent during the lead-in holds the chart at its start.
  let pauseAtStart = false;
  // The seek waiting for the next tick: the play's start first, when its judge can start partway.
  let pendingSeek: number | undefined =
    judge.seek !== undefined && session.startAtSeconds > 0 ? session.startAtSeconds : undefined;
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
        if (!session.replay) replayRecorder?.recordTempoChange(seconds, next);
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

  // A replay follows its log's tempo changes as its chart time reaches each; a live play takes its tempo from commands.
  const replayTempoChanges = session.replay ? (options.replayTempoChanges ?? []) : [];
  let replayTempoChangeIndex = 0;

  const handleLaneCommand = judge.handleLaneCommand?.bind(judge);
  const traceInterrupt = (reason: PlayerInterruptReason, seconds: number): void => {
    if (uiEnabled || session.clock === undefined) return;
    writeRuntimeEventLog(writeOutput, 'interrupt', [
      ['time', formatSeconds(seconds)],
      ['reason', reason],
    ]);
  };

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
        onOptionChange: (values) => {
          if (typeof values.judgeTimingMs === 'number' && Number.isSafeInteger(values.judgeTimingMs))
            options.judgeTimingMs = values.judgeTimingMs;
          replayRecorder?.recordOptionChange(commandSeconds(), values);
        },
        onViewChange: (change) => replayRecorder?.recordViewChange(commandSeconds(), change),
        onTempoChange: changeTempo,
        onSeek: (seconds) => {
          if (judge.seek !== undefined) pendingSeek = seconds;
        },
        // Lane and key-state commands go to the judge; a strategy without live key input drops them.
        onUnhandledCommand: (command) => {
          if (command.kind === 'start') startRequested = true;
          else if (command.kind === 'lane-input' || command.kind === 'kitty-state') handleLaneCommand?.(command);
        },
        logInterrupt: (reason) => traceInterrupt(reason, commandSeconds()),
      });
    },
    takeSeek: () => {
      const seconds = pendingSeek;
      pendingSeek = undefined;
      return seconds;
    },
    interrupt: (reason, seconds) => {
      if (interruptedReason !== undefined) return;
      traceInterrupt(reason, seconds);
      interruptedReason = reason;
    },
    followReplayTempoChanges: (nowSec) => {
      while (replayTempoChangeIndex < replayTempoChanges.length) {
        const change = replayTempoChanges[replayTempoChangeIndex]!;
        if (change.timeUs / 1_000_000 > nowSec) return;
        replayTempoChangeIndex += 1;
        changeTempo(change.tempo);
      }
    },
    seekReplayTempoChanges: (seconds, nowMs) => {
      if (!session.replay) return;
      replayTempoChangeIndex = 0;
      let tempo = tempoClock.initialTempo;
      while (replayTempoChangeIndex < replayTempoChanges.length) {
        const change = replayTempoChanges[replayTempoChangeIndex]!;
        if (change.timeUs / 1_000_000 > seconds) break;
        if (Number.isFinite(change.tempo) && change.tempo > 0) tempo = change.tempo;
        replayTempoChangeIndex += 1;
      }
      tempoClock.rebase(nowMs, seconds);
      changeTempo(tempo);
    },
    chartStarted: () => {
      if (pauseAtStart) {
        pauseAtStart = false;
        togglePause();
      }
    },
    recordPendingViewChanges: () => {
      recordPendingViewChanges(inputSignals, replayRecorder, Math.max(0, commandSeconds()));
    },
    get startRequested() {
      return startRequested;
    },
    get interruptedReason() {
      return interruptedReason;
    },
  };
}
