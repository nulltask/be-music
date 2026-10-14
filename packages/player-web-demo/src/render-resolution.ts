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

/** Median and 90th-percentile frame interval (ms) of a run of frames. */
export interface FrameTimes {
  p50: number;
  p90: number;
}

/** {@link FrameTimes} of `intervals` (ms between consecutive frames); zeros for an empty run. */
export function frameTimes(intervals: readonly number[]): FrameTimes {
  if (intervals.length === 0) return { p50: 0, p90: 0 };
  const sorted = [...intervals].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
  return { p50: at(0.5), p90: at(0.9) };
}

/** How far over the baseline frame time a resolution's 90th percentile may go and still count as keeping up. */
const KEEPS_UP_SLACK = 1.25;

/** Whether `times` keep up with the `baseline` frame interval (the one measured at the lowest resolution). */
export function keepsUp(times: FrameTimes, baseline: number): boolean {
  return times.p90 <= baseline * KEEPS_UP_SLACK;
}

export interface RenderResolutionBenchmark {
  /** The resolution picked: the highest that keeps up with the baseline, else the lowest. */
  chosen: number;
  /** Median frame interval at the lowest resolution, the frame rate the others are held to. */
  baseline: number;
  /** Frame times per resolution measured, lowest first, then from the highest down. */
  results: { resolution: number; times: FrameTimes }[];
}

export interface RenderResolutionBenchmarkOptions {
  /** Resolutions to try, ascending (see {@link renderResolutionSteps}). */
  steps: readonly number[];
  /** Renders at `resolution` from the next frame. */
  apply(resolution: number): void;
  /** Resolves with the timestamp of the next frame (`requestAnimationFrame`). */
  nextFrame(): Promise<number>;
  /** Called before each resolution is measured. */
  onStep?(resolution: number): void;
  /** Frames dropped after each switch, so the measure starts settled. */
  warmupFrames?: number;
  /** Frames measured per resolution. */
  sampleFrames?: number;
}

/**
 * Measures the frame rate at each resolution and picks the highest that keeps up. The lowest resolution is measured
 * first: its median frame interval is the baseline (the display's refresh when the GPU has room, slower when the CPU
 * is the limit, in which case resolution can't help and the highest that matches it is kept). The rest are tried from
 * the highest down, stopping at the first that keeps up. The chosen resolution is applied before it resolves.
 */
export async function benchmarkRenderResolution(
  options: RenderResolutionBenchmarkOptions,
): Promise<RenderResolutionBenchmark> {
  const { steps, apply, nextFrame, onStep, warmupFrames = 20, sampleFrames = 90 } = options;
  const results: RenderResolutionBenchmark['results'] = [];
  const measure = async (resolution: number): Promise<FrameTimes> => {
    onStep?.(resolution);
    apply(resolution);
    for (let i = 0; i < warmupFrames; i += 1) await nextFrame();
    const intervals: number[] = [];
    let last = await nextFrame();
    for (let i = 0; i < sampleFrames; i += 1) {
      const now = await nextFrame();
      intervals.push(now - last);
      last = now;
    }
    const times = frameTimes(intervals);
    results.push({ resolution, times });
    return times;
  };
  const lowest = steps[0]!;
  const baseline = (await measure(lowest)).p50;
  let chosen = lowest;
  for (let index = steps.length - 1; index > 0; index -= 1) {
    const resolution = steps[index]!;
    if (keepsUp(await measure(resolution), baseline)) {
      chosen = resolution;
      break;
    }
  }
  apply(chosen);
  return { chosen, baseline, results };
}
