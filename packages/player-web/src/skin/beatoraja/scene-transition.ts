// Per-scene fadeout transition primitive — mirrors upstream beatoraja's `TIMER_FADEOUT`
// + `Skin.getFadeout()` pattern shared across `MusicDecide.render` / `MusicResult.render`
// / `BMSPlayer.render` (STATE_FINISHED branch).
//
// Upstream's flow (verbatim from `decide/MusicDecide.java:25-32`):
//
//     if (timer.isTimerOn(TIMER_FADEOUT)) {
//         if (timer.getNowTime(TIMER_FADEOUT) > getSkin().getFadeout()) {
//             main.changeState(cancel ? MUSICSELECT : PLAY);
//         }
//     } else {
//         if (nowtime > getSkin().getScene()) {
//             timer.setTimerOn(TIMER_FADEOUT);
//         }
//     }
//
// In words:
//
//   1. Some scene-internal trigger (auto-advance after `Skin.scene` ms, user input, gameplay
//      end, ...) calls `setTimerOn(TIMER_FADEOUT)`. Skin elements gated on `timer == 2`
//      start animating from this stamp; the typical authored animation is a black overlay
//      sprite fading from `alpha 0 → alpha 1`, but the helper doesn't care — fading is
//      entirely skin-driven, the scene just owns the timing window.
//   2. The scene keeps rendering for the next `Skin.fadeout` ms so those skin animations
//      have time to play out.
//   3. After `Skin.fadeout` ms have elapsed, the scene fires its hand-off callback (the
//      JS equivalent of `main.changeState(...)`) — exactly once, regardless of how many
//      additional ticks happen.
//
// The helper centralizes this state machine so each scene (decide / result / gameplay-end)
// uses the same primitive instead of re-rolling the bookkeeping. Inputs received AFTER
// `begin()` are ignored — upstream `MusicResult.render` does the same via the
// `if (timer.isTimerOn(TIMER_FADEOUT))` short-circuit.
//
// Why this lives in the player-web package rather than beatoraja-skin: the parsed skin
// only exposes the timing fields (`scene`, `input`, `fadeout`); driving them requires a
// per-frame ticker + a way to invoke the host's scene-swap, both of which are renderer-
// layer concerns.

import { TIMER_FADEOUT } from '@be-music/beatoraja-skin';

/**
 * Default fadeout window when the skin omits the field. Matches upstream's `select.json` /
 * `decidemain.lua` / `resultmain.lua` reference values (all 500 ms). Beatoraja's `Skin`
 * class declares `private int fadeout` with no initializer — Java default-initializes to
 * 0, which would mean "transition instantly". The skin always ships a value (the default
 * theme uses 500), so falling through to 0 means an unauthored skin would skip the
 * transition window entirely. Using 500 here matches the visible behavior every reference
 * skin produces and keeps un-authored / hand-rolled test fixtures behaving consistently.
 */
export const DEFAULT_BEATORAJA_FADEOUT_MS = 500;

export interface BeatorajaSceneTransitionOptions {
  /**
   * Skin's `fadeout` field (ms) — duration of the fadeout window from `begin()` to the
   * `onComplete` hand-off. Mirrors upstream `Skin.getFadeout()`. When unset / non-positive,
   * falls through to {@link DEFAULT_BEATORAJA_FADEOUT_MS}.
   */
  fadeoutMs?: number;
  /**
   * Per-frame elapsed ms (e.g. `performance.now() - this.startMs`). The helper polls this
   * to compare against `fadeoutStampedAtMs + fadeoutMs`. Driven by the SCENE'S clock so a
   * tab-backgrounded ticker pause doesn't fire the transition while the user wasn't
   * watching — `performance.now()` keeps advancing in the background, but the scene's
   * `tick()` doesn't run, so the helper's `tick()` doesn't run either, and the elapsed
   * comparison only happens when the scene is foregrounded again.
   */
  getElapsedMs: () => number;
  /**
   * Stamp callback — invoked once when {@link begin} fires. The scene records the timer
   * start in its own `timerStartedAt` map so skin elements gated on `timer = 2`
   * (TIMER_FADEOUT) animate against it. Receives the elapsed ms at stamp time.
   *
   * @param timerId  Always {@link TIMER_FADEOUT} (2). Plumbed through so the call site
   *                 doesn't need a separate import to call `set`.
   * @param atMs     Elapsed scene ms at stamp time.
   */
  stampFadeoutTimer: (timerId: number, atMs: number) => void;
  /**
   * Fired exactly once when the fadeout window elapses. The scene calls its host-supplied
   * `onContinue` / `onCancel` / etc. from inside this callback. Subsequent {@link tick}
   * calls no-op.
   */
  onComplete: () => void;
}

/**
 * Drives the `begin → tick → onComplete` lifecycle for one fadeout window. Construct
 * once per scene `enter()`; call {@link begin} on the trigger event (auto-advance / user
 * input / gameplay end), call {@link tick} every frame, and the helper fires
 * {@link BeatorajaSceneTransitionOptions.onComplete} exactly once after the configured
 * window elapses.
 */
export class BeatorajaSceneTransition {
  private readonly options: BeatorajaSceneTransitionOptions;
  /** Elapsed ms at which `begin()` was last called. `undefined` = not yet begun. */
  private fadeoutStampedAtMs: number | undefined;
  /** True after `onComplete` has fired. Guards against double-invocation. */
  private completed = false;

  constructor(options: BeatorajaSceneTransitionOptions) {
    this.options = options;
  }

  /**
   * Effective fadeout window in ms. Reads {@link BeatorajaSceneTransitionOptions.fadeoutMs}
   * with a {@link DEFAULT_BEATORAJA_FADEOUT_MS} fallback. Non-finite / negative values are
   * treated as "field unset" and fall through to the default.
   */
  get fadeoutWindowMs(): number {
    const raw = this.options.fadeoutMs;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
      return DEFAULT_BEATORAJA_FADEOUT_MS;
    }
    return raw;
  }

  /**
   * Begin the fadeout window. Idempotent — subsequent calls are no-ops, mirroring
   * upstream's `if (timer.isTimerOn(TIMER_FADEOUT))` short-circuit (the timer is set ONCE
   * per scene; further `setTimerOn` calls don't re-stamp the start).
   */
  begin(): void {
    if (this.fadeoutStampedAtMs !== undefined) return;
    if (this.completed) return;
    const elapsed = this.options.getElapsedMs();
    this.fadeoutStampedAtMs = elapsed;
    this.options.stampFadeoutTimer(TIMER_FADEOUT, elapsed);
  }

  /**
   * Per-frame poll. When the fadeout has begun AND the elapsed ms since the stamp meets /
   * exceeds {@link fadeoutWindowMs}, fires `onComplete` once and latches.
   *
   * Edge case: if the configured window is 0 (skin authored `fadeout = 0` or unset and
   * the fallback was overridden), `begin()` + the very next `tick()` complete in the same
   * frame. This matches upstream's `getNowTime(TIMER_FADEOUT) > skin.getFadeout()` logic
   * — `> 0` becomes true the moment the timer starts ticking past zero.
   */
  tick(): void {
    if (this.completed) return;
    if (this.fadeoutStampedAtMs === undefined) return;
    const elapsed = this.options.getElapsedMs();
    const sinceStamp = elapsed - this.fadeoutStampedAtMs;
    if (sinceStamp >= this.fadeoutWindowMs) {
      this.completed = true;
      this.options.onComplete();
    }
  }

  /**
   * True after {@link begin} has been called and before `onComplete` fires. Scenes use
   * this to short-circuit further input handling — once the fadeout has started, additional
   * Enter/Escape presses shouldn't re-trigger the transition (matching upstream's gating
   * on `if (timer.isTimerOn(TIMER_FADEOUT))`).
   */
  isFadingOut(): boolean {
    return this.fadeoutStampedAtMs !== undefined && !this.completed;
  }

  /** True after `onComplete` has fired. Useful for assertion-style tests. */
  isCompleted(): boolean {
    return this.completed;
  }
}
