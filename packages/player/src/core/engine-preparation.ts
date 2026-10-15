import {
  drawRandomOutcomes,
  firesBeforeTempoReversal,
  hasControlFlow,
  type RandomDraws,
  type ResolvedChart,
} from '@be-music/chart';
import { type BeMusicEvent, type BeMusicJson, cloneJson } from '@be-music/json';
import { resolveBmsControlFlowWithDraws } from '@be-music/parser';
import { type PlayerStateSignals } from '../state-signals.ts';
import { type LaneBinding } from './lane-layout.ts';
import { type PlayerUiSignalBus } from './ui-signal-bus.ts';
import { type RulesetConfig } from '../ruleset/index.ts';
import { initializePlayerUiRuntime } from './bootstrap.ts';
import { createAudioSessionIfEnabled } from './engine-audio.ts';
import { resolveChartRulesetFacts, resolveEngineChart, resolvePlayChart } from './play-chart.ts';
import { delay } from './engine-clock.ts';
import {
  type AudioSession,
  type AudioSessionLoadProgress,
  type CreatePlayerUiRuntimeContext,
  type PlayerLoadComponentStatus,
  type PlayerLoadProgress,
  type PlayerOptions,
  type RandomPatternSelection,
} from './engine-types.ts';

// The chart-side steps of a play are runtime-neutral and live in `play-chart.ts`; the engine re-exports them.
export { resolveChartRulesetFacts, resolveEngineChart, resolvePlayChart };

/**
 * Play preparation: chart resolution for play, load progress, and the UI / audio runtime start-up.
 */
export function reportResolvedRuleset(options: PlayerOptions, ruleset: RulesetConfig): void {
  options.onRulesetResolved?.({
    id: ruleset.id,
    rulesetId: ruleset.rulesetId,
    longNoteStyle: ruleset.longNoteStyle,
    windows: ruleset.windows,
  });
}

interface ControlFlowResolutionResult {
  resolvedJson: BeMusicJson;
  randomPatterns: RandomPatternSelection[];
}

export function reportLoadProgress(
  options: PlayerOptions,
  ratio: number,
  message: string,
  detail?: string,
  componentStatuses?: Partial<Pick<PlayerLoadProgress, 'audioStatus' | 'graphicsStatus'>>,
): void {
  const listener = options.onLoadProgress;
  if (!listener) {
    return;
  }
  const normalizedRatio = Math.max(0, Math.min(1, ratio));
  listener({
    ratio: normalizedRatio,
    message,
    detail,
    ...componentStatuses,
  });
}

function createTrackedPromise<T>(task: Promise<T>): TrackedPromise<T> {
  let state: TrackedPromiseState<T> = { status: 'pending' };
  const promise = task.then(
    (value) => {
      state = { status: 'fulfilled', value };
      return value;
    },
    (reason) => {
      state = { status: 'rejected', reason };
      throw reason;
    },
  );
  return {
    promise,
    getState: () => state,
  };
}

function createPlaybackPreparationProgressReporter(options: PlayerOptions): PlaybackPreparationProgressReporter {
  let uiRatio = 0;
  let audioRatio = 0;
  let audioStatus: PlayerLoadComponentStatus = createPendingLoadComponentStatus('Waiting for audio setup...');
  let graphicsStatus: PlayerLoadComponentStatus = createPendingLoadComponentStatus('Waiting for graphics setup...');

  const emit = (message: string, detail?: string): void => {
    reportLoadProgress(
      options,
      PLAYBACK_PREPARATION_BASE_RATIO +
        uiRatio * PLAYBACK_PREPARATION_UI_RATIO_WEIGHT +
        audioRatio * PLAYBACK_PREPARATION_AUDIO_RATIO_WEIGHT,
      message,
      detail,
      {
        audioStatus,
        graphicsStatus,
      },
    );
  };

  return {
    reportUiProgress: (ratio, message, detail) => {
      uiRatio = Math.max(0, Math.min(1, ratio));
      graphicsStatus = createPendingLoadComponentStatus(message, detail);
      emit(message, detail);
    },
    reportAudioProgress: (progress) => {
      audioRatio = Math.max(0, Math.min(1, progress.ratio));
      audioStatus = resolveAudioLoadComponentStatus(progress);
      emit(progress.message, progress.detail);
    },
    markUiReady: (enabled) => {
      graphicsStatus = enabled
        ? createReadyLoadComponentStatus('Ready')
        : createDisabledLoadComponentStatus('Disabled');
    },
    markAudioReady: (audioSession, audioRequested) => {
      if (audioRequested === false) {
        audioStatus = createDisabledLoadComponentStatus('Disabled');
        return;
      }
      audioStatus = audioSession
        ? createReadyLoadComponentStatus('Ready')
        : createDisabledLoadComponentStatus('Unavailable');
    },
  };
}

function createPendingLoadComponentStatus(message: string, detail?: string): PlayerLoadComponentStatus {
  return {
    state: 'pending',
    message,
    detail,
  };
}

function createReadyLoadComponentStatus(message: string): PlayerLoadComponentStatus {
  return {
    state: 'ready',
    message,
  };
}

function createDisabledLoadComponentStatus(message: string): PlayerLoadComponentStatus {
  return {
    state: 'disabled',
    message,
  };
}

function resolveAudioLoadComponentStatus(progress: AudioSessionLoadProgress): PlayerLoadComponentStatus {
  if (progress.message === 'Audio ready.') {
    return createReadyLoadComponentStatus('Ready');
  }
  if (progress.message === 'Audio disabled; skipping audio setup.') {
    return createDisabledLoadComponentStatus('Disabled');
  }
  if (progress.message === 'node-web-audio-api is unavailable; continuing without audio.') {
    return createDisabledLoadComponentStatus('Unavailable');
  }
  return createPendingLoadComponentStatus(progress.message, progress.detail);
}

interface PlaybackPreparationProgressReporter {
  reportUiProgress: (ratio: number, message: string, detail?: string) => void;
  reportAudioProgress: (progress: AudioSessionLoadProgress) => void;
  markUiReady: (enabled: boolean) => void;
  markAudioReady: (audioSession: AudioSession | undefined, audioRequested: boolean | undefined) => void;
}

type TrackedPromiseState<T> =
  | { status: 'pending' }
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown };

interface TrackedPromise<T> {
  promise: Promise<T>;
  getState: () => TrackedPromiseState<T>;
}

const PLAYBACK_PREPARATION_BASE_RATIO = 0.18;

const PLAYBACK_PREPARATION_UI_RATIO_WEIGHT = 0.12;

const PLAYBACK_PREPARATION_AUDIO_RATIO_WEIGHT = 0.68;

const PREPARED_UI_RUNTIME_SETTLE_TIMEOUT_MS = 300;

async function disposePreparedUiRuntime(
  initializedUiRuntime: Awaited<ReturnType<typeof initializePlayerUiRuntime>>,
): Promise<void> {
  await settleMaybeAsyncWithTimeout(initializedUiRuntime.uiRuntime?.stop(), PREPARED_UI_RUNTIME_SETTLE_TIMEOUT_MS);
  await settleMaybeAsyncWithTimeout(initializedUiRuntime.uiRuntime?.dispose(), PREPARED_UI_RUNTIME_SETTLE_TIMEOUT_MS);
}

async function cleanupFailedPlaybackPreparation(
  uiInitialization: TrackedPromise<Awaited<ReturnType<typeof initializePlayerUiRuntime>>>,
  audioInitialization: TrackedPromise<AudioSession | undefined>,
): Promise<void> {
  const uiState = uiInitialization.getState();
  if (uiState.status === 'fulfilled') {
    await disposePreparedUiRuntime(uiState.value);
  } else if (uiState.status === 'pending') {
    void uiInitialization.promise.then(disposePreparedUiRuntime).catch(() => undefined);
  }

  const audioState = audioInitialization.getState();
  if (audioState.status === 'fulfilled') {
    await disposeAudioSessionSafely(audioState.value);
  } else if (audioState.status === 'pending') {
    void audioInitialization.promise
      .then((audioSession) => disposeAudioSessionSafely(audioSession))
      .catch(() => undefined);
  }
}

export async function initializePlaybackRuntimeResources(params: {
  resolvedJson: BeMusicJson;
  resolvedChart: ResolvedChart;
  options: PlayerOptions;
  mode: CreatePlayerUiRuntimeContext['mode'];
  laneDisplayMode: string;
  laneBindings: LaneBinding[];
  speed: number;
  judgeWindowMs: number;
  highSpeed: number;
  randomPatternSummary: string | undefined;
  stateSignals: PlayerStateSignals;
  uiSignals: PlayerUiSignalBus;
  totalSeconds: number;
  audioMode: 'auto' | 'manual';
}): Promise<
  Awaited<ReturnType<typeof initializePlayerUiRuntime>> & {
    audioSession: AudioSession | undefined;
  }
> {
  const progressReporter = createPlaybackPreparationProgressReporter(params.options);
  const uiInitialization = createTrackedPromise(
    initializePlayerUiRuntime({
      options: params.options,
      resolvedJson: params.resolvedJson,
      mode: params.mode,
      laneDisplayMode: params.laneDisplayMode,
      laneBindings: params.laneBindings,
      speed: params.speed,
      judgeWindowMs: params.judgeWindowMs,
      highSpeed: params.highSpeed,
      randomPatternSummary: params.randomPatternSummary,
      stateSignals: params.stateSignals,
      uiSignals: params.uiSignals,
      totalSeconds: params.totalSeconds,
      onLoadProgress: progressReporter.reportUiProgress,
    }).then((initializedUiRuntime) => {
      progressReporter.markUiReady(initializedUiRuntime.uiEnabled);
      return initializedUiRuntime;
    }),
  );
  const audioInitialization = createTrackedPromise(
    createAudioSessionIfEnabled(
      params.resolvedChart,
      params.options,
      params.audioMode,
      progressReporter.reportAudioProgress,
    ).then((audioSession) => {
      progressReporter.markAudioReady(audioSession, params.options.audio);
      return audioSession;
    }),
  );

  try {
    const [uiInitResult, audioSession] = await Promise.all([uiInitialization.promise, audioInitialization.promise]);
    return {
      ...uiInitResult,
      audioSession,
    };
  } catch (error) {
    await cleanupFailedPlaybackPreparation(uiInitialization, audioInitialization);
    throw error;
  }
}

/**
 * Draws `json`'s `#RANDOM` / `#SWITCH` outcomes with `randomSource` and resolves the chart with them, reporting the
 * `#RANDOM` / `#SETRANDOM` patterns for the summary. Shorthand for `drawRandomOutcomes` + `resolveBmsControlFlowWithDraws`.
 */
export function resolveBmsControlFlowForPlayback(
  json: BeMusicJson,
  randomSource: () => number = Math.random,
): ControlFlowResolutionResult {
  return resolvePlaybackControlFlow(json, drawRandomOutcomes(json, randomSource));
}

/**
 * The engine's single control-flow step: a chart that still carries control flow is resolved exactly once with
 * `draws`; a resolved chart (no control flow) is played as is. `draws` also feed the RANDOM summary.
 */
function resolvePlaybackControlFlow(json: BeMusicJson, draws: RandomDraws): ControlFlowResolutionResult {
  return {
    resolvedJson: hasControlFlow(json) ? resolveBmsControlFlowWithDraws(json, draws) : cloneJson(json),
    randomPatterns: randomPatternsFromDraws(draws),
  };
}

export function resolvePlayerChart(json: BeMusicJson, options: PlayerOptions): ControlFlowResolutionResult {
  if (options.randomDraws === undefined && hasControlFlow(json)) {
    // The engine never draws: rolling here would give the play branches nobody outside the engine knows about (the
    // host's scene, result screen and play log would show another roll, or stack a second branch on top).
    throw new TypeError(
      'The chart still carries #RANDOM / #SWITCH control flow. Resolve it once with resolvePlayChart (or ' +
        'drawRandomOutcomes + resolveBmsControlFlowWithDraws) and pass the draws as PlayerOptions.randomDraws.',
    );
  }
  return resolvePlaybackControlFlow(json, options.randomDraws ?? []);
}

function randomPatternsFromDraws(draws: RandomDraws): RandomPatternSelection[] {
  const patterns: RandomPatternSelection[] = [];
  for (const draw of draws) {
    if (draw.command === 'RANDOM') {
      patterns.push({ index: patterns.length + 1, current: draw.value, total: draw.range });
    } else if (draw.command === 'SETRANDOM') {
      patterns.push({ index: patterns.length + 1, current: draw.value, total: draw.value });
    }
  }
  return patterns;
}

export function formatRandomPatternSummary(randomPatterns: ReadonlyArray<RandomPatternSelection>): string | undefined {
  const count = randomPatterns.length;
  if (count === 0) {
    return undefined;
  }
  if (count === 1) {
    const only = randomPatterns[0];
    return `RANDOM ${only.current}/${only.total}`;
  }

  let summary = 'RANDOM ';
  for (let index = 0; index < count; index += 1) {
    const pattern = randomPatterns[index]!;
    if (index > 0) {
      summary += '  ';
    }
    summary += `#${pattern.index} ${pattern.current}/${pattern.total}`;
  }
  return summary;
}

interface TimedAudioVolumeEvent {
  event: BeMusicEvent;
  seconds: number;
}

/**
 * The chart's dynamic volume changes as realtime audio events (times clamped to the chart start). Changes behind an
 * LR2 negative-BPM reversal never fire: the event pump froze there (#134).
 */
export function collectRealtimeAudioVolumeEvents(resolved: ResolvedChart): TimedAudioVolumeEvent[] {
  const { reversal } = resolved;
  return resolved.volumeChanges
    .filter((change) => firesBeforeTempoReversal(reversal, change.seconds, change.event.channel))
    .map((change) => ({ event: change.event, seconds: Math.max(0, change.seconds) }));
}

export function resolveAudioBackendLabel(options: PlayerOptions, audioSession: AudioSession | undefined): string {
  if (options.audio === false) {
    return 'off';
  }
  return audioSession?.backendLabel ?? 'none';
}

export async function finalizeAudioSessionSafely(audioSession: AudioSession | undefined): Promise<void> {
  if (!audioSession) {
    return;
  }
  await audioSession.finish().catch(() => undefined);
  await settleWithTimeout(audioSession.dispose(), 600);
}

export async function disposeAudioSessionSafely(audioSession: AudioSession | undefined): Promise<void> {
  if (!audioSession) {
    return;
  }
  await settleWithTimeout(audioSession.dispose(), 600);
}

async function settleWithTimeout(task: Promise<void>, timeoutMs: number): Promise<boolean> {
  let completed = false;
  const guardedTask = task
    .catch(() => undefined)
    .then(() => {
      completed = true;
    });
  await Promise.race([guardedTask, delay(timeoutMs)]);
  return completed;
}

export async function settleMaybeAsyncWithTimeout(
  task: void | Promise<void> | undefined,
  timeoutMs: number,
): Promise<boolean> {
  if (!task) {
    return true;
  }
  return settleWithTimeout(Promise.resolve(task), timeoutMs);
}
