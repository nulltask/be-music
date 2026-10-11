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
