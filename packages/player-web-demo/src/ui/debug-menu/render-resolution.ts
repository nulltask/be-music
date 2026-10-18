// The Debug Menu's render resolution auto-detect: the first-run benchmark of the select screen and the "Auto-detect
// resolution" button (`benchmarkRenderResolution`). They run with the menu as `this` (`DebugMenu`).

import { logger } from '@be-music/player-web';
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

/**
 * Before the player has picked a render resolution (by hand or by an earlier benchmark), benchmarks the select screen
 * once, after it settles, to pick one for this device. Skipped where there's nothing to choose (a 1× display) and
 * when `?resolution=` pins it.
 */
export function scheduleFirstRunResolutionDetect(this: DebugMenu): void {
  if (this.firstRunResolutionScheduled) return;
  this.firstRunResolutionScheduled = true;
  if (readStoredRenderResolution() !== undefined) return;
  if (new URLSearchParams(window.location.search).has('resolution')) return;
  if (renderResolutionSteps(window.devicePixelRatio || 1).length < 2) return;
  const selectView = this.selectView;
  window.setTimeout(() => {
    // Gone on to a play already: measuring gameplay that just started would mislead, so wait for the next visit.
    if (this.selectView !== selectView || selectView?.entered !== true || readStoredRenderResolution() !== undefined) {
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
export async function detectRenderResolution(this: DebugMenu, options: { whileShowing?: unknown } = {}): Promise<void> {
  const steps = renderResolutionSteps(window.devicePixelRatio || 1);
  if (this.detectingResolution || steps.length < 2) return;
  this.detectingResolution = true;
  const control = this.autoDetectResolutionControl;
  control?.disable();
  this.resolutionPicker?.disable();
  try {
    const result = await benchmarkRenderResolution({
      steps,
      apply: (value) => this.sceneHost.setResolution(value),
      nextFrame: () => new Promise((resolve) => requestAnimationFrame(resolve)),
      onStep: (value) => control?.name(`Measuring ${renderResolutionLabel(value)}…`),
      cancelled: () =>
        document.visibilityState !== 'visible' ||
        (options.whileShowing !== undefined &&
          (this.selectView !== options.whileShowing || this.selectView?.entered !== true)),
    });
    this.guiState.renderResolution = result.chosen;
    storeRenderResolution(result.chosen);
    this.resolutionPicker?.updateDisplay();
    resolutionLog.info('picked', {
      chosen: result.chosen,
      baselineMs: result.baseline,
      results: result.results.map(
        ({ resolution, times }) => `${resolution}×: p50 ${times.p50.toFixed(1)} ms, p90 ${times.p90.toFixed(1)} ms`,
      ),
    });
    control?.name(`${AUTO_DETECT_RESOLUTION_LABEL} (picked ${renderResolutionLabel(result.chosen)})`);
  } catch (error) {
    if (!(error instanceof RenderResolutionBenchmarkCancelled)) resolutionLog.warn('auto-detect failed', error);
    this.sceneHost.setResolution(this.guiState.renderResolution);
    control?.name(AUTO_DETECT_RESOLUTION_LABEL);
  } finally {
    this.detectingResolution = false;
    control?.enable();
    this.resolutionPicker?.enable();
  }
}
