import { computed, effect, signal } from 'alien-signals';
import type {
  PlayerInterruptReason,
  PlayerLoadProgress,
  PlayerOptions,
  PlayerRuntimeMode,
  PlayerRuntimePhase,
  PlayerSummary,
} from './player-engine.ts';

export interface PlayerSignalsState {
  mode: PlayerRuntimeMode;
  phase: PlayerRuntimePhase;
  speed: number;
  highSpeed: number;
  currentSeconds: number;
  totalSeconds: number;
  combo: number;
  summary: PlayerSummary;
  loadProgress: PlayerLoadProgress | null;
  interruptedReason?: PlayerInterruptReason;
}

export interface PlayerStateSignals {
  state: () => PlayerSignalsState;
  phase: () => PlayerRuntimePhase;
  isPlaying: () => boolean;
  isPaused: () => boolean;
  progressRatio: () => number;
  progressPercent: () => number;
  options: PlayerOptions;
  subscribe: (listener: (state: PlayerSignalsState) => void) => () => void;
  reset: () => void;
}

function createEmptySummary(total = 0): PlayerSummary {
  return {
    total,
    perfect: 0,
    fast: 0,
    slow: 0,
    great: 0,
    good: 0,
    bad: 0,
    poor: 0,
    exScore: 0,
    score: 0,
  };
}

function cloneSummary(summary: PlayerSummary): PlayerSummary {
  return {
    total: summary.total,
    perfect: summary.perfect,
    fast: summary.fast,
    slow: summary.slow,
    great: summary.great,
    good: summary.good,
    bad: summary.bad,
    poor: summary.poor,
    exScore: summary.exScore,
    score: summary.score,
  };
}

function cloneState(state: PlayerSignalsState): PlayerSignalsState {
  return {
    ...state,
    summary: cloneSummary(state.summary),
    loadProgress: state.loadProgress ? { ...state.loadProgress } : null,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function createInitialState(options: PlayerOptions): PlayerSignalsState {
  return {
    mode: options.auto ? 'auto' : 'manual',
    phase: 'loading',
    speed: options.speed ?? 1,
    highSpeed: options.highSpeed ?? 1,
    currentSeconds: 0,
    totalSeconds: 0,
    combo: 0,
    summary: createEmptySummary(),
    loadProgress: null,
    interruptedReason: undefined,
  };
}

export function createPlayerStateSignals(baseOptions: PlayerOptions = {}): PlayerStateSignals {
  const initialState = createInitialState(baseOptions);
  const state = signal<PlayerSignalsState>(cloneState(initialState));

  const setState = (nextState: PlayerSignalsState): void => {
    state(cloneState(nextState));
  };

  const updateState = (updater: (current: PlayerSignalsState) => PlayerSignalsState): void => {
    setState(updater(state()));
  };

  const onLoadProgress = baseOptions.onLoadProgress;
  const onStateChange = baseOptions.onStateChange;
  const onHighSpeedChange = baseOptions.onHighSpeedChange;

  const options: PlayerOptions = {
    ...baseOptions,
    onLoadProgress: (progress) => {
      updateState((current) => ({
        ...current,
        loadProgress: {
          ratio: clamp01(progress.ratio),
          message: progress.message,
          detail: progress.detail,
        },
      }));
      onLoadProgress?.(progress);
    },
    onStateChange: (snapshot) => {
      updateState((current) => ({
        ...current,
        mode: snapshot.mode,
        phase: snapshot.phase,
        speed: snapshot.speed,
        highSpeed: snapshot.highSpeed,
        currentSeconds: snapshot.currentSeconds,
        totalSeconds: snapshot.totalSeconds,
        combo: snapshot.combo,
        summary: cloneSummary(snapshot.summary),
        interruptedReason: snapshot.phase === 'interrupted' ? snapshot.interruptedReason : undefined,
      }));
      onStateChange?.(snapshot);
    },
    onHighSpeedChange: (highSpeed) => {
      updateState((current) => ({
        ...current,
        highSpeed,
      }));
      onHighSpeedChange?.(highSpeed);
    },
  };

  const phase = computed(() => state().phase);
  const isPlaying = computed(() => state().phase === 'playing');
  const isPaused = computed(() => state().phase === 'paused');
  const progressRatio = computed(() => {
    const current = state();
    if (current.totalSeconds > 0) {
      return clamp01(current.currentSeconds / current.totalSeconds);
    }
    if (current.phase === 'result') {
      return 1;
    }
    return clamp01(current.loadProgress?.ratio ?? 0);
  });
  const progressPercent = computed(() => Math.round(progressRatio() * 100));

  const subscribe = (listener: (state: PlayerSignalsState) => void): (() => void) =>
    effect(() => {
      listener(cloneState(state()));
    });

  const reset = (): void => {
    setState(createInitialState(baseOptions));
  };

  return {
    state,
    phase,
    isPlaying,
    isPaused,
    progressRatio,
    progressPercent,
    options,
    subscribe,
    reset,
  };
}
