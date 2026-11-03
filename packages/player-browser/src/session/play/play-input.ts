/**
 * The input of a play on the built-in and LR2 play screens (`PlaySession`) that the scene handles itself rather
 * than the engine's web input runtime: ESC and F5 (after the theme's fade-out), Pause and Tab (pause), hi-speed and seek
 * arrows, holding Backspace to quit, the auto-pause when the page loses focus, START / SELECT (recorded in the replay),
 * and the touch lanes the view sends as `lane` intents (its fingers on the canvas). Lane keys go straight to the engine
 * through its input runtime.
 *
 * The functions read and write the scene's state through {@link PlayInputContext}; the play session passes itself.
 */

import type { PlayerInputSignalBus } from '@be-music/player-engine/signals';
import { HISPEED_STEP } from '@be-music/player-scene-model';
import type { PixiSceneHost } from '../../host/scene-host.ts';
import type { QuitHoldController } from './quit-hold.ts';
import { logger } from '../../logger.ts';
import type { PlaySessionOptions, SkinAdjust } from './play-options.ts';
import { resolveLaneInputTokens, resolvePlayCoverKey } from './play-cover-keys.ts';
import type { PlayEngineContext } from './play-engine.ts';
import { adjustHiSpeed, adjustWhiteNumber, changePlayView, handleChartManualSuddenKey } from './play-view-settings.ts';
import { keyboardEventToTokens } from '../../runtime/web-input-runtime.ts';
import {
  controlButtonsOfKey,
  resolveControlButtons,
  type ControlButton,
  type ControlButtonMap,
  type ControlScheme,
  type ControlSide,
  type ControlSideButton,
} from '../controls/control-buttons.ts';
import { resolveControlActions, type ControlActionMap } from '../controls/control-actions.ts';
import {
  createControlButtonTracker,
  isStartAndSelectDown,
  type ControlButtonChange,
  type ControlButtonTracker,
} from '../controls/button-tracker.ts';

const log = logger('gameplay');

/** The scene's members the input reads and writes: the play session's members of these names. */
export interface PlayInputContext extends PlayEngineContext {
  readonly options: PlayEngineContext['options'] &
    Readonly<Pick<PlaySessionOptions, 'coverKeys' | 'laneKeys' | 'controlKeys' | 'actionKeys' | 'controlScheme'>>;
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
  getTempo(): number;
  setTempo(tempo: number): boolean;
  readonly skinAdjust: SkinAdjust;
  setSkinAdjust(adjust: SkinAdjust): void;
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
  recordControlKey(ctx, 'down', event);
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
  const actions = playControlActions(ctx);
  if (
    (ctx.playState.view.hiSpeed.floating ||
      actions.is('play.floating-hi-speed', event) ||
      (ctx.playState.view.fixedDisplayArea && actions.is('play.restore-green', event))) &&
    (event.altKey || event.ctrlKey || event.metaKey || event.isComposing)
  )
    return;
  // START and SELECT, alone or with a key: a lane key goes on to the lane as well.
  if (handleStartSelect(ctx, trackPlayKey(ctx, 'down', event))) return;
  // A key one of the chart's lanes takes is the lane's, whatever the play's keys say.
  const laneTokens = resolveLaneInputTokens(ctx.preparedChart?.laneBindings);
  if (keyboardEventToTokens(event).some((token) => laneTokens.has(token))) return;
  // A held cover key keeps moving its cover, so the cover keys come before the repeat filter. A chart's M-SUDDEN takes F3
  // / F4 on every play screen (#931).
  if (handleChartManualSuddenKey(ctx, event, actions)) {
    event.preventDefault();
    ctx.theme.moment({ kind: 'view-setting', setting: 'sudden', at: ctx.playClock() });
    return;
  }
  if (ctx.options.coverKeys === true && handleCoverKey(ctx, event)) return;
  // Fn + arrows can report an arrow `code` with a navigation `key` on compact keyboards.
  // A disabled cover shortcut must not fall through to hi-speed or seek.
  if (['PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) return;
  // LR2: a number key held with an arrow moves the skin (1), scales it (2), or lifts the 1P / 2P lanes (6 / 7).
  if ((ctx.options.controlScheme ?? 'lr2') === 'lr2' && event.code.startsWith('Arrow')) {
    const digit = ['Digit1', 'Digit2', 'Digit6', 'Digit7'].find((code) => digitsHeldByPlay.get(ctx)?.has(code));
    if (digit !== undefined) {
      event.preventDefault();
      adjustLR2Skin(ctx, digit, event.code, event.shiftKey);
      return;
    }
  }
  // Hi-speed belongs to the view. Like cover adjustments, it follows keyboard auto-repeat;
  // one-shot actions (pause, restart, mode switches and seek) still use the repeat filter below.
  const hiSpeedUp = actions.is('play.hi-speed-up', event);
  if (hiSpeedUp || actions.is('play.hi-speed-down', event)) {
    event.preventDefault();
    if (adjustHiSpeed(ctx, hiSpeedUp ? HISPEED_STEP : -HISPEED_STEP, event.shiftKey)) {
      ctx.theme.moment({ kind: 'view-setting', setting: 'hi-speed', at: ctx.playClock() });
    }
    return;
  }
  if (event.repeat) return;
  if (ctx.playState.view.fixedDisplayArea && actions.is('play.restore-green', event)) {
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
  // beatoraja's AUTO play runs ×0.25 / ×0.5 / ×2 / ×3 while 1 / 2 / 3 / 4 is held (the web player's tempo range bounds it).
  if (ctx.options.autoPlay === true) {
    const speed = ([1, 2, 3, 4] as const).find((key) => actions.is(`play.speed-${key}`, event));
    if (speed !== undefined) {
      event.preventDefault();
      const before = tempoBeforeSpeedKeyByPlay.get(ctx) ?? ctx.getTempo();
      if (ctx.setTempo(before * AUTO_SPEEDS[speed - 1])) tempoBeforeSpeedKeyByPlay.set(ctx, before);
      return;
    }
  }
  // Numpad 0 switches FLOATING HI-SPEED, whatever the judge rules (#774).
  if (actions.is('play.floating-hi-speed', event)) {
    event.preventDefault();
    changePlayView(ctx, {
      type: 'floating-speed-mode',
      enabled: ctx.playState.view.hiSpeed.floating === undefined,
      bpm: 120,
      visibleFraction: 1,
    });
    return;
  }
  if (actions.is('play.quit', event)) {
    event.preventDefault();
    ctx.requestExit();
    return;
  }
  if (actions.is('play.restart', event)) {
    event.preventDefault();
    ctx.requestRestart();
    return;
  }
  // Pause, and Tab unless a lane takes it (the 24 / 48 KEY wheels do), pause and resume the play.
  if (actions.is('play.pause', event)) {
    event.preventDefault();
    togglePause(ctx);
    return;
  }
  // ← / → move five seconds only while AUTO play is on. A replay or a practice play does not.
  const seekBack = actions.is('play.seek-back', event);
  if ((seekBack || actions.is('play.seek-forward', event)) && ctx.options.autoPlay === true) {
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
    void ctx.seek(ctx.currentSeconds() + (seekBack ? -5 : 5));
    return;
  }
  // LR2's ← / → and beatoraja's ↑ / ↓ move the lane cover, on every play screen.
  const coverLess = actions.is('play.cover-less', event);
  if (coverLess || actions.is('play.cover-more', event)) {
    event.preventDefault();
    moveSuddenCover(ctx, (coverLess ? -1 : 1) * (event.shiftKey ? 0.05 : 0.01));
  }
}

/**
 * A lane cover key (`resolvePlayCoverKey`) of a play that takes them: the play state's covers move (not while a course
 * locks them), and the view hears which setting the key changed. A key one of the chart's lanes takes is left to the
 * lane. Returns whether `event` was a cover key.
 */
function handleCoverKey(ctx: PlayInputContext, event: KeyboardEvent): boolean {
  const key = resolvePlayCoverKey(
    event,
    resolveLaneInputTokens(ctx.preparedChart?.laneBindings),
    playControlActions(ctx),
  );
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
 * The physical input a touch lane records in the replay (`ReplayInputEvent.code`): its tokens are the lane's keyboard
 * key, so only this tells a tap from a key press.
 */
export const TOUCH_INPUT_CODE = 'touch';

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
    signals.pushCommand({
      kind: 'kitty-state',
      pressTokens: [],
      repeatTokens: [],
      releaseTokens,
      code: TOUCH_INPUT_CODE,
      pressedAt,
    });
  }
  const pressTokens = resolveTouchTokens(ctx, change.pressed);
  if (pressTokens.length === 0) return;
  // A finger has no turning direction: `spin: null` keeps the engine from reading one off the lane's key token, so a
  // fresh tap on a held back-spin scratch turns it back.
  for (const token of pressTokens) {
    signals.pushCommand({ kind: 'lane-input', tokens: [token], code: TOUCH_INPUT_CODE, pressedAt, spin: null });
  }
  signals.pushCommand({
    kind: 'kitty-state',
    pressTokens,
    repeatTokens: [],
    releaseTokens: [],
    code: TOUCH_INPUT_CODE,
    pressedAt,
  });
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

/** The play's operations by the player's keys, resolved once per play. */
const controlActionsByPlay = new WeakMap<PlayInputContext, ControlActionMap>();

/** The control buttons each play holds, for START + a key. */
const controlButtonsHeldByPlay = new WeakMap<PlayInputContext, ControlButtonTracker>();

/** The number keys each play holds (`Digit1`…), for LR2's skin moves and beatoraja's AUTO speeds. */
const digitsHeldByPlay = new WeakMap<PlayInputContext, Set<string>>();

/** The tempo an AUTO play ran at before beatoraja's speed keys changed it, while one is held. */
const tempoBeforeSpeedKeyByPlay = new WeakMap<PlayInputContext, number>();

/** beatoraja's AUTO play speeds on keys 1-4 (×0.25, ×0.5, ×2, ×3), clamped to the tempo the web player can play. */
const AUTO_SPEEDS = [0.25, 0.5, 2, 3] as const;

/** When each play's quit key (Escape) went down, while it is down: held through the fade-out, it retries. */
const quitKeyDownAtByPlay = new WeakMap<PlayInputContext, number>();

/** How long START+SELECT are held to quit, as beatoraja's `exitPressDuration` (LR2 quits on the hold too). */
export const START_SELECT_QUIT_MS = 1000;

/** How long the quit key is held through the fade-out for a quick retry (That-Which-Must-Not-Be-Named PC's). */
export const QUICK_RETRY_HOLD_MS = 500;

/** The window START is pressed twice in to switch the lane cover: LR2's 250 ms, beatoraja's 500 ms. */
const START_DOUBLE_PRESS_MS: Readonly<Record<ControlScheme, number>> = { lr2: 250, beatoraja: 500 };

/** The control buttons `ctx`'s play holds. */
function controlButtonsHeld(ctx: PlayInputContext): ControlButtonTracker {
  let tracker = controlButtonsHeldByPlay.get(ctx);
  if (tracker === undefined) {
    tracker = createControlButtonTracker();
    controlButtonsHeldByPlay.set(ctx, tracker);
  }
  return tracker;
}

/** The control buttons a key is in `ctx`'s play. */
function controlButtonsOfPlayKey(ctx: PlayInputContext, event: KeyboardEvent): ControlButton[] {
  let map = controlButtonsByPlay.get(ctx);
  if (map === undefined) {
    map = resolveControlButtons({
      ...(ctx.options.laneKeys !== undefined ? { laneKeys: ctx.options.laneKeys } : {}),
      ...(ctx.options.controlKeys !== undefined ? { controlKeys: ctx.options.controlKeys } : {}),
    });
    controlButtonsByPlay.set(ctx, map);
  }
  return controlButtonsOfKey(event, map);
}

/** Takes a key going down or up into the buttons the play holds and the quit key's hold; returns the buttons' changes. */
export function trackPlayKey(ctx: PlayInputContext, type: 'down' | 'up', event: KeyboardEvent): ControlButtonChange[] {
  if (/^Digit\d$/u.test(event.code) && !event.repeat) {
    let digits = digitsHeldByPlay.get(ctx);
    if (digits === undefined) {
      digits = new Set();
      digitsHeldByPlay.set(ctx, digits);
    }
    if (type === 'down') digits.add(event.code);
    else digits.delete(event.code);
  }
  // beatoraja's speed keys hold the AUTO play's speed: letting the last one go brings back the tempo before.
  const before = tempoBeforeSpeedKeyByPlay.get(ctx);
  if (type === 'up' && before !== undefined) {
    const actions = playControlActions(ctx);
    const speedKeyHeld = [...(digitsHeldByPlay.get(ctx) ?? [])].some((code) =>
      ([1, 2, 3, 4] as const).some((key) => actions.is(`play.speed-${key}`, { code })),
    );
    if (!speedKeyHeld) {
      tempoBeforeSpeedKeyByPlay.delete(ctx);
      ctx.setTempo(before);
    }
  }
  if (playControlActions(ctx).is('play.quit', event) && !event.repeat) {
    if (type === 'down') quitKeyDownAtByPlay.set(ctx, event.timeStamp);
    else quitKeyDownAtByPlay.delete(ctx);
  }
  return controlButtonsHeld(ctx).handle({
    type,
    code: event.code,
    repeat: event.repeat,
    timeStamp: event.timeStamp,
    buttons: controlButtonsOfPlayKey(ctx, event),
  });
}

/** Lets the play's buttons and quit key go (the page lost focus, the play left). */
export function releasePlayKeys(ctx: PlayInputContext): void {
  controlButtonsHeldByPlay.get(ctx)?.reset();
  digitsHeldByPlay.get(ctx)?.clear();
  const before = tempoBeforeSpeedKeyByPlay.get(ctx);
  if (before !== undefined) {
    tempoBeforeSpeedKeyByPlay.delete(ctx);
    ctx.setTempo(before);
  }
  quitKeyDownAtByPlay.delete(ctx);
}

/** Whether the quit key is still held, for {@link QUICK_RETRY_HOLD_MS} or longer, at `nowMs` (the fade-out's end). */
export function isQuickRetryHeld(ctx: PlayInputContext, nowMs: number): boolean {
  const downAt = quitKeyDownAtByPlay.get(ctx);
  return downAt !== undefined && nowMs - downAt >= QUICK_RETRY_HOLD_MS;
}

/** Moves SUDDEN+ by `delta` (of the lane) the way a cover key does, unless a course locks the covers. */
function moveSuddenCover(ctx: PlayInputContext, delta: number): void {
  if (ctx.playState.view.hiSpeed.locked) return;
  changePlayView(ctx, { type: 'cover-adjust', part: 'sudden', delta });
  ctx.theme.moment({ kind: 'view-setting', setting: 'sudden', at: ctx.playClock() });
}

/** Steps the hi-speed by `steps` steps, unless a course locks it. */
function stepPlayHiSpeed(ctx: PlayInputContext, steps: 1 | -1): void {
  if (adjustHiSpeed(ctx, steps * HISPEED_STEP, false)) {
    ctx.theme.moment({ kind: 'view-setting', setting: 'hi-speed', at: ctx.playClock() });
  }
}

/**
 * What START and SELECT do in a play, as LR2 and beatoraja take them (`ctx.options.controlScheme`):
 *
 * - START (LR2: or SELECT) + a key steps the hi-speed: keys 1 / 3 / 5 (and 7 in beatoraja) down, 2 / 4 (and 6) up. In
 *   LR2 keys 6 / 7 move the lane cover while it shows (and step the hi-speed up / down while it does not); in
 *   beatoraja START + the turntable moves the cover.
 * - START (LR2: or SELECT) pressed twice switches the lane cover.
 * - START and SELECT held for {@link START_SELECT_QUIT_MS} quit; after the last note either one alone ends the play.
 *
 * Returns whether the key was START or SELECT (a lane key goes on to the lane either way).
 */
function handleStartSelect(ctx: PlayInputContext, changes: readonly ControlButtonChange[]): boolean {
  const scheme = ctx.options.controlScheme ?? 'lr2';
  const tracker = controlButtonsHeld(ctx);
  let control = false;
  for (const change of changes) {
    if (change.type !== 'down') continue;
    const [side, button] = splitControlButton(change.button);
    const modifierDown = tracker.isDown(`${side}-start`) || (scheme === 'lr2' && tracker.isDown(`${side}-select`));
    if (button === 'start' || button === 'select') {
      control = true;
      if (isStartAndSelectDown(tracker)) {
        setTimeout(() => {
          if (isStartAndSelectDown(tracker)) ctx.requestExit();
        }, START_SELECT_QUIT_MS);
        continue;
      }
      if (ctx.playMoments.allNotesDoneAtMs !== undefined) {
        ctx.requestExit();
        continue;
      }
      const switches = button === 'start' || scheme === 'lr2';
      const previous = change.previousDownAt;
      if (switches && previous !== undefined && change.timeStamp - previous <= START_DOUBLE_PRESS_MS[scheme]) {
        if (!ctx.playState.view.hiSpeed.locked) {
          changePlayView(ctx, { type: 'cover-toggle', part: 'sudden' });
          ctx.theme.moment({ kind: 'view-setting', setting: 'sudden', at: ctx.playClock() });
        }
      }
      continue;
    }
    // beatoraja's SELECT + a key changes the visible time instead: odd keys and the turntable's second key shorten it by
    // 1 ms, even keys and its first key lengthen it.
    if (scheme === 'beatoraja' && !tracker.isDown(`${side}-start`) && tracker.isDown(`${side}-select`)) {
      const longer = button === 'scratch-cw' || (button.startsWith('key') && Number(button.slice(3)) % 2 === 0);
      if (adjustWhiteNumber(ctx, longer ? 1 : -1)) {
        ctx.theme.moment({ kind: 'view-setting', setting: 'hi-speed', at: ctx.playClock() });
      }
      continue;
    }
    if (!modifierDown) continue;
    if (button === 'scratch-cw' || button === 'scratch-ccw') {
      // beatoraja's START + the turntable's first key covers more of the lane, its second key less.
      if (scheme === 'beatoraja') moveSuddenCover(ctx, button === 'scratch-cw' ? 0.01 : -0.01);
      continue;
    }
    const key = Number(button.slice(3));
    if (scheme === 'lr2' && (key === 6 || key === 7)) {
      const cover = ctx.playState.view.covers[0];
      if (cover?.suddenOn === true) moveSuddenCover(ctx, key === 6 ? -0.01 : 0.01);
      else stepPlayHiSpeed(ctx, key === 6 ? 1 : -1);
      continue;
    }
    stepPlayHiSpeed(ctx, key % 2 === 1 ? -1 : 1);
  }
  return control;
}

/**
 * LR2's skin moves (number key + an arrow): 1 moves the skin a design pixel (10 with Shift), 2 scales it by 1 % (between
 * half and double), 6 / 7 raise or lower the 1P / 2P lanes (their LIFT) by 1 % of the lane.
 */
function adjustLR2Skin(ctx: PlayInputContext, digit: string, arrow: string, shiftKey: boolean): void {
  const step = shiftKey ? 10 : 1;
  const dx = arrow === 'ArrowLeft' ? -1 : arrow === 'ArrowRight' ? 1 : 0;
  const dy = arrow === 'ArrowUp' ? -1 : arrow === 'ArrowDown' ? 1 : 0;
  const adjust = ctx.skinAdjust;
  if (digit === 'Digit1') {
    ctx.setSkinAdjust({ ...adjust, x: adjust.x + dx * step, y: adjust.y + dy * step });
    return;
  }
  if (digit === 'Digit2') {
    const scale = Math.min(2, Math.max(0.5, Math.round((adjust.scale + (dx - dy) * 0.01 * step) * 100) / 100));
    ctx.setSkinAdjust({ ...adjust, scale });
    return;
  }
  if (ctx.playState.view.hiSpeed.locked) return;
  changePlayView(ctx, {
    type: 'cover-adjust',
    part: 'lift',
    delta: -dy * 0.01 * step,
    side: digit === 'Digit6' ? '1P' : '2P',
  });
  ctx.theme.moment({ kind: 'view-setting', setting: 'lift', at: ctx.playClock() });
}

/** A control button's side and the button. */
function splitControlButton(button: ControlButton): [ControlSide, ControlSideButton] {
  const index = button.indexOf('-');
  return [button.slice(0, index) as ControlSide, button.slice(index + 1) as ControlSideButton];
}

/** The play's operations by the player's keys (`PlaySessionOptions.actionKeys`). */
export function playControlActions(ctx: PlayInputContext): ControlActionMap {
  const scheme = ctx.options.controlScheme ?? 'lr2';
  let actions = controlActionsByPlay.get(ctx);
  if (actions === undefined || actions.scheme !== scheme) {
    actions = resolveControlActions(scheme, ctx.options.actionKeys);
    controlActionsByPlay.set(ctx, actions);
  }
  return actions;
}

/** The control buttons of each play's keys, resolved once per play. */
const controlButtonsByPlay = new WeakMap<PlayInputContext, ControlButtonMap>();

function isStartOrSelect(button: ControlButton): boolean {
  return button.endsWith('-start') || button.endsWith('-select');
}

/**
 * Records a START / SELECT key going down or up in the replay (`ReplayPlay.controlInputs`), with the physical key. A key
 * the chart's lanes take is a lane, and a key typed into a field is the field's.
 */
export function recordControlKey(ctx: PlayInputContext, action: 'down' | 'up', event: KeyboardEvent): void {
  const signals = ctx.sharedEngineInputSignals;
  if (signals === undefined || event.repeat) return;
  const target = (event.composedPath?.()[0] ?? event.target) as HTMLElement | null;
  if (target?.isContentEditable === true || /^(INPUT|SELECT|TEXTAREA)$/u.test(target?.tagName ?? '')) return;
  const buttons = controlButtonsOfPlayKey(ctx, event).filter(isStartOrSelect);
  if (buttons.length === 0) return;
  const laneTokens = resolveLaneInputTokens(ctx.preparedChart?.laneBindings);
  if (keyboardEventToTokens(event).some((token) => laneTokens.has(token))) return;
  for (const button of buttons) signals.pushCommand({ kind: 'control-input', button, action, code: event.code });
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
