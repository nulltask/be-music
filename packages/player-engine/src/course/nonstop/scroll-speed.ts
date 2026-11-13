/** A SCROLL or SPEED keyframe on the stitched clock. */
export interface NonstopKeyframe {
  seconds: number;
  value: number;
}

/** How long before a stage's window ends a SPEED hold keyframe sits, so the ramp to the next stage does not show. */
const SPEED_HOLD_SECONDS = 0.001;

/**
 * One stage's SCROLL (`interpolate: false`) or SPEED (`interpolate: true`) keyframes, laid on the stitched clock for
 * its window, so the stage scrolls as it would alone:
 *
 * - at the window's start, the value in force there, when the stage changed it before or an earlier stage changed it
 *   (`carried`; a stage without keyframes then resets to 1);
 * - its own keyframes inside the window;
 * - for SPEED, which ramps linearly to the next keyframe, the value in force just before the window ends, so the
 *   stitched chart does not ramp into the next stage's value across the seam.
 *
 * `origin` is the stitched time of the stage's own time zero, where SPEED starts at 1 before its first keyframe.
 */
export function placeNonstopKeyframes(
  own: readonly NonstopKeyframe[],
  window: { start: number; end: number },
  options: { interpolate: boolean; carried: boolean; origin: number },
): NonstopKeyframe[] {
  const points = options.interpolate ? [{ seconds: options.origin, value: 1 }, ...own] : own;
  const valueAt = (seconds: number): number => {
    let index = -1;
    for (let next = 0; next < points.length && points[next]!.seconds <= seconds; next += 1) index = next;
    const current = points[index];
    if (current === undefined) return 1;
    const following = points[index + 1];
    if (!options.interpolate || following === undefined || following.seconds <= current.seconds) return current.value;
    const ratio = (seconds - current.seconds) / (following.seconds - current.seconds);
    return current.value + (following.value - current.value) * ratio;
  };
  const placed: NonstopKeyframe[] = [];
  const hasStart = Number.isFinite(window.start);
  if (hasStart && (options.carried || own.some((keyframe) => keyframe.seconds <= window.start)))
    placed.push({ seconds: window.start, value: valueAt(window.start) });
  placed.push(
    ...own.filter((keyframe) => (!hasStart || keyframe.seconds > window.start) && keyframe.seconds < window.end),
  );
  if (options.interpolate && Number.isFinite(window.end) && (placed.length > 0 || own.length > 0)) {
    const seconds = Math.max(hasStart ? window.start : 0, window.end - SPEED_HOLD_SECONDS);
    if (placed.every((keyframe) => keyframe.seconds < seconds)) placed.push({ seconds, value: valueAt(seconds) });
  }
  return placed;
}
