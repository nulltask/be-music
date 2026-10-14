/**
 * The demo's render resolution setting (canvas pixels per CSS pixel): the Debug Menu offers 1× up to the display's
 * `devicePixelRatio` in 0.5 steps, and the pick is remembered. Without a stored pick the player renders at 1.5×: full
 * density at 2× and above made tablets fill-rate bound (under 30 fps on iPad, 60 fps at 1.5×).
 */

export const RENDER_RESOLUTION_STORAGE_KEY = 'be-music-demo.render-resolution';

/** Resolution used until the player picks one. */
export const DEFAULT_RENDER_RESOLUTION = 1.5;

const STEP = 0.5;
const MIN = 1;

/**
 * The resolutions offered on a display of `devicePixelRatio`: 1, 1.5, 2, … up to the display's ratio, which closes the
 * list when it falls between steps (e.g. 2.625 on some phones). A display at or below 1× offers its own ratio only.
 */
export function renderResolutionSteps(devicePixelRatio: number): number[] {
  const native = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  if (native <= MIN) return [native];
  const steps: number[] = [];
  for (let value = MIN; value < native; value += STEP) steps.push(value);
  steps.push(native);
  return steps;
}

/** The step in `steps` closest to `value` (the lower one on a tie). */
export function nearestRenderResolution(steps: readonly number[], value: number): number {
  let best = steps[0]!;
  for (const step of steps) if (Math.abs(step - value) < Math.abs(best - value)) best = step;
  return best;
}

/** The label a step shows in the Debug Menu, e.g. `1.5×`. */
export function renderResolutionLabel(value: number): string {
  return `${Number(value.toFixed(3))}×`;
}

/** The stored resolution as a number, or the default when none is stored or it isn't a positive number. */
export function parseStoredRenderResolution(stored: string | null): number {
  const value = stored === null || stored.trim() === '' ? Number.NaN : Number(stored);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_RENDER_RESOLUTION;
}

export function readStoredRenderResolution(): number {
  try {
    return parseStoredRenderResolution(window.localStorage.getItem(RENDER_RESOLUTION_STORAGE_KEY));
  } catch {
    // Storage blocked — use the default.
    return DEFAULT_RENDER_RESOLUTION;
  }
}

export function storeRenderResolution(value: number): void {
  try {
    window.localStorage.setItem(RENDER_RESOLUTION_STORAGE_KEY, String(value));
  } catch {
    // Private windows / blocked storage: the pick still applies for this session.
  }
}
