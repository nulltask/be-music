import type { BeMusicEvent, BeMusicJSON } from '@be-music/json';
import type { WebAudioStageMixer } from './nonstop-audio.ts';
import type { PlayerInputSignalBus } from '@be-music/player/signals';
import {
  autoPlay as engineAutoPlay,
  manualPlay as engineManualPlay,
  type AudioSession,
  type CreateAudioSessionContext,
  type PlayerOptions,
  type PlayerSummary,
} from '@be-music/player';
import { logger } from '../logger.ts';
import { type AudioBusHandle } from './audio-bus.ts';
import { createWebAudioSession, type WebAudioSessionSlicePlayback } from './web-audio-session.ts';
import { createWebInputRuntimeFactory } from './web-input-runtime.ts';
import { createWebUIRuntimeFactory, type WebUIRuntimeCallbacks } from './web-ui-runtime.ts';

const log = logger('engine-driver');

/**
 * Shape the engine driver expects from the host's preloaded sample cache. Decoupled from `BeMusicJSON` so the host
 * can decode `#WAVxx` slots once during the prepare phase and reuse the same `AudioBuffer` set across pause /
 * resume / restart cycles without re-decoding.
 */
export interface EngineDriverAudioContext {
  audioContext: AudioContext;
  audioBus: AudioBusHandle;
  decodedSamples: ReadonlyMap<string, AudioBuffer>;
  wavCmdVolumeMultipliers: ReadonlyMap<string, number>;
  bmsonSlicePlayback?: ReadonlyMap<BeMusicEvent, WebAudioSessionSlicePlayback>;
  /** A stitched NONSTOP chart's per-stage rates and fades (`createNonstopStageMixer`). */
  stageMixer?: WebAudioStageMixer;
  /** Every sample's playback rate (`WebAudioSessionContext.playbackRate`): the play tempo when its pitch moves. */
  playbackRate?: number;
  /** {@link playbackRate} is the play tempo and follows a live tempo change (`pitch` mode). */
  playbackRateFollowsTempo?: boolean;
}

/**
 * Tunables surfaced to the host. Mirrors the `PlayerOptions` fields the web view actually sets — full passthrough
 * lets advanced callers reach the rest of the engine surface (limiter / compressor / lead-in / etc.) without
 * widening this driver's API every time the engine adds an option.
 */
export interface EngineDriverOptions {
  /** Reference chart already resolved via `parseChart` / `parseChartFile`. */
  chart: BeMusicJSON;
  /** Audio backend resources prepared by the host. The driver constructs a {@link createWebAudioSession} on top. */
  audio: EngineDriverAudioContext;
  /** Engine play mode. Mirrors the play session's `autoPlay` option. */
  mode: 'manual' | 'auto';
  /** Pixi-side rendering callbacks. The driver subscribes them to the engine's `uiSignals`. */
  ui: WebUIRuntimeCallbacks;
  /**
   * DOM key event source (defaults to `window`). Scoped targets work too — pass a focusable canvas to keep stray
   * keystrokes outside the player from reaching the engine.
   */
  inputTarget?: EventTarget;
  /** Optional hook for the input runtime — see {@link createWebInputRuntime}. */
  shouldSkipKey?: (event: KeyboardEvent) => boolean;
  /**
   * Fires synchronously when the engine constructs its input runtime, handing back the engine-side
   * `inputSignals` bus. Hosts that keep their own keyboard listener for select keys (Space → toggle-pause, ESC
   * fade, etc.) push commands through this reference to drive the engine alongside their own view-side state.
   */
  onInputSignalsReady?: (signals: { inputSignals: PlayerInputSignalBus }) => void;
  /** Forwarded to the engine. The driver supplies sensible defaults but a host can override any field. */
  engineOptions?: Omit<PlayerOptions, 'createAudioSession' | 'createInputRuntime' | 'createUIRuntime' | 'auto'>;
}

/**
 * Result returned to the host when the engine's playback loop finishes. Mirrors what `manualPlay` / `autoPlay`
 * return so the host can route it straight into the result scene.
 */
export type EngineDriverResult = PlayerSummary;

/**
 * Glue layer that wires the three runtime adapters ({@link createWebAudioSession},
 * {@link createWebInputRuntimeFactory}, {@link createWebUIRuntimeFactory}) together and invokes the shared engine's
 * `manualPlay` / `autoPlay`. Hosts call this once per chart play; the returned promise resolves with the final
 * `PlayerSummary` when the chart ends (or rejects with `PlayerInterruptedError` when the player aborts).
 *
 * The driver is intentionally stateless — every per-chart cache (decoded samples, WAVCMD multipliers, BGA video
 * handles) lives on the host side. That matches how the play session's `load` chain (`session/play/*`) already builds
 * those caches, so adopting the driver in Phase 4b is a drop-in replacement for the gameplay view's self-judge
 * loop rather than a state-ownership refactor.
 *
 * Engine behavior shared by both runtimes (TUI + Web):
 * - Manual keysounds are emitted for the candidate note, or for the latest same-lane visible/invisible fallback whose
 *   early BAD window has already opened.
 * - Out-of-window presses do not play the next pending lane keysound before that note's judgment window opens.
 * - Free-Zone (`17` / `27`) channels stay excluded from score/gauge targets and keep their scratch aliases.
 * - Key releases inferred for input that reports none (`play-key-inference.ts`): 380 ms after a long note's head,
 *   120 ms after any other press or key repeat.
 * - LN early-release audio cut via `AudioSession.stopChannel`.
 * - Mine vs note delta-based priority (closest delta wins).
 * - Multi-channel input mapping for scratch / Free-Zone aliases.
 *
 * Test-coverage trail for the dynamic-judge / sample-routing features the migration depends on:
 * - **EXRANK dynamic judge windows** — engine end-to-end at
 *   `packages/player/src/player-long-notes-and-windows.test.ts:'player: updates manual judge windows from dynamic
 *   EXRANK events'`. Frame summary propagation through `createWebUIRuntime` is covered by
 *   `packages/player-web/src/runtime/web-ui-runtime.test.ts:'drainWebUISignals routes the current frame snapshot ...'`.
 * - **#WAVCMD per-slot gain** — covered by
 *   `packages/player-web/src/runtime/web-audio-session.test.ts:'applies #WAVCMD per-slot gain via an intermediate
 *   GainNode'`, which verifies the BufferSource → GainNode → mixer routing instead of BufferSource → mixer.
 * - **bmson c=true continuation** — covered by
 *   `packages/player-web/src/runtime/web-audio-session.test.ts:'honours bmson c=true continuation by suppressing
 *   retriggers of an in-flight slot'`. The engine's lane fallback path still flows through
 *   `WebAudioSession.triggerEvent` (which checks `activeBySlot`).
 * - **#STP measure stops** — handled at the timing-resolver / timeline level inside `@be-music/chart`; the
 *   engine consumes chart-time seconds that already account for stops, so it doesn't have a separate code
 *   path. Covered by `packages/chart/src/timelines.test.ts:'SCROLL/BPM/STOP: keeps zero and negative scroll with
 *   LR2-style stop compensation'`.
 */
export async function runEngineDriver(options: EngineDriverOptions): Promise<EngineDriverResult> {
  const { chart, audio, mode, ui, inputTarget, shouldSkipKey, onInputSignalsReady, engineOptions } = options;
  const createAudioSession = async (context: CreateAudioSessionContext): Promise<AudioSession> => {
    log.debug('audio session factory invoked', { mode: context.mode });
    return createWebAudioSession({
      audioContext: audio.audioContext,
      audioBus: audio.audioBus,
      chart: context.json,
      decodedSamples: audio.decodedSamples,
      wavCmdVolumeMultipliers: audio.wavCmdVolumeMultipliers,
      bmsonSlicePlayback: audio.bmsonSlicePlayback,
      ...(audio.stageMixer !== undefined ? { stageMixer: audio.stageMixer } : {}),
      ...(audio.playbackRate !== undefined ? { playbackRate: audio.playbackRate } : {}),
      ...(audio.playbackRateFollowsTempo === true ? { playbackRateFollowsTempo: true } : {}),
    });
  };
  const createInputRuntime = createWebInputRuntimeFactory({
    target: inputTarget,
    shouldSkipKey,
    onReady: onInputSignalsReady,
  });
  const createUIRuntime = createWebUIRuntimeFactory(ui);
  const compositeOptions: PlayerOptions = {
    ...engineOptions,
    auto: mode === 'auto',
    tui: false,
    createAudioSession,
    createInputRuntime,
    createUIRuntime,
  };
  log.info('engine driver starting', { mode, hasInputTarget: inputTarget !== undefined });
  const summary =
    mode === 'auto' ? await engineAutoPlay(chart, compositeOptions) : await engineManualPlay(chart, compositeOptions);
  log.info('engine driver finished', {
    score: summary.score,
    exScore: summary.exScore,
    perfect: summary.perfect,
    great: summary.great,
    good: summary.good,
    bad: summary.bad,
    poor: summary.poor,
  });
  return summary;
}
