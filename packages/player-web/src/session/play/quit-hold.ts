/**
 * Hold-to-quit for the gameplay scenes: holding Backspace for {@link QUIT_HOLD_THRESHOLD_MS} quits the play the same
 * way Escape does. It exists because Escape collides with the browser's own "leave fullscreen" key — Backspace works
 * everywhere, fullscreen or not. A tap does nothing, so a stray press mid-play cannot end it.
 *
 * The state functions are pure (time is an input); {@link QuitHoldController} wires them to key events with an
 * injected clock and timer so the scenes and the tests share one implementation.
 */

/** `KeyboardEvent.code` of the hold-to-quit key. */
export const QUIT_HOLD_KEY_CODE = 'Backspace';

/** How long the quit key must stay held before the play quits. */
export const QUIT_HOLD_THRESHOLD_MS = 500;

/** `pressedAtMs` is when the current hold started, or `null` when the key is up. */
export type QuitHoldState = { readonly pressedAtMs: number | null };

export const IDLE_QUIT_HOLD: QuitHoldState = { pressedAtMs: null };

/**
 * Starts a hold at `nowMs`. A key-repeat event never starts one (the key was already down when the scene began
 * listening — e.g. held over from the select screen, where Backspace backs out of a folder), and neither repeats nor
 * a second press restart a hold that is already running.
 */
export function pressQuitHold(state: QuitHoldState, nowMs: number, repeat: boolean): QuitHoldState {
  if (repeat || state.pressedAtMs !== null) return state;
  return { pressedAtMs: nowMs };
}

/** Releasing the key (or losing focus) drops the hold. */
export function releaseQuitHold(): QuitHoldState {
  return IDLE_QUIT_HOLD;
}

/** Milliseconds left until the running hold completes; `null` when no hold is running. Never negative. */
export function quitHoldRemainingMs(
  state: QuitHoldState,
  nowMs: number,
  thresholdMs: number = QUIT_HOLD_THRESHOLD_MS,
): number | null {
  if (state.pressedAtMs === null) return null;
  return Math.max(0, state.pressedAtMs + thresholdMs - nowMs);
}

/** Whether the running hold has lasted the threshold at `nowMs`. */
export function isQuitHoldComplete(
  state: QuitHoldState,
  nowMs: number,
  thresholdMs: number = QUIT_HOLD_THRESHOLD_MS,
): boolean {
  return quitHoldRemainingMs(state, nowMs, thresholdMs) === 0;
}

export type QuitHoldKeyEvent = Pick<KeyboardEvent, 'code' | 'repeat' | 'preventDefault'> & {
  readonly target?: EventTarget | null;
};

export interface QuitHoldControllerOptions {
  /** Called once when a hold completes. */
  onComplete: () => void;
  /** Clock in milliseconds (the scenes pass `performance.now`). */
  now: () => number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancelScheduled?: (handle: unknown) => void;
  thresholdMs?: number;
}

/** True for a focused text field, where Backspace edits text instead of quitting. */
function isEditableTarget(target: EventTarget | null | undefined): boolean {
  if (target === null || target === undefined) return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof element.tagName === 'string' ? element.tagName : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable === true;
}

/**
 * Drives one hold-to-quit key for a gameplay scene: feed it the scene's `keydown` / `keyup` events and call
 * {@link QuitHoldController.cancel} when the window loses focus or the scene goes away.
 */
export class QuitHoldController {
  private state: QuitHoldState = IDLE_QUIT_HOLD;
  private timer: unknown = undefined;
  private readonly options: QuitHoldControllerOptions;

  constructor(options: QuitHoldControllerOptions) {
    this.options = options;
  }

  /** Whether a hold is running. */
  isHolding(): boolean {
    return this.state.pressedAtMs !== null;
  }

  /**
   * Handles a `keydown`. Returns `true` when the event is the quit key (it is then `preventDefault`ed so the browser
   * does not navigate back), `false` for every other key and for a quit key typed into a text field.
   */
  handleKeyDown(event: QuitHoldKeyEvent): boolean {
    if (event.code !== QUIT_HOLD_KEY_CODE || isEditableTarget(event.target)) return false;
    event.preventDefault();
    const wasHolding = this.isHolding();
    this.state = pressQuitHold(this.state, this.options.now(), event.repeat);
    if (!wasHolding && this.isHolding()) this.arm();
    return true;
  }

  /** Handles a `keyup`. Returns `true` when the event is the quit key. Releasing before the threshold cancels. */
  handleKeyUp(event: Pick<KeyboardEvent, 'code'>): boolean {
    if (event.code !== QUIT_HOLD_KEY_CODE) return false;
    this.cancel();
    return true;
  }

  /** Drops a running hold without quitting. */
  cancel(): void {
    this.state = releaseQuitHold();
    this.clearTimer();
  }

  private arm(): void {
    this.clearTimer();
    const remaining = quitHoldRemainingMs(this.state, this.options.now(), this.options.thresholdMs);
    if (remaining === null) return;
    const schedule = this.options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.timer = schedule(() => {
      this.timer = undefined;
      if (!this.isHolding()) return;
      // A timer can fire a hair early; wait out the rest instead of quitting short of the threshold.
      if (!isQuitHoldComplete(this.state, this.options.now(), this.options.thresholdMs)) {
        this.arm();
        return;
      }
      this.state = releaseQuitHold();
      this.options.onComplete();
    }, remaining);
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    const cancelScheduled =
      this.options.cancelScheduled ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    cancelScheduled(this.timer);
    this.timer = undefined;
  }
}
