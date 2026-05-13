import type { LoadProgress } from '@be-music/player-web/collection';
import { phaseLabels } from './demo-utils.ts';

/**
 * DOM handles the loading-overlay controller writes into. Subset of {@link PlayerWebDemoElements} so callers only need
 * to forward the four overlay-specific elements rather than the whole demo element bundle.
 */
export interface LoadingOverlayElements {
  loadingOverlay: HTMLDivElement;
  loadingLabel: HTMLDivElement;
  loadingBarFill: HTMLDivElement;
  loadingCounter: HTMLDivElement;
}

/**
 * Reveals the centered loading overlay and resets its readout to a neutral "Loading…" state. The actual phase / counter
 * text fills in via {@link applyLoadProgress} as events fire from the loaders.
 */
export function showLoadingOverlay(elements: LoadingOverlayElements): void {
  elements.loadingOverlay.classList.add('visible');
  elements.loadingOverlay.setAttribute('aria-hidden', 'false');
  elements.loadingLabel.textContent = 'Loading…';
  elements.loadingCounter.textContent = '';
  // Reset to indeterminate (no inline width) until the first `applyLoadProgress` lands. The CSS animates the bar so
  // the user sees motion even before the first phase event fires.
  elements.loadingBarFill.classList.add('indeterminate');
  elements.loadingBarFill.style.width = '';
}

export function hideLoadingOverlay(elements: LoadingOverlayElements): void {
  elements.loadingOverlay.classList.remove('visible');
  elements.loadingOverlay.setAttribute('aria-hidden', 'true');
}

/**
 * Maps a `LoadProgress` event from the player-web loaders onto the overlay DOM. Phases:
 *
 * - `enumerating` — total is `-1` (we're still walking the drop tree). Show the running file count + the current
 *   path, leave the bar in indeterminate animation mode.
 * - `reading` / `parsing` / `theme` — total is known. Switch the bar to determinate mode and set its width to
 *   `current / total`.
 *
 * Phase prefixes (`Reading files…` etc.) come from the `phaseLabels` map; the per-item label surfaces the underlying
 * filename / sub-task so the user can see which file is the current bottleneck.
 */
export function applyLoadProgress(elements: LoadingOverlayElements, progress: LoadProgress): void {
  const phaseLabel = phaseLabels[progress.phase];
  const counterFragments: string[] = [];
  if (progress.total > 0) {
    // Determinate phase — set explicit width and pin the counter to "X / N (P%)" so the user can eyeball ETA.
    const ratio = Math.max(0, Math.min(1, progress.current / progress.total));
    elements.loadingBarFill.classList.remove('indeterminate');
    elements.loadingBarFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    counterFragments.push(`${progress.current} / ${progress.total}`);
  } else {
    // Indeterminate (enumeration) — only `current` is meaningful.
    elements.loadingBarFill.classList.add('indeterminate');
    elements.loadingBarFill.style.width = '';
    if (progress.current > 0) {
      counterFragments.push(`${progress.current}`);
    }
  }
  if (progress.label) {
    counterFragments.push(progress.label);
  }
  elements.loadingLabel.textContent = phaseLabel;
  elements.loadingCounter.textContent = counterFragments.join(' · ');
}
