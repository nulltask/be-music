/**
 * The input of a play on the built-in and LR2 play screens (`PlaySession`) that the scene handles itself rather
 * than the engine's web input runtime: ESC and F5 (after the theme's fade-out), Space (pause), hi-speed and seek arrows,
 * holding Backspace to quit, the auto-pause when the page loses focus, and the touch lanes the view sends as `lane`
 * intents (its fingers on the canvas). Lane keys go straight to the engine through its input runtime.
 *
 * The functions read and write the scene's state through {@link PlayInputContext}; the play session passes itself.
 */

import type { PlayerInputSignalBus } from '@be-music/player-engine/signals';
import { HISPEED_STEP } from '@be-music/player-scene-model';
import type { PixiSceneHost } from '../../host/scene-host.ts';
import type { QuitHoldController } from './quit-hold.ts';
import { logger } from '../../logger.ts';
import type { PlaySessionOptions } from './play-options.ts';
import { resolveLaneInputTokens, resolvePlayCoverKey } from './play-cover-keys.ts';
import type { PlayEngineContext } from './play-engine.ts';
import { adjustHiSpeed, changePlayView, handleChartManualSuddenKey } from './play-view-settings.ts';

const log = logger('gameplay');

/** The scene's members the input reads and writes: the play session's members of these names. */
export interface PlayInputContext extends PlayEngineContext {
  readonly options: PlayEngineContext['options'] & Readonly<Pick<PlaySessionOptions, 'coverKeys'>>;
  readonly host: PixiSceneHost | undefined;
  readonly quitHold: QuitHoldController;
  readonly sharedEngineInputSignals: PlayerInputSignalBus | undefined;
  /** The lanes the view's touch fingers hold (`lane` intents), in the order they went down. */
  readonly touchLanesHeld: Set<string>;
  /** How many times the play has lifted every finger off the touch lanes (a pause); the view forgets them then. */
  touchLiftCount: number;
  paused: boolean;
  pauseTime: number;
  pauseTotal: number;
  autoPaused: boolean;
  readonly autoPauseOnBlur: boolean;
  lastHidden: boolean;
  lastFocus: boolean;
  lastStartTapMs?: number;
  visibilityPollHandle: number | undefined;
  touchTokenByChannel: Map<string, string> | undefined;
  readonly handleSharedEngineExitKey: (event: KeyboardEvent) => void;
  readonly handleQuitHoldKeyUp: (event: KeyboardEvent) => void;
  readonly cancelQuitHold: () => void;
  readonly focus: () => void;
  readonly handleVisibilityChange: () => void;
  readonly handleWindowBlur: () => void;
  readonly handleWindowFocus: () => void;
  seek(seconds: number): Promise<void>;
  requestExit(): void;
  requestRestart(): void;
  pauseAllBGAVideos(): void;
  resumeActiveBGAVideos(): void;
}

/** Wires the play's own input as the play goes on the stage (`PlaySession.attachInput`); {@link detachPlayInput} undoes it. */
export function attachPlayInput(ctx: PlayInputContext, host: PixiSceneHost): void {
  // ESC / F5 / Space / ArrowUp / ArrowDown stay on the view so the LR2 `#FADEOUT` exit animation runs to
  // completion BEFORE the engine's interrupt flow disposes the audio session, and so HiSpeed adjustment
  // affects the visual scroll speed (which the engine doesn't own). The WebInputRuntime's `shouldSkipKey`
  // filter skips this list (`PLAY_SCENE_KEY_CODES` in `play-keys.ts`) so it doesn't also push duplicate `interrupt` /
  // `toggle-pause` commands. Lane input goes through the WebInputRuntime's own `keydown` listener to the engine's
  // input bus. The play listens in the capture phase, ahead of that runtime, which takes the default of every key with a
  // lane token (Enter included): the play's keys then see only what a focused control did to an event.
  window.addEventListener('keydown', ctx.handleSharedEngineExitKey, { capture: true });
  // Holding Backspace quits like Escape (`QuitHoldController`); the keyup / blur listeners end the hold.
  window.addEventListener('keyup', ctx.handleQuitHoldKeyUp);
  window.addEventListener('blur', ctx.cancelQuitHold);
  // Touch play is the view's: it follows the fingers on the canvas and sends `lane` intents (`handleTouchLaneIntent`).
  host.app.canvas.addEventListener('pointerdown', ctx.focus);
  document.addEventListener('visibilitychange', ctx.handleVisibilityChange);
  // `visibilitychange` covers tab switching but not always app switching (Cmd-Tab / Alt-Tab) — fall back to window
  // blur/focus so the gameplay also pauses when the user moves to another OS app entirely. Use the capture phase so
  // we still see the events even if PixiJS or another listener decides to stop propagation along the bubbling path.
  window.addEventListener('blur', ctx.handleWindowBlur, true);
  window.addEventListener('focus', ctx.handleWindowFocus, true);
  window.addEventListener('pagehide', ctx.handleWindowBlur);
  window.addEventListener('pageshow', ctx.handleWindowFocus);
  // Polling safety net. Some embedded environments / OS-window managers suppress the `visibilitychange` and `blur`
  // events entirely (notably when the dev-tools panel takes focus on the same window). A 250 ms poll on
  // `document.hidden` and `document.hasFocus()` catches those cases without measurable cost.
  ctx.lastHidden = document.hidden;
  ctx.lastFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
  ctx.visibilityPollHandle = window.setInterval(() => {
    const hiddenNow = document.hidden;
    const focusNow = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
    if (hiddenNow !== ctx.lastHidden) {
      ctx.lastHidden = hiddenNow;
      log.info('poll detected hidden change', { hidden: hiddenNow });
      if (hiddenNow) {
        ctx.handleWindowBlur();
      } else {
        ctx.handleWindowFocus();
      }
    } else if (focusNow !== ctx.lastFocus) {
      ctx.lastFocus = focusNow;
      log.info('poll detected focus change', { focus: focusNow });
      if (!focusNow) {
        ctx.handleWindowBlur();
      } else {
        ctx.handleWindowFocus();
      }
    }
  }, 250);
  log.info('listeners attached', {
    visibilityState: document.visibilityState,
    hidden: document.hidden,
    hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : 'n/a',
  });
}

/** Unwires what {@link attachPlayInput} wired, as the play leaves the stage (`PlaySession.detachInput`). */
export function detachPlayInput(ctx: PlayInputContext): void {
  // Detach window-level event listeners so a stray keypress doesn't hit a view that is off stage.
  window.removeEventListener('keydown', ctx.handleSharedEngineExitKey, { capture: true });
  window.removeEventListener('keyup', ctx.handleQuitHoldKeyUp);
  window.removeEventListener('blur', ctx.cancelQuitHold);
  ctx.quitHold.cancel();
  if (ctx.host) {
    ctx.host.app.canvas.removeEventListener('pointerdown', ctx.focus);
    // The view forgets its fingers as it detaches; the lanes they held are dropped with them, as the play leaves.
    ctx.touchLanesHeld.clear();
  }
  document.removeEventListener('visibilitychange', ctx.handleVisibilityChange);
  window.removeEventListener('blur', ctx.handleWindowBlur, true);
  window.removeEventListener('focus', ctx.handleWindowFocus, true);
  window.removeEventListener('pagehide', ctx.handleWindowBlur);
  window.removeEventListener('pageshow', ctx.handleWindowFocus);
  if (ctx.visibilityPollHandle !== undefined) {
    window.clearInterval(ctx.visibilityPollHandle);
    ctx.visibilityPollHandle = undefined;
  }
}

/**
 * Auto-pause when the document tab / window goes to the background and auto-resume when it comes back to the
 * foreground (matching the LR2 desktop client behavior). The user can still toggle manually with Space without
 * conflicting with this listener — `togglePause` is a symmetric flip, and we only fire it when the visibility state
 * actually changes.
 */
export function handleVisibilityChange(ctx: PlayInputContext): void {
  log.info('visibilitychange', {
    visibilityState: document.visibilityState,
    hidden: document.hidden,
    paused: ctx.paused,
    autoPaused: ctx.autoPaused,
    autoPauseOnBlur: ctx.autoPauseOnBlur,
  });
  // Auto-pause when the tab goes hidden (only if the host opted in). The auto-RESUME path stays unconditional — if we
  // previously auto-paused, we must auto-resume regardless of the toggle's current value, otherwise turning the
  // toggle off mid-blur would strand gameplay in a paused state with no obvious way out.
  if (document.hidden) {
    if (!ctx.paused && ctx.autoPauseOnBlur) {
      togglePause(ctx);
      ctx.autoPaused = true;
    }
  } else if (ctx.autoPaused && ctx.paused) {
    togglePause(ctx);
    ctx.autoPaused = false;
  }
}

/**
 * Window-level blur/focus fallback for the auto-pause behavior. Some platforms (notably macOS with Chrome) keep the
 * document `visible` across Cmd-Tab app switches, so `visibilitychange` alone misses those cases. We treat `blur` /
 * `focus` the same way as `visibilitychange`, gated on the same `autoPaused` flag so the two listeners cooperate.
 */
export function handleWindowBlur(ctx: PlayInputContext): void {
  log.info('window blur', {
    paused: ctx.paused,
    autoPaused: ctx.autoPaused,
    autoPauseOnBlur: ctx.autoPauseOnBlur,
  });
  // Same opt-in policy as `handleVisibilityChange` — only blur- pause when the host enabled it; auto-resume on focus
  // stays unconditional so flipping the toggle mid-pause can't strand us in a paused state.
  if (!ctx.paused && ctx.autoPauseOnBlur) {
    togglePause(ctx);
    ctx.autoPaused = true;
  }
}

export function handleWindowFocus(ctx: PlayInputContext): void {
  log.info('window focus', { paused: ctx.paused, autoPaused: ctx.autoPaused });
  if (ctx.autoPaused && ctx.paused) {
    togglePause(ctx);
    ctx.autoPaused = false;
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
export function handleSharedEngineExitKey(ctx: PlayInputContext, event: KeyboardEvent): void {
  // Backspace first: its auto-repeat must still be `preventDefault`ed, which the repeat filter below would skip.
  if (ctx.quitHold.handleKeyDown(event)) return;
  // The play listens in the capture phase, so a key typed into a focused field, or Enter / Space on a focused button,
  // stays the control's. Whether the event's default was taken says nothing here: the lane input runtime takes it for
  // every key with a lane token.
  const target = (event.composedPath?.()[0] ?? event.target) as HTMLElement | null;
  const tag = target?.tagName ?? '';
  if (
    target?.isContentEditable === true ||
    /^(INPUT|SELECT|TEXTAREA)$/u.test(tag) ||
    (/^(BUTTON|A|SUMMARY)$/u.test(tag) && (event.code === 'Enter' || event.code === 'Space'))
  )
    return;
  if (
    (ctx.playState.view.hiSpeed.floating ||
      event.code === 'Numpad0' ||
      (ctx.playState.view.fixedDisplayArea && event.code === 'Enter')) &&
    (event.altKey || event.ctrlKey || event.metaKey || event.isComposing)
  )
    return;
  // A held cover key keeps moving its cover, so the cover keys come before the repeat filter. A chart's M-SUDDEN takes F3
  // / F4 on every play screen (#931), unless a lane is bound to the key.
  if (
    !resolveLaneInputTokens(ctx.preparedChart?.laneBindings).has(event.code.toLowerCase()) &&
    handleChartManualSuddenKey(ctx, event)
  ) {
    event.preventDefault();
    ctx.theme.moment({ kind: 'view-setting', setting: 'sudden', at: ctx.playClock() });
    return;
  }
  if (ctx.options.coverKeys === true && handleCoverKey(ctx, event)) return;
  // Fn + arrows can report an arrow `code` with a navigation `key` on compact keyboards.
  // A disabled cover shortcut must not fall through to hi-speed or seek.
  if (['PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) return;
  // Hi-speed belongs to the view. Like cover adjustments, it follows keyboard auto-repeat;
  // one-shot actions (pause, restart, mode switches and seek) still use the repeat filter below.
  if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
    event.preventDefault();
    if (adjustHiSpeed(ctx, event.code === 'ArrowUp' ? HISPEED_STEP : -HISPEED_STEP, event.shiftKey)) {
      ctx.theme.moment({ kind: 'view-setting', setting: 'hi-speed', at: ctx.playClock() });
    }
    return;
  }
  if (event.repeat) return;
  if (event.code === 'Enter' && ctx.playState.view.fixedDisplayArea) {
    event.preventDefault();
    const previous = ctx.lastStartTapMs;
    ctx.lastStartTapMs = event.timeStamp;
    // Browser START gesture window; the source specifies a quick double press, not an exact duration.
    if (previous !== undefined && event.timeStamp > previous && event.timeStamp - previous <= 500) {
      ctx.lastStartTapMs = undefined;
      changePlayView(ctx, { type: 'floating-speed-restore', bpm: 120, visibleFraction: 1 });
    }
    return;
  }
  // Numpad 0 switches FLOATING HI-SPEED, whatever the judge rules (#774).
  if (event.code === 'Numpad0') {
    event.preventDefault();
    changePlayView(ctx, {
      type: 'floating-speed-mode',
      enabled: ctx.playState.view.hiSpeed.floating === undefined,
      bpm: 120,
      visibleFraction: 1,
    });
    return;
  }
  if (event.code === 'Escape') {
    event.preventDefault();
    ctx.requestExit();
    return;
  }
  if (event.code === 'F5' && resolveLaneInputTokens(ctx.preparedChart?.laneBindings).has('f5')) return;
  if (event.code === 'F5') {
    event.preventDefault();
    ctx.requestRestart();
    return;
  }
  if (event.code === 'Space') {
    event.preventDefault();
    togglePause(ctx);
    return;
  }
  // ← / → move five seconds only while AUTO play is on. A replay or a practice play does not.
  if ((event.code === 'ArrowLeft' || event.code === 'ArrowRight') && ctx.options.autoPlay === true) {
    const target = (event.composedPath?.()[0] ?? event.target) as HTMLElement | null;
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.isComposing ||
      target?.isContentEditable ||
      /^(INPUT|SELECT|TEXTAREA)$/u.test(target?.tagName ?? '')
    )
      return;
    event.preventDefault();
    void ctx.seek(ctx.currentSeconds() + (event.code === 'ArrowLeft' ? -5 : 5));
    return;
  }
}

/**
 * A lane cover key (`resolvePlayCoverKey`) of a play that takes them: the play state's covers move (not while a course
 * locks them), and the view hears which setting the key changed. A key one of the chart's lanes takes is left to the
 * lane. Returns whether `event` was a cover key.
 */
function handleCoverKey(ctx: PlayInputContext, event: KeyboardEvent): boolean {
  const key = resolvePlayCoverKey(event, resolveLaneInputTokens(ctx.preparedChart?.laneBindings));
  if (key === undefined) return false;
  event.preventDefault();
  if (event.repeat && key.command.type === 'cover-toggle') return true;
  if (ctx.playState.view.hiSpeed.locked) return true;
  const floating = ctx.playState.view.hiSpeed.floating;
  if (floating && key.command.type === 'cover-adjust' && key.command.part === 'sudden') {
    const cover = ctx.playState.view.covers[0];
    if (!cover?.suddenOn && !cover?.liftOn) {
      changePlayView(ctx, { type: 'hi-speed-fine', direction: -key.command.delta });
      return true;
    }
    changePlayView(ctx, {
      ...key.command,
      ...(!cover?.suddenOn && cover?.liftOn ? { part: 'lift' as const } : {}),
      delta: (Math.sign(key.command.delta) * (event.shiftKey ? 10 : 1)) / 723,
    });
  } else changePlayView(ctx, key.command);
  ctx.theme.moment({ kind: 'view-setting', setting: key.setting, at: ctx.playClock() });
  return true;
}

/**
 * A touch lane the view's fingers pressed (`pressed`) or let go, at `atMs` on the host clock (the pointer event's
 * `timeStamp`): the view's `lane` intent. A lane goes down with its first finger and up with its last, so a press of a
 * lane already held, or a release of one not held (its fingers were lifted as the play paused), changes nothing.
 */
export function handleTouchLaneIntent(ctx: PlayInputContext, channel: string, pressed: boolean, atMs: number): void {
  if (pressed) {
    if (ctx.touchLanesHeld.has(channel)) return;
    ctx.touchLanesHeld.add(channel);
    pushTouchLaneChange(ctx, { pressed: [channel], released: [] }, atMs);
    return;
  }
  if (!ctx.touchLanesHeld.delete(channel)) return;
  pushTouchLaneChange(ctx, { pressed: [], released: [channel] }, atMs);
}

/**
 * Lifts every finger, e.g. when the play pauses, so no lane stays held through the pause. The view forgets the fingers
 * as it sees the lift count move, so they press nothing until they touch down again.
 */
export function releaseAllTouchLanes(ctx: PlayInputContext): void {
  const released = [...ctx.touchLanesHeld];
  ctx.touchLanesHeld.clear();
  ctx.touchLiftCount += 1;
  pushTouchLaneChange(ctx, { pressed: [], released }, performance.now());
}

/**
 * Forwards touch presses / releases to the engine exactly as the keyboard runtime forwards keys: a release as a
 * `kitty-state` release, a press as one `lane-input` per lane (so two lanes tapped together judge two notes) plus a
 * `kitty-state` press that keeps the lane held for long notes and the key beam. `timeStamp` is the event's
 * `DOMHighResTimeStamp`, promoted to the engine's wall-clock domain the same way the keyboard path does.
 */
function pushTouchLaneChange(
  ctx: PlayInputContext,
  change: { readonly pressed: readonly string[]; readonly released: readonly string[] },
  timeStamp: number,
): void {
  const signals = ctx.sharedEngineInputSignals;
  if (!signals || (change.pressed.length === 0 && change.released.length === 0)) return;
  const pressedAt = performance.timeOrigin + timeStamp;
  const releaseTokens = resolveTouchTokens(ctx, change.released);
  if (releaseTokens.length > 0) {
    signals.pushCommand({ kind: 'kitty-state', pressTokens: [], repeatTokens: [], releaseTokens, pressedAt });
  }
  const pressTokens = resolveTouchTokens(ctx, change.pressed);
  if (pressTokens.length === 0) return;
  for (const token of pressTokens) signals.pushCommand({ kind: 'lane-input', tokens: [token], pressedAt });
  signals.pushCommand({ kind: 'kitty-state', pressTokens, repeatTokens: [], releaseTokens: [], pressedAt });
}

/** The input tokens pressing `channels`: each lane binding's first token, the one its key on the keyboard sends. */
function resolveTouchTokens(ctx: PlayInputContext, channels: readonly string[]): string[] {
  if (channels.length === 0) return [];
  let tokens = ctx.touchTokenByChannel;
  if (tokens === undefined) {
    tokens = new Map();
    for (const binding of ctx.preparedChart?.laneBindings ?? []) {
      const token = binding.inputTokens[0];
      if (token !== undefined && !tokens.has(binding.channel)) tokens.set(binding.channel, token.toLowerCase());
    }
    if (ctx.preparedChart !== undefined) ctx.touchTokenByChannel = tokens;
  }
  const resolved: string[] = [];
  for (const channel of channels) {
    const token = tokens.get(channel);
    if (token !== undefined) resolved.push(token);
  }
  return resolved;
}

export function togglePause(ctx: PlayInputContext): void {
  if (!ctx.paused) releaseAllTouchLanes(ctx);
  if (ctx.paused) {
    ctx.paused = false;
    ctx.pauseTotal += performance.now() - ctx.pauseTime;
    void ctx.audioContext?.resume();
    ctx.resumeActiveBGAVideos();
  } else {
    ctx.paused = true;
    ctx.pauseTime = performance.now();
    void ctx.audioContext?.suspend();
    ctx.pauseAllBGAVideos();
  }
  // In shared-engine mode the engine maintains its own playback clock + per-tick scheduling; without flipping
  // its pause flag the engine would keep advancing chart-time while the view sits paused, then fast-forward a
  // burst of judge events the moment the view resumes. Propagate the toggle so both sides are aligned. The
  // engine's pause path also calls `audioSession.pause()` / `resume()` which our WebAudioSession maps onto
  // `audioContext.suspend()` / `resume()` — those are idempotent when the context is already in the matching
  // state, so the redundant call from the engine side after our own `audioContext.suspend()` above is a no-op.
  ctx.sharedEngineInputSignals?.pushCommand({ kind: 'toggle-pause' });
}
