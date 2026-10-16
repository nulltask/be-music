/**
 * The input of a play on the built-in and LR2 gameplay scenes (`CoreGameplayView`) that the scene handles itself rather
 * than the engine's web input runtime: ESC and F5 (after the theme's fade-out), Space (pause), the hi-speed arrows,
 * holding Backspace to quit, the auto-pause when the page loses focus, and touch lanes. Lane keys go straight to the
 * engine through its input runtime.
 *
 * The functions read and write the scene's state through {@link PlayInputContext}; the scene passes itself.
 */

import type { PlayerInputSignalBus } from '@be-music/player/core/input-signal-bus';
import type { Application } from 'pixi.js';
import type { PixiSceneHost } from '../../scene/host.ts';
import { resolveScaledViewport } from '../../scene/core/viewport.ts';
import type { QuitHoldController } from '../../scene/quit-hold.ts';
import {
  canvasPointToDesign,
  hitTestTouchLane,
  isTouchPlayPointer,
  resolveTouchLaneZones,
  type TouchLaneChange,
  type TouchLaneTracker,
} from '../../scene/core/touch-lanes.ts';
import { HISPEED_STEP } from '../../scene/gameplay-constants.ts';
import { logger } from '../../logger.ts';
import { beginExitSequence } from './play-ending.ts';
import { interruptSharedEngine, type PlayEngineContext } from './play-engine.ts';
import { adjustHiSpeed } from './play-view-settings.ts';

const log = logger('gameplay');

/** The scene's members the input reads and writes: `CoreGameplayView`'s members of these names. */
export interface PlayInputContext extends PlayEngineContext {
  readonly host: PixiSceneHost | undefined;
  readonly app: Application;
  readonly quitHold: QuitHoldController;
  readonly touchLanes: TouchLaneTracker;
  readonly sharedEngineInputSignals: PlayerInputSignalBus | undefined;
  previousCanvasTouchAction: string | undefined;
  paused: boolean;
  pauseTime: number;
  pauseTotal: number;
  autoPaused: boolean;
  readonly autoPauseOnBlur: boolean;
  lastHidden: boolean;
  lastFocus: boolean;
  visibilityPollHandle: number | undefined;
  touchTokenByChannel: Map<string, string> | undefined;
  readonly handleSharedEngineExitKey: (event: KeyboardEvent) => void;
  readonly handleQuitHoldKeyUp: (event: KeyboardEvent) => void;
  readonly cancelQuitHold: () => void;
  readonly focus: () => void;
  readonly handleTouchPointer: (event: PointerEvent) => void;
  readonly handleTouchPointerUp: (event: PointerEvent) => void;
  readonly handleVisibilityChange: () => void;
  readonly handleWindowBlur: () => void;
  readonly handleWindowFocus: () => void;
  requestExit(): void;
  pauseAllBgaVideos(): void;
  resumeActiveBgaVideos(): void;
}

/** Wires the play's own input as the scene enters (`CoreGameplayView.enter`); {@link detachPlayInput} undoes it. */
export function attachPlayInput(this: PlayInputContext, host: PixiSceneHost): void {
  // ESC / F5 / Space / ArrowUp / ArrowDown stay on the view so the LR2 `#FADEOUT` exit animation runs to
  // completion BEFORE the engine's interrupt flow disposes the audio session, and so HiSpeed adjustment
  // affects the visual scroll speed (which the engine doesn't own). The WebInputRuntime's `shouldSkipKey`
  // filter mirrors this list so it doesn't also push duplicate `interrupt` / `toggle-pause` commands. Lane
  // input goes through the WebInputRuntime's own `keydown` listener to the engine's input bus.
  window.addEventListener('keydown', this.handleSharedEngineExitKey);
  // Holding Backspace quits like Escape (`QuitHoldController`); the keyup / blur listeners end the hold.
  window.addEventListener('keyup', this.handleQuitHoldKeyUp);
  window.addEventListener('blur', this.cancelQuitHold);
  host.app.canvas.addEventListener('pointerdown', this.focus);
  // Touch play: fingers on the lanes press them. `touch-action: none` keeps the page from scrolling or zooming under
  // the fingers while the play is up.
  this.previousCanvasTouchAction = host.app.canvas.style.touchAction;
  host.app.canvas.style.touchAction = 'none';
  host.app.canvas.addEventListener('pointerdown', this.handleTouchPointer);
  host.app.canvas.addEventListener('pointermove', this.handleTouchPointer);
  host.app.canvas.addEventListener('pointerup', this.handleTouchPointerUp);
  host.app.canvas.addEventListener('pointercancel', this.handleTouchPointerUp);
  document.addEventListener('visibilitychange', this.handleVisibilityChange);
  // `visibilitychange` covers tab switching but not always app switching (Cmd-Tab / Alt-Tab) — fall back to window
  // blur/focus so the gameplay also pauses when the user moves to another OS app entirely. Use the capture phase so
  // we still see the events even if PixiJS or another listener decides to stop propagation along the bubbling path.
  window.addEventListener('blur', this.handleWindowBlur, true);
  window.addEventListener('focus', this.handleWindowFocus, true);
  window.addEventListener('pagehide', this.handleWindowBlur);
  window.addEventListener('pageshow', this.handleWindowFocus);
  // Polling safety net. Some embedded environments / OS-window managers suppress the `visibilitychange` and `blur`
  // events entirely (notably when the dev-tools panel takes focus on the same window). A 250 ms poll on
  // `document.hidden` and `document.hasFocus()` catches those cases without measurable cost.
  this.lastHidden = document.hidden;
  this.lastFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
  this.visibilityPollHandle = window.setInterval(() => {
    const hiddenNow = document.hidden;
    const focusNow = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
    if (hiddenNow !== this.lastHidden) {
      this.lastHidden = hiddenNow;
      log.info('poll detected hidden change', { hidden: hiddenNow });
      if (hiddenNow) {
        this.handleWindowBlur();
      } else {
        this.handleWindowFocus();
      }
    } else if (focusNow !== this.lastFocus) {
      this.lastFocus = focusNow;
      log.info('poll detected focus change', { focus: focusNow });
      if (!focusNow) {
        this.handleWindowBlur();
      } else {
        this.handleWindowFocus();
      }
    }
  }, 250);
  log.info('listeners attached', {
    visibilityState: document.visibilityState,
    hidden: document.hidden,
    hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : 'n/a',
  });
}

/** Unwires what {@link attachPlayInput} wired, as the scene exits (`CoreGameplayView.exit`). */
export function detachPlayInput(this: PlayInputContext): void {
  // Detach window-level event listeners so a stray keypress doesn't hit a view that is off stage.
  window.removeEventListener('keydown', this.handleSharedEngineExitKey);
  window.removeEventListener('keyup', this.handleQuitHoldKeyUp);
  window.removeEventListener('blur', this.cancelQuitHold);
  this.quitHold.cancel();
  if (this.host) {
    this.host.app.canvas.removeEventListener('pointerdown', this.focus);
    const canvas = this.host.app.canvas;
    canvas.removeEventListener('pointerdown', this.handleTouchPointer);
    canvas.removeEventListener('pointermove', this.handleTouchPointer);
    canvas.removeEventListener('pointerup', this.handleTouchPointerUp);
    canvas.removeEventListener('pointercancel', this.handleTouchPointerUp);
    if (this.previousCanvasTouchAction !== undefined) canvas.style.touchAction = this.previousCanvasTouchAction;
    this.touchLanes.upAll();
  }
  document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  window.removeEventListener('blur', this.handleWindowBlur, true);
  window.removeEventListener('focus', this.handleWindowFocus, true);
  window.removeEventListener('pagehide', this.handleWindowBlur);
  window.removeEventListener('pageshow', this.handleWindowFocus);
  if (this.visibilityPollHandle !== undefined) {
    window.clearInterval(this.visibilityPollHandle);
    this.visibilityPollHandle = undefined;
  }
}

/**
 * Auto-pause when the document tab / window goes to the background and auto-resume when it comes back to the
 * foreground (matching the LR2 desktop client behavior). The user can still toggle manually with Space without
 * conflicting with this listener — `togglePause` is a symmetric flip, and we only fire it when the visibility state
 * actually changes.
 */
export function handleVisibilityChange(this: PlayInputContext): void {
  log.info('visibilitychange', {
    visibilityState: document.visibilityState,
    hidden: document.hidden,
    paused: this.paused,
    autoPaused: this.autoPaused,
    autoPauseOnBlur: this.autoPauseOnBlur,
  });
  // Auto-pause when the tab goes hidden (only if the host opted in). The auto-RESUME path stays unconditional — if we
  // previously auto-paused, we must auto-resume regardless of the toggle's current value, otherwise turning the
  // toggle off mid-blur would strand gameplay in a paused state with no obvious way out.
  if (document.hidden) {
    if (!this.paused && this.autoPauseOnBlur) {
      togglePause.call(this);
      this.autoPaused = true;
    }
  } else if (this.autoPaused && this.paused) {
    togglePause.call(this);
    this.autoPaused = false;
  }
}

/**
 * Window-level blur/focus fallback for the auto-pause behavior. Some platforms (notably macOS with Chrome) keep the
 * document `visible` across Cmd-Tab app switches, so `visibilitychange` alone misses those cases. We treat `blur` /
 * `focus` the same way as `visibilitychange`, gated on the same `autoPaused` flag so the two listeners cooperate.
 */
export function handleWindowBlur(this: PlayInputContext): void {
  log.info('window blur', {
    paused: this.paused,
    autoPaused: this.autoPaused,
    autoPauseOnBlur: this.autoPauseOnBlur,
  });
  // Same opt-in policy as `handleVisibilityChange` — only blur- pause when the host enabled it; auto-resume on focus
  // stays unconditional so flipping the toggle mid-pause can't strand us in a paused state.
  if (!this.paused && this.autoPauseOnBlur) {
    togglePause.call(this);
    this.autoPaused = true;
  }
}

export function handleWindowFocus(this: PlayInputContext): void {
  log.info('window focus', { paused: this.paused, autoPaused: this.autoPaused });
  if (this.autoPaused && this.paused) {
    togglePause.call(this);
    this.autoPaused = false;
  }
}

/**
 * Captures ESC / F5 in shared-engine mode so the LR2 `#FADEOUT` exit animation runs to completion BEFORE the
 * engine's `PlayerInterruptedError` flow disposes the audio session. Without this intercept, pushing
 * `interrupt(escape)` through the WebInputRuntime would tear down the audio session synchronously inside
 * `manualPlay`'s `finally` block, killing every in-flight `BufferSource` mid-fade — the user hears the chart
 * audio cut to silence the moment ESC fires while the LR2 fadeout overlay is still painting.
 *
 * The handler kicks off `beginExitSequence` (which fades `audioBus.fadeOutAudibleTo(0)` over the LR2 fadeout
 * duration). Once the fade callback resolves, we abort the engine's `AbortController` so the engine throws and
 * unwinds normally — the audio session is already silent by then, so the in-flight-source `node.stop()` calls
 * have nothing audible to interrupt.
 */
export function handleSharedEngineExitKey(this: PlayInputContext, event: KeyboardEvent): void {
  // Backspace first: its auto-repeat must still be `preventDefault`ed, which the repeat filter below would skip.
  if (this.quitHold.handleKeyDown(event)) return;
  if (event.repeat) return;
  if (event.code === 'Escape') {
    event.preventDefault();
    this.requestExit();
    return;
  }
  if (event.code === 'F5') {
    event.preventDefault();
    beginExitSequence.call(this, () => {
      interruptSharedEngine.call(this, 'restart');
      this.sharedEngineAbortController?.abort();
      this.options.onRestart?.();
    });
    return;
  }
  if (event.code === 'Space') {
    event.preventDefault();
    togglePause.call(this);
    return;
  }
  // HiSpeed adjustment runs entirely on the view side — the engine has its own `high-speed` input command but
  // the value it tracks is decoupled from the visual scroll speed (`PIXELS_PER_BEAT * this.hiSpeed`) the
  // renderer applies. The WebInputRuntime's lane-input dispatch ignores arrow tokens, so the engine has no
  // way to push HiSpeed changes back to the renderer; we handle them directly here.
  if (event.code === 'ArrowUp') {
    event.preventDefault();
    adjustHiSpeed.call(this, HISPEED_STEP);
    return;
  }
  if (event.code === 'ArrowDown') {
    event.preventDefault();
    adjustHiSpeed.call(this, -HISPEED_STEP);
  }
}

/**
 * A finger touching down on or moving over the canvas: presses the lane under it, or — when it slid out of the lane it
 * held — releases that lane and presses the new one. Mouse pointers are left alone (a click only focuses the canvas).
 */
export function handleTouchPointer(this: PlayInputContext, event: PointerEvent): void {
  if (!isTouchPlayPointer(event.pointerType)) return;
  if (event.type === 'pointermove' && !this.touchLanes.isTracking(event.pointerId)) return;
  const { width: designWidth, height: designHeight } = this.theme.stageSize();
  const viewport = resolveScaledViewport(this.app.screen.width, this.app.screen.height, designWidth, designHeight);
  const point = canvasPointToDesign(event.offsetX, event.offsetY, viewport);
  const zones = resolveTouchLaneZones(
    Array.from(this.laneX, ([channel, lane]) => ({ channel, ...lane })),
    {
      stageHeight: designHeight,
    },
  );
  const channel = hitTestTouchLane(zones, point.x, point.y);
  const change =
    event.type === 'pointerdown'
      ? this.touchLanes.down(event.pointerId, channel)
      : this.touchLanes.move(event.pointerId, channel);
  if (event.type === 'pointerdown') event.preventDefault();
  pushTouchLaneChange.call(this, change, event.timeStamp);
}

export function handleTouchPointerUp(this: PlayInputContext, event: PointerEvent): void {
  if (!isTouchPlayPointer(event.pointerType)) return;
  pushTouchLaneChange.call(this, this.touchLanes.up(event.pointerId), event.timeStamp);
}

/** Lifts every finger, e.g. when the play pauses, so no lane stays held through the pause. */
function releaseAllTouchLanes(this: PlayInputContext): void {
  pushTouchLaneChange.call(this, this.touchLanes.upAll(), performance.now());
}

/**
 * Forwards touch presses / releases to the engine exactly as the keyboard runtime forwards keys: a release as a
 * `kitty-state` release, a press as one `lane-input` per lane (so two lanes tapped together judge two notes) plus a
 * `kitty-state` press that keeps the lane held for long notes and the key beam. `timeStamp` is the event's
 * `DOMHighResTimeStamp`, promoted to the engine's wall-clock domain the same way the keyboard path does.
 */
function pushTouchLaneChange(this: PlayInputContext, change: TouchLaneChange, timeStamp: number): void {
  const signals = this.sharedEngineInputSignals;
  if (!signals || (change.pressed.length === 0 && change.released.length === 0)) return;
  const pressedAt = performance.timeOrigin + timeStamp;
  const releaseTokens = resolveTouchTokens.call(this, change.released);
  if (releaseTokens.length > 0) {
    signals.pushCommand({ kind: 'kitty-state', pressTokens: [], repeatTokens: [], releaseTokens, pressedAt });
  }
  const pressTokens = resolveTouchTokens.call(this, change.pressed);
  if (pressTokens.length === 0) return;
  for (const token of pressTokens) signals.pushCommand({ kind: 'lane-input', tokens: [token], pressedAt });
  signals.pushCommand({ kind: 'kitty-state', pressTokens, repeatTokens: [], releaseTokens: [], pressedAt });
}

/** The input tokens pressing `channels`: each lane binding's first token, the one its key on the keyboard sends. */
function resolveTouchTokens(this: PlayInputContext, channels: readonly string[]): string[] {
  if (channels.length === 0) return [];
  let tokens = this.touchTokenByChannel;
  if (tokens === undefined) {
    tokens = new Map();
    for (const binding of this.preparedChart?.laneBindings ?? []) {
      const token = binding.inputTokens[0];
      if (token !== undefined && !tokens.has(binding.channel)) tokens.set(binding.channel, token.toLowerCase());
    }
    if (this.preparedChart !== undefined) this.touchTokenByChannel = tokens;
  }
  const resolved: string[] = [];
  for (const channel of channels) {
    const token = tokens.get(channel);
    if (token !== undefined) resolved.push(token);
  }
  return resolved;
}

export function togglePause(this: PlayInputContext): void {
  if (!this.paused) releaseAllTouchLanes.call(this);
  if (this.paused) {
    this.paused = false;
    this.pauseTotal += performance.now() - this.pauseTime;
    void this.audioContext?.resume();
    this.resumeActiveBgaVideos();
  } else {
    this.paused = true;
    this.pauseTime = performance.now();
    void this.audioContext?.suspend();
    this.pauseAllBgaVideos();
  }
  // In shared-engine mode the engine maintains its own playback clock + per-tick scheduling; without flipping
  // its pause flag the engine would keep advancing chart-time while the view sits paused, then fast-forward a
  // burst of judge events the moment the view resumes. Propagate the toggle so both sides are aligned. The
  // engine's pause path also calls `audioSession.pause()` / `resume()` which our WebAudioSession maps onto
  // `audioContext.suspend()` / `resume()` — those are idempotent when the context is already in the matching
  // state, so the redundant call from the engine side after our own `audioContext.suspend()` above is a no-op.
  this.sharedEngineInputSignals?.pushCommand({ kind: 'toggle-pause' });
}
