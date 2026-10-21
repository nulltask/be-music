import { setDisabled, setButtonTitle } from '../../pane-controls.ts';
// The Debug Menu's render resolution auto-detect: the first-run benchmark of the select screen and the "Auto-detect
// resolution" button (`benchmarkRenderResolution`). They run with the menu as `this` (`DebugMenu`).
import { logger } from '@be-music/player-browser';
import {
  benchmarkRenderResolution,
  RenderResolutionBenchmarkCancelled,
  readStoredRenderResolution,
  renderResolutionLabel,
  renderResolutionSteps,
  storeRenderResolution,
} from '../../render-resolution.ts';
import type { DebugMenu } from './index.ts';
const resolutionLog = logger('render-resolution');
export const AUTO_DETECT_RESOLUTION_LABEL = 'Auto-detect resolution';
/** How long the select screen settles (song images, fonts, first BGM) before the first-run resolution benchmark. */
const FIRST_RUN_RESOLUTION_DELAY_MS = 2000;
/** What the benchmark asks of the select screen it measures. */
export interface MeasuredSelectScreen {
  /** Whether it is on the stage (between its enter and exit). */
  readonly entered: boolean;
}
/**
 * Whether this visit benchmarks the render resolution on its own: only before the player has picked one (by hand or by
 * an earlier benchmark, `stored`), not when `?resolution=` in `search` pins it, and not where there's nothing to choose
 * (a 1× display).
 */
export function wantsFirstRunResolutionDetect(visit: {
  readonly stored: number | undefined;
  readonly search: string;
  readonly devicePixelRatio: number;
}): boolean {
  if (visit.stored !== undefined) return false;
  if (new URLSearchParams(visit.search).has('resolution')) return false;
  return renderResolutionSteps(visit.devicePixelRatio || 1).length >= 2;
}
/** Whether `measured` is still the select screen showing: the select screen now, and on the stage. */
export function isStillShowing(measured: unknown, select: MeasuredSelectScreen | undefined): boolean {
  return select !== undefined && select === measured && select.entered;
}
/**
 * Whether a benchmark run stops: when the page is hidden (a hidden page's frames are throttled), and, for a run that
 * measures a select screen (`whileShowing`), once that screen is no longer the one showing.
 */
export function isResolutionDetectCancelled(state: {
  readonly visible: boolean;
  readonly whileShowing?: unknown;
  readonly select: MeasuredSelectScreen | undefined;
}): boolean {
  return !state.visible || (state.whileShowing !== undefined && !isStillShowing(state.whileShowing, state.select));
}
/**
 * Before the player has picked a render resolution (by hand or by an earlier benchmark), benchmarks the select screen
 * once, after it settles, to pick one for this device. Skipped where there's nothing to choose (a 1× display) and
 * when `?resolution=` pins it.
 */
export function scheduleFirstRunResolutionDetect(this: DebugMenu): void {
  if (this.firstRunResolutionScheduled) return;
  this.firstRunResolutionScheduled = true;
  const visit = {
    stored: readStoredRenderResolution(),
    search: window.location.search,
    devicePixelRatio: window.devicePixelRatio,
  };
  if (!wantsFirstRunResolutionDetect(visit)) return;
  const selectView = this.selectView;
  window.setTimeout(() => {
    // Gone on to a play already: measuring gameplay that just started would mislead, so wait for the next visit.
    if (!isStillShowing(selectView, this.selectView) || readStoredRenderResolution() !== undefined) {
      return;
    }
    void this.detectRenderResolution({ whileShowing: selectView });
  }, FIRST_RUN_RESOLUTION_DELAY_MS);
}
/**
 * Measures the frame rate at each resolution on the screen being shown and keeps (and stores) the highest that holds
 * it. With `whileShowing`, the run is dropped — nothing stored, the previous resolution back — once that view is no
 * longer the select screen; any run is dropped when the page is hidden, since a hidden page's frames are throttled.
 */
export async function detectRenderResolution(
  this: DebugMenu,
  options: {
    whileShowing?: unknown;
  } = {},
): Promise<void> {
  const steps = renderResolutionSteps(window.devicePixelRatio || 1);
  if (this.detectingResolution || steps.length < 2) return;
  this.detectingResolution = true;
  const control = this.autoDetectResolutionControl;
  setDisabled(control, true);
  setDisabled(this.resolutionPicker, true);
  try {
    const result = await benchmarkRenderResolution({
      steps,
      apply: (value) => this.sceneHost.setResolution(value),
      nextFrame: () => new Promise((resolve) => requestAnimationFrame(resolve)),
      onStep: (value) => setButtonTitle(control, `Measuring ${renderResolutionLabel(value)}…`),
      cancelled: () =>
        isResolutionDetectCancelled({
          visible: document.visibilityState === 'visible',
          whileShowing: options.whileShowing,
          select: this.selectView,
        }),
    });
    this.guiState.renderResolution = result.chosen;
    storeRenderResolution(result.chosen);
    this.resolutionPicker?.refresh();
    resolutionLog.info('picked', {
      chosen: result.chosen,
      baselineMs: result.baseline,
      results: result.results.map(
        ({ resolution, times }) => `${resolution}×: p50 ${times.p50.toFixed(1)} ms, p90 ${times.p90.toFixed(1)} ms`,
      ),
    });
    setButtonTitle(control, `${AUTO_DETECT_RESOLUTION_LABEL} (picked ${renderResolutionLabel(result.chosen)})`);
  } catch (error) {
    if (!(error instanceof RenderResolutionBenchmarkCancelled)) resolutionLog.warn('auto-detect failed', error);
    this.sceneHost.setResolution(this.guiState.renderResolution);
    setButtonTitle(control, AUTO_DETECT_RESOLUTION_LABEL);
  } finally {
    this.detectingResolution = false;
    setDisabled(control, false);
    setDisabled(this.resolutionPicker, false);
  }
}
