// The Debug Menu's compressor controls: every compressor's tuning, remembered across visits and handed to each play,
// and the per-stage folder, shown only where it applies. They run with the menu as `this` (`DebugMenu`).
import type { FolderApi } from 'tweakpane';
import {
  DEFAULT_COMPRESSOR_PARAMS,
  type CompressorParams,
  type TunableCompressor,
} from '@be-music/player-browser/audio';
import {
  TUNABLE_COMPRESSORS,
  defaultCompressorTunings,
  paramsFromTuning,
  storeCompressorTunings,
} from '../../compressor-tuning.ts';
import type { DebugMenu } from './index.ts';
/** Bus `CompressorParams` for every compressor, from the Debug Menu's tuning. */
export function resolveCompressorParamOverrides(this: DebugMenu): Record<TunableCompressor, CompressorParams> {
  return Object.fromEntries(
    TUNABLE_COMPRESSORS.map((compressor) => [
      compressor,
      paramsFromTuning(this.compressorTunings[compressor], DEFAULT_COMPRESSOR_PARAMS[compressor]),
    ]),
  ) as Record<TunableCompressor, CompressorParams>;
}
/**
 * Hide the per-stage `Key` / `BGM` / `Master` folder when it doesn't apply to the current state:
 *
 * - Compressor checkbox unchecked → bus is in `'off'` mode, every stage is bypassed already.
 * - `?compressor=legacy` → the legacy architecture has just one compressor; per-stage toggles don't map onto it.
 *
 * The native `hidden` property removes inapplicable stages from the pane.
 */
export function refreshCompressorStageVisibility(this: DebugMenu): void {
  const visible = this.guiState.compressor && this.compressorMode === 'split';
  if (this.compressorStageFolder) this.compressorStageFolder.hidden = !visible;
}
/**
 * One folder per compressor (key / BGM / master in split mode; the single legacy compressor only when the
 * `?compressor=legacy` architecture is active) with threshold, knee, ratio, attack, and release sliders and a reset.
 * Changes retune a running chart live and are remembered for the next visit.
 */
export function buildCompressorTuningGUI(this: DebugMenu, parent: FolderApi): void {
  const labels: Record<TunableCompressor, string> = {
    key: 'Key compressor',
    bgm: 'BGM compressor',
    master: 'Master compressor',
    legacy: 'Legacy compressor',
  };
  const compressors = TUNABLE_COMPRESSORS.filter((compressor) =>
    this.compressorMode === 'legacy' ? compressor === 'legacy' : compressor !== 'legacy',
  );
  for (const compressor of compressors) {
    const tuning = this.compressorTunings[compressor];
    const folder = parent.addFolder({ title: labels[compressor], expanded: false });
    const apply = () => {
      const params = paramsFromTuning(tuning, DEFAULT_COMPRESSOR_PARAMS[compressor]);
      this.gameplayView?.setAudioCompressorParams(compressor, params);
      storeCompressorTunings(this.compressorTunings);
    };
    const controllers = [
      folder.addBinding(tuning, 'thresholdDb', { label: 'Threshold (dB)', min: -60, max: 0, step: 0.5 }),
      folder.addBinding(tuning, 'kneeDb', { label: 'Knee (dB)', min: 0, max: 40, step: 0.5 }),
      folder.addBinding(tuning, 'ratio', { label: 'Ratio (x:1)', min: 1, max: 20, step: 0.1 }),
      folder.addBinding(tuning, 'attackMs', { label: 'Attack (ms)', min: 0, max: 200, step: 0.5 }),
      folder.addBinding(tuning, 'releaseMs', { label: 'Release (ms)', min: 0, max: 1000, step: 5 }),
    ];
    for (const controller of controllers) controller.on('change', apply);
    folder.addButton({ title: 'Reset to default' }).on('click', () => {
      Object.assign(tuning, defaultCompressorTunings()[compressor]);
      for (const controller of controllers) controller.refresh();
      apply();
    });
  }
}
