/**
 * Swipe scrolling for the select list on touch screens: a finger dragged along the list moves the cursor one entry per
 * row it travels, and a touch that barely moves is a tap.
 */

/** How far (in CSS pixels) a finger travels before a touch counts as a drag instead of a tap. */
export const TOUCH_DRAG_THRESHOLD_PX = 10;

/** Whether a finger that moved (`dx`, `dy`) CSS pixels since touching down is dragging rather than tapping. */
export function isTouchDrag(dx: number, dy: number, threshold: number = TOUCH_DRAG_THRESHOLD_PX): boolean {
  return Math.hypot(dx, dy) > threshold;
}

/** Cursor steps a swipe produced so far, and the travel carried over toward the next step. */
export interface TouchScrollStep {
  readonly steps: number;
  readonly carry: number;
}

/**
 * Adds `delta` (design pixels the finger moved down since the last event) to `carry` and turns every whole `rowPitch`
 * into one cursor step. Dragging up (negative `delta`) moves the cursor forward, the way content follows the finger on
 * a touch list; dragging down moves it back. Non-positive pitches never step.
 */
export function stepTouchScroll(carry: number, delta: number, rowPitch: number): TouchScrollStep {
  if (!(rowPitch > 0)) return { steps: 0, carry: 0 };
  const travel = carry - delta;
  const steps = Math.trunc(travel / rowPitch) || 0;
  return { steps, carry: travel - steps * rowPitch };
}

/**
 * Whether a wheel event is one notch of a stepped mouse wheel rather than a slice of a smooth trackpad / free-spinning
 * wheel stream. Line- and page-mode events are notches; in pixel mode the legacy `wheelDeltaY` of a notch is a multiple
 * of 120, which a trackpad's small deltas almost never are.
 */
export function isWheelNotch(event: { deltaMode: number; deltaY: number; wheelDeltaY?: number }): boolean {
  if (event.deltaMode !== 0) return true;
  const legacy = event.wheelDeltaY;
  return legacy !== undefined && legacy !== 0 && legacy % 120 === 0;
}

/**
 * Wheel travel → cursor steps. Adds `deltaY` (CSS pixels, positive = scroll down / forward) to `carry` and turns every
 * whole `rowPitch` (CSS pixels the list moves per entry) into one step, so a trackpad scrolls the list as far as the
 * fingers move instead of one entry per event. A reversal drops the carry so the list answers the new direction at
 * once. Non-positive pitches never step.
 */
export function stepWheelScroll(carry: number, deltaY: number, rowPitch: number): TouchScrollStep {
  if (!(rowPitch > 0)) return { steps: 0, carry: 0 };
  const travel = (Math.sign(carry) === -Math.sign(deltaY) ? 0 : carry) + deltaY;
  const steps = Math.trunc(travel / rowPitch) || 0;
  return { steps, carry: travel - steps * rowPitch };
}

/** One finger position on the list: when (ms) and where (design pixels down the screen). */
export interface TouchSample {
  readonly at: number;
  readonly y: number;
}

/** How far back (ms) from the lift the release velocity looks. */
const RELEASE_WINDOW_MS = 100;

/**
 * The finger's velocity (design pixels per ms, positive = moving down) as it lifts: the travel over the last
 * {@link RELEASE_WINDOW_MS} of `samples` (oldest first). A finger that stopped before lifting, or too few samples, gives 0.
 */
export function releaseVelocity(samples: readonly TouchSample[], liftAt: number): number {
  const last = samples.at(-1);
  if (last === undefined || liftAt - last.at > RELEASE_WINDOW_MS / 2) return 0;
  let first = last;
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index]!;
    if (last.at - sample.at > RELEASE_WINDOW_MS) break;
    first = sample;
  }
  const span = last.at - first.at;
  return span > 0 ? (last.y - first.y) / span : 0;
}

/** Time constant (ms) of the fling's slowdown, about iOS's normal deceleration. */
const FLING_TIME_CONSTANT_MS = 325;

/** Below this speed (design pixels per ms) a fling stops. */
export const FLING_STOP_VELOCITY = 0.02;

/** Below this release speed (design pixels per ms) a lifted finger doesn't fling at all. */
export const FLING_START_VELOCITY = 0.1;

/**
 * Advances a fling by `dtMs`: the distance travelled (design pixels, same sign as `velocity`) and the velocity left
 * after exponential slowdown. The distance is the exact integral, so the fling covers the same ground at any frame rate.
 */
export function stepFling(velocity: number, dtMs: number): { distance: number; velocity: number } {
  if (!(dtMs > 0)) return { distance: 0, velocity };
  const decay = Math.exp(-dtMs / FLING_TIME_CONSTANT_MS);
  return { distance: velocity * FLING_TIME_CONSTANT_MS * (1 - decay), velocity: velocity * decay };
}
