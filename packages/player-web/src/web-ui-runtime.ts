import type { CreatePlayerUiRuntimeContext, PlayerUiRuntime } from '@be-music/player/core/engine';
import type { PlayerJudgeComboSignalState, PlayerStateSignals } from '@be-music/player/state-signals';
import type { PlayerUiCommand, PlayerUiFramePayload, PlayerUiSignalBus } from '@be-music/player/core/ui-signal-bus';
import { logger } from './logger.ts';

const log = logger('web-ui-runtime');

/**
 * Surface the {@link createWebUiRuntime} adapter exposes to the host gameplay view. The host wires these callbacks
 * to its Pixi rendering pipeline; the engine's UI signal bus is the *only* state source the runtime consults, so
 * the host stays purely declarative.
 *
 * Both callbacks are optional — a host that doesn't need a particular hook can omit it. The runtime swallows
 * exceptions thrown from the callbacks so a Pixi-side bug doesn't break the engine's main loop.
 */
export interface WebUiRuntimeCallbacks {
  /**
   * Fired on every `uiSignals.publishFrame()` (typically once per engine tick). Receives the current frame snapshot
   * — `currentBeat` / `currentSeconds` / `summary` / `notes` etc. The host should re-render the score panel, lane
   *  bars, and any other state-driven chrome from this single source.
   */
  onFrame?: (frame: Readonly<PlayerUiFramePayload>) => void;
  /**
   * Fired for every `uiSignals.pushCommand()` event. Currently the engine emits:
   * - `flash-lane` — judged note's lane should pulse (manual judge / auto judge).
   * - `hold-lane-until-beat` — LN start: keep the lane laser lit until the chart reaches `beat`.
   * - `press-lane` / `release-lane` — manual key press / release on this lane.
   * - `trigger-poor-bga` — POOR BGA window started (the host typically draws `#xxx06` until `clear-poor-bga`).
   * - `clear-poor-bga` — POOR BGA window ended (next note hit, or the timeout elapsed).
   *
   * The host should switch on `command.kind` and apply the matching visual effect.
   */
  onCommand?: (command: PlayerUiCommand) => void;
  /**
   * Fired once when the engine calls `start()` (after the BGA preload promise resolved). Useful for the host to
   * reveal its scene graph at the same moment chart playback begins.
   */
  onStart?: () => void;
  /**
   * Fired when the engine calls `stop()` (graceful end-of-chart, ESC abort, restart). The host typically tears down
   * any per-chart subscriptions here; full disposal happens in `dispose`.
   */
  onStop?: () => void;
  /**
   * Final teardown. The runtime invokes the host's onDispose AFTER detaching its own listeners, so the host can
   * destroy Pixi resources knowing no further frame callbacks will arrive.
   */
  onDispose?: () => void;
  /**
   * Fired when `triggerPoor(seconds)` is called by the engine (e.g. at chart end, when a no-judge POOR fires from
   * outside the regular judge path). Most hosts can route this to the same handler as the `trigger-poor-bga`
   * command since they ultimately mean the same UI event.
   */
  onPoorTriggered?: (seconds: number) => void;
  /** Fired when `clearPoor()` is called. Mirror of {@link onPoorTriggered}. */
  onPoorCleared?: () => void;
  /**
   * Fired whenever the engine publishes a fresh judge / combo state through {@link PlayerStateSignals}. The state
   * carries the judge kind (`'PERFECT'` / `'GREAT'` / ... — see `PlayerJudgeComboSignalState`), the running combo,
   * and the lane channel that produced the verdict. Hosts use this to drive the LR2 NOWJUDGE plate timer and the
   * combo readout on the play skin.
   */
  onJudgeCombo?: (state: Readonly<PlayerJudgeComboSignalState>) => void;
  /**
   * Fired once when the runtime is constructed, handing the engine's signal buses back to the host. Hosts that
   * already drive their own per-frame loop (rAF in the gameplay view) can use this to call
   * {@link drainWebUiSignals} from inside that loop, sharing one event-drain pass with their other Pixi work
   * instead of spinning up an independent alien-signals subscription. The runtime still fires `onFrame` /
   * `onCommand` / `onJudgeCombo` if the host doesn't poll — the two modes are interchangeable; pick whichever
   * matches the host's render scheduling.
   */
  onSignalsReady?: (signals: { uiSignals: PlayerUiSignalBus; stateSignals?: PlayerStateSignals }) => void;
}

/**
 * Construction-time inputs for {@link createWebUiRuntime}. The host supplies the engine's signal buses alongside
 * its callbacks; the runtime sets up the subscription lifecycle.
 */
export interface WebUiRuntimeOptions extends WebUiRuntimeCallbacks {
  uiSignals: PlayerUiSignalBus;
  /**
   * Optional `PlayerStateSignals` bus. The engine emits judge / combo / pause / hi-speed updates through this
   * channel separately from `uiSignals`; the runtime drains it inside {@link drainWebUiSignals} so a single
   * per-frame poll catches both surfaces.
   */
  stateSignals?: PlayerStateSignals;
  /** Total seconds of playback the engine reports — surfaced through `playbackEndSeconds`. */
  playbackEndSeconds?: number;
}

/**
 * Web-side adapter for the engine's `PlayerUiRuntime` contract. Subscribes to `uiSignals`'s frameTick / commandTick
 * during `start()`, drains the queues into the host's callbacks, and detaches on `stop()` / `dispose()`. The
 * runtime is intentionally thin — it just wires Pixi rendering up to the engine's existing event surface so the
 * Web view doesn't need to mirror the engine's internal state.
 *
 * `tuiEnabled` is hard-wired to `false` because the web runtime never claims to be a TUI; this signals the engine
 * that it should still emit per-frame log output (the engine's "no-TUI" branch) for diagnostics.
 */
export function createWebUiRuntime(options: WebUiRuntimeOptions): PlayerUiRuntime {
  const { uiSignals } = options;
  // Fire the signals-ready hook synchronously during construction so a host that prefers per-frame polling has
  // the bus references in hand by the time the engine flips runtime.start().
  try {
    options.onSignalsReady?.({ uiSignals, stateSignals: options.stateSignals });
  } catch (error) {
    log.warn('onSignalsReady callback threw', error);
  }
  let frameUnsub: (() => void) | undefined;
  let commandUnsub: (() => void) | undefined;
  let lastFrameTick = -1;
  let lastCommandTick = -1;

  const flushFrame = (): void => {
    const tick = uiSignals.frameTick();
    if (tick === lastFrameTick) return;
    lastFrameTick = tick;
    try {
      options.onFrame?.(uiSignals.getFrame());
    } catch (error) {
      log.warn('onFrame callback threw', error);
    }
  };

  const flushCommands = (): void => {
    const tick = uiSignals.commandTick();
    if (tick === lastCommandTick) return;
    lastCommandTick = tick;
    const commands = uiSignals.drainCommands();
    for (const command of commands) {
      try {
        options.onCommand?.(command);
      } catch (error) {
        log.warn('onCommand callback threw', { command, error });
      }
    }
  };

  return {
    tuiEnabled: false,
    playbackEndSeconds: options.playbackEndSeconds,
    start: (): void => {
      // alien-signals' WritableSignal can be subscribed by reading inside an effect, but for our minimal "drain on
      // tick" model a polling subscription is simpler and avoids reactive-graph dependency leaks. We poll on every
      // signal change by reading `tick()` inside a getter — the host's host-side rAF loop already ticks every
      // frame and will call into us via `onFrame` / `onCommand` indirectly. For Phase 3 we simply expose the
      // detach hooks; Phase 4 wires the actual rAF subscription.
      flushFrame();
      flushCommands();
      try {
        options.onStart?.();
      } catch (error) {
        log.warn('onStart callback threw', error);
      }
    },
    stop: (): void => {
      frameUnsub?.();
      commandUnsub?.();
      frameUnsub = undefined;
      commandUnsub = undefined;
      try {
        options.onStop?.();
      } catch (error) {
        log.warn('onStop callback threw', error);
      }
    },
    dispose: (): void => {
      frameUnsub?.();
      commandUnsub?.();
      frameUnsub = undefined;
      commandUnsub = undefined;
      try {
        options.onDispose?.();
      } catch (error) {
        log.warn('onDispose callback threw', error);
      }
    },
    triggerPoor: (seconds: number): void => {
      try {
        options.onPoorTriggered?.(seconds);
      } catch (error) {
        log.warn('onPoorTriggered callback threw', error);
      }
    },
    clearPoor: (): void => {
      try {
        options.onPoorCleared?.();
      } catch (error) {
        log.warn('onPoorCleared callback threw', error);
      }
    },
  };
}

/**
 * Helper to drain frame / command updates from the engine's `uiSignals` (and, when supplied, the matching
 * `stateSignals` judge/combo channel). The web host's rAF loop calls this once per frame so the engine's UI
 * events arrive at the host without an alien-signals reactive subscription (which would otherwise complicate
 * dispose ordering).
 *
 * The drainer keeps a per-call latched tick so a stateSignals' judge-combo update only fires `onJudgeCombo` once
 * even if the host polls multiple times per engine tick. Pass `lastJudgeComboTick` from your previous call (or
 * `0` on the first poll) and persist the returned tick value back for the next frame.
 *
 * Returns `true` when at least one event drained — useful for the host to skip Pixi work when the engine produced
 * nothing new this frame.
 */
export function drainWebUiSignals(
  uiSignals: PlayerUiSignalBus,
  callbacks: WebUiRuntimeCallbacks,
  options: { stateSignals?: PlayerStateSignals; lastJudgeComboTick?: number } = {},
): { drained: boolean; lastJudgeComboTick: number } {
  let drained = false;
  let nextJudgeComboTick = options.lastJudgeComboTick ?? 0;
  try {
    callbacks.onFrame?.(uiSignals.getFrame());
    drained = true;
  } catch (error) {
    log.warn('onFrame drain threw', error);
  }
  const commands = uiSignals.drainCommands();
  for (const command of commands) {
    try {
      callbacks.onCommand?.(command);
      drained = true;
    } catch (error) {
      log.warn('onCommand drain threw', { command, error });
    }
  }
  if (options.stateSignals) {
    const tick = options.stateSignals.judgeComboTick();
    if (tick !== nextJudgeComboTick) {
      nextJudgeComboTick = tick;
      try {
        callbacks.onJudgeCombo?.(options.stateSignals.getJudgeCombo());
        drained = true;
      } catch (error) {
        log.warn('onJudgeCombo drain threw', error);
      }
    }
  }
  return { drained, lastJudgeComboTick: nextJudgeComboTick };
}

/**
 * Convenience factory matching `PlayerOptions.createUiRuntime`. Closes over the host's callbacks so a caller can
 * pass `{ createUiRuntime: createWebUiRuntimeFactory({ onFrame, onCommand, ... }) }` directly to `manualPlay` /
 * `autoPlay`.
 */
export function createWebUiRuntimeFactory(
  callbacks: WebUiRuntimeCallbacks,
): (context: CreatePlayerUiRuntimeContext) => Promise<PlayerUiRuntime> {
  return async (context) =>
    createWebUiRuntime({
      ...callbacks,
      uiSignals: context.uiSignals,
      stateSignals: context.stateSignals,
    });
}
