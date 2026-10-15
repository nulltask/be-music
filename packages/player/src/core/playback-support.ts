import type { PlaylogViewState } from '../playlog/view.ts';
import { mirrorBeatAtTempoReversal, type TempoReversalPoint } from '@be-music/chart';
import { type PlayerStateSignals } from '../state-signals.ts';
import { applyHighSpeedControlAction, type HighSpeedControlAction } from './high-speed-control.ts';
import { type PlayerInputCommand, type PlayerInputSignalBus } from './input-signal-bus.ts';
import { type PlayerUiFramePayload, type PlayerUiSignalBus } from './ui-signal-bus.ts';

type PauseablePlaybackClock = {
  nowMs: () => number;
  isPaused: () => boolean;
  pause: () => boolean;
  resume: () => boolean;
};

type PauseableAudioSession = {
  pause: () => void;
  resume: () => void;
};

type InterruptCommand = Extract<PlayerInputCommand, { kind: 'interrupt' }>;

export interface PlaybackStateLogger {
  logGaugeChange: (
    seconds: number,
    params: {
      reason: string;
      judge?: string;
      delta?: number;
    },
  ) => void;
  logComboChange: (
    seconds: number,
    params: {
      value: number;
      reason: string;
      judge?: string;
      channel?: string;
    },
  ) => void;
  logLongNoteState: (
    seconds: number,
    params: {
      channel: string;
      state: 'start' | 'release' | 'break' | 'complete';
      mode: 1 | 2 | 3;
      event: { value: string; channel: string };
      resources: Readonly<Record<string, string>>;
      endSeconds?: number;
    },
  ) => void;
  logResult: (seconds: number, params: { reason: string; summary: PlayerUiFramePayload['summary'] }) => void;
}

export function createNoopPlaybackStateLogger(): PlaybackStateLogger {
  return {
    logGaugeChange: () => undefined,
    logComboChange: () => undefined,
    logLongNoteState: () => undefined,
    logResult: () => undefined,
  };
}

export function createUiFramePublisher(params: {
  uiEnabled: boolean;
  uiSignals: PlayerUiSignalBus;
  totalSeconds: number;
  summary: PlayerUiFramePayload['summary'];
  notes: PlayerUiFramePayload['notes'];
  landmineNotes?: PlayerUiFramePayload['landmineNotes'];
  invisibleNotes?: PlayerUiFramePayload['invisibleNotes'];
  audioBackend: string;
  resolveDebugActiveAudioState: (
    seconds: number,
  ) => Pick<PlayerUiFramePayload, 'activeAudioFiles' | 'activeAudioVoiceCount'>;
  /**
   * LR2 negative-BPM reversal anchor. Past `seconds`, frames carry a display beat mirrored in chart-POSITION space —
   * `displayBeat = 2 * beat - currentBeat` — exactly like LR2's `songtimer = 2 * bpmChangedBmstime - songtimer`
   * (LR2body.exe 0x406d81). The forward beat keeps following the tempo map past the reversal, so the reverse scroll
   * runs at the post-reversal |BPM| and a post-reversal STOP pauses it.
   */
  reversal?: TempoReversalPoint;
}): (seconds: number, beat: number) => void {
  const {
    uiEnabled,
    uiSignals,
    totalSeconds,
    summary,
    notes,
    landmineNotes,
    invisibleNotes,
    audioBackend,
    resolveDebugActiveAudioState,
    reversal,
  } = params;
  return (seconds: number, beat: number): void => {
    if (!uiEnabled) {
      return;
    }
    const debugState = resolveDebugActiveAudioState(seconds);
    const displayBeat =
      reversal !== undefined && seconds > reversal.seconds
        ? mirrorBeatAtTempoReversal(reversal, seconds, beat)
        : undefined;
    uiSignals.publishFrame({
      currentBeat: beat,
      currentSeconds: seconds,
      displayBeat,
      reversalSeconds: reversal?.seconds,
      totalSeconds,
      summary,
      notes,
      landmineNotes,
      invisibleNotes,
      audioBackend,
      activeAudioFiles: debugState.activeAudioFiles,
      activeAudioVoiceCount: debugState.activeAudioVoiceCount,
    });
  };
}

export function togglePlaybackPause(params: {
  playbackClock?: PauseablePlaybackClock;
  audioSession?: PauseableAudioSession;
  activeStateSignals?: PlayerStateSignals;
  onStateChange?: (state: 'pause' | 'resume', nowMs: number) => void;
}): void {
  const { playbackClock, audioSession, activeStateSignals, onStateChange } = params;
  if (!playbackClock) {
    return;
  }
  if (playbackClock.isPaused()) {
    if (!playbackClock.resume()) {
      return;
    }
    audioSession?.resume();
    activeStateSignals?.setPaused(false);
    onStateChange?.('resume', playbackClock.nowMs());
    return;
  }

  if (!playbackClock.pause()) {
    return;
  }
  audioSession?.pause();
  activeStateSignals?.setPaused(true);
  onStateChange?.('pause', playbackClock.nowMs());
}

export function applyPlaybackHighSpeedAction(params: {
  action: HighSpeedControlAction | undefined;
  currentHighSpeed: number;
  activeStateSignals?: PlayerStateSignals;
  onHighSpeedChange?: (highSpeed: number) => void;
  logHighSpeedChange?: (highSpeed: number) => void;
}): number {
  const { action, currentHighSpeed, activeStateSignals, onHighSpeedChange, logHighSpeedChange } = params;
  if (!action) {
    return currentHighSpeed;
  }
  const nextHighSpeed = applyHighSpeedControlAction(currentHighSpeed, action);
  if (nextHighSpeed !== currentHighSpeed) {
    activeStateSignals?.setHighSpeed(nextHighSpeed);
    onHighSpeedChange?.(nextHighSpeed);
  }
  logHighSpeedChange?.(nextHighSpeed);
  return nextHighSpeed;
}

export function consumePlaybackInputCommands(params: {
  inputSignals: PlayerInputSignalBus;
  isInterrupted: () => boolean;
  setInterruptedReason: (reason: InterruptCommand['reason']) => void;
  onTogglePause: () => void;
  onHighSpeedAction: (action: HighSpeedControlAction | undefined) => void;
  /** A view change to record (`{ kind: 'view' }`). */
  onViewChange?: (change: PlaylogViewState) => void;
  onUnhandledCommand?: (command: PlayerInputCommand) => void;
  logInterrupt?: (reason: InterruptCommand['reason']) => void;
}): void {
  const {
    inputSignals,
    isInterrupted,
    setInterruptedReason,
    onTogglePause,
    onHighSpeedAction,
    onViewChange,
    onUnhandledCommand,
    logInterrupt,
  } = params;
  const commands = inputSignals.drainCommands();
  for (const command of commands) {
    if (isInterrupted()) {
      continue;
    }
    if (command.kind === 'interrupt') {
      logInterrupt?.(command.reason);
      setInterruptedReason(command.reason);
      continue;
    }
    if (command.kind === 'toggle-pause') {
      onTogglePause();
      continue;
    }
    if (command.kind === 'high-speed') {
      onHighSpeedAction(command.action);
      continue;
    }
    if (command.kind === 'view') {
      onViewChange?.(command.change);
      continue;
    }
    onUnhandledCommand?.(command);
  }
}
