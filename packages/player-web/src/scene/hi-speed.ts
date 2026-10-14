/**
 * Hi-speed (note scroll multiplier) range shared by the select scenes' play-option panels, the gameplay scenes'
 * `ArrowUp` / `ArrowDown` hotkeys and hosts that remember the player's pick (e.g. the demo's Debug Menu). Visual only:
 * hi-speed changes how far apart notes are drawn, never when they are judged.
 */

/**
 * Hi-speed a play starts at when nothing else is picked — 2.0× rather than upstream beatoraja's `PlayConfig.java:16`
 * default of `1.0f` (see the rationale on the select scene's `DEFAULT_PLAY_OPTIONS.hiSpeed`).
 */
export const DEFAULT_HISPEED = 2.0;
/** Slowest selectable hi-speed. */
export const HISPEED_MIN = 0.1;
/** Fastest selectable hi-speed. */
export const HISPEED_MAX = 6.0;
/** One press of the in-game hotkey (and one click of the select panel's HS button). */
export const HISPEED_STEP = 0.1;

/**
 * Snaps `value` to the 1/1000 grid and clamps it to [{@link HISPEED_MIN}, {@link HISPEED_MAX}]. The snap absorbs the
 * float drift of repeated ±{@link HISPEED_STEP} steps (`0.1` has no exact IEEE-754 representation, so 13 presses would
 * otherwise land on `1.3000000000000003`). `NaN` / non-finite input returns `undefined` so callers keep their value.
 */
export function snapHiSpeed(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const snapped = Math.round(value * 1000) / 1000;
  return Math.max(HISPEED_MIN, Math.min(HISPEED_MAX, snapped));
}
