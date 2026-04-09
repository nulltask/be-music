import { type PlayerStateSignals } from '../state-signals.ts';
import { applyHighSpeedControlAction, type HighSpeedControlAction } from './high-speed-control.ts';
import { type PlayerInputCommand, type PlayerInputSignalBus } from './input-signal-bus.ts';
import { type GrooveGaugeJudgeKind } from './groove-gauge.ts';
import { type PlayerUiFramePayload, type PlayerUiSignalBus } from './ui-signal-bus.ts';

type GaugeBearingSummary = {
  gauge?: {
    current: number;
  };
};

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

export function applyGaugeJudgeWithLogging(params: {
  summary: GaugeBearingSummary;
  applyGaugeJudge: (judge: GrooveGaugeJudgeKind) => void;
  playbackStateLogger: PlaybackStateLogger;
  seconds: number;
  judge: GrooveGaugeJudgeKind;
  reason?: string;
}): void {
  const { summary, applyGaugeJudge, playbackStateLogger, seconds, judge, reason = 'judge' } = params;
  const previousGauge = summary.gauge?.current;
  applyGaugeJudge(judge);
  const nextGauge = summary.gauge?.current;
  playbackStateLogger.logGaugeChange(seconds, {
    reason,
    judge,
    delta: previousGauge !== undefined && nextGauge !== undefined ? nextGauge - previousGauge : undefined,
  });
}

export function applyGaugeDeltaWithLogging(params: {
  summary: GaugeBearingSummary;
  applyGaugeDelta: (delta: number) => void;
  playbackStateLogger: PlaybackStateLogger;
  seconds: number;
  delta: number;
  reason: string;
}): void {
  const { summary, applyGaugeDelta, playbackStateLogger, seconds, delta, reason } = params;
  const previousGauge = summary.gauge?.current;
  applyGaugeDelta(delta);
  const nextGauge = summary.gauge?.current;
  if (previousGauge === nextGauge) {
    return;
  }
  playbackStateLogger.logGaugeChange(seconds, {
    reason,
    delta: previousGauge !== undefined && nextGauge !== undefined ? nextGauge - previousGauge : undefined,
  });
}

export function setLoggedComboValue(
  playbackStateLogger: PlaybackStateLogger,
  seconds: number,
  value: number,
  reason: string,
  judge?: string,
  channel?: string,
): number {
  playbackStateLogger.logComboChange(seconds, {
    value,
    reason,
    judge,
    channel,
  });
  return value;
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
  } = params;
  return (seconds: number, beat: number): void => {
    if (!uiEnabled) {
      return;
    }
    const debugState = resolveDebugActiveAudioState(seconds);
    uiSignals.publishFrame({
      currentBeat: beat,
      currentSeconds: seconds,
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
  onUnhandledCommand?: (command: PlayerInputCommand) => void;
  logInterrupt?: (reason: InterruptCommand['reason']) => void;
}): void {
  const {
    inputSignals,
    isInterrupted,
    setInterruptedReason,
    onTogglePause,
    onHighSpeedAction,
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
    onUnhandledCommand?.(command);
  }
}
