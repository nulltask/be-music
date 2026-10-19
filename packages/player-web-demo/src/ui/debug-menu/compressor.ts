// The Debug Menu's compressor controls: every compressor's tuning, remembered across visits and handed to each play,
// and the per-stage folder, shown only where it applies. They run with the menu as `this` (`DebugMenu`).

import type { GUI } from 'lil-gui';
import { DEFAULT_COMPRESSOR_PARAMS, type CompressorParams, type TunableCompressor } from '@be-music/player-web/audio';
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
 * lil-gui's `show(false)` collapses the folder out of the panel entirely, matching the previous `display: none`
 * behavior.
 */
export function refreshCompressorStageVisibility(this: DebugMenu): void {
  const visible = this.guiState.compressor && this.compressorMode === 'split';
  this.compressorStageFolder?.show(visible);
}

/**
 * One folder per compressor (key / BGM / master in split mode; the single legacy compressor only when the
 * `?compressor=legacy` architecture is active) with threshold, knee, ratio, attack, and release sliders and a reset.
 * Changes retune a running chart live and are remembered for the next visit.
 */
export function buildCompressorTuningGUI(this: DebugMenu, parent: GUI): void {
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
    const folder = parent.addFolder(labels[compressor]).close();
    const apply = () => {
      const params = paramsFromTuning(tuning, DEFAULT_COMPRESSOR_PARAMS[compressor]);
      this.gameplayView?.setAudioCompressorParams(compressor, params);
      storeCompressorTunings(this.compressorTunings);
    };
    const controllers = [
      folder.add(tuning, 'thresholdDb', -60, 0, 0.5).name('Threshold (dB)'),
      folder.add(tuning, 'kneeDb', 0, 40, 0.5).name('Knee (dB)'),
      folder.add(tuning, 'ratio', 1, 20, 0.1).name('Ratio (x:1)'),
      folder.add(tuning, 'attackMs', 0, 200, 0.5).name('Attack (ms)'),
      folder.add(tuning, 'releaseMs', 0, 1000, 5).name('Release (ms)'),
    ];
    for (const controller of controllers) controller.onChange(apply);
    folder
      .add(
        {
          reset: () => {
            Object.assign(tuning, defaultCompressorTunings()[compressor]);
            for (const controller of controllers) controller.updateDisplay();
            apply();
          },
        },
        'reset',
      )
      .name('Reset to default');
  }
}
