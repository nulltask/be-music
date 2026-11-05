import { monitorFrameRate } from '../../pane-controls.ts';
import { getBrowserWorkerCount, setBrowserWorkerCount } from '@be-music/player-browser/compute';
import { storeWorkerCount } from '../../worker-settings.ts';
// The Options dialog's Advanced folder. It is built with the dialog as `this` (`OptionsDialog`).
import type { OptionContainer } from '../options-controls.ts';
import { OPTION_FOLDERS } from './folders.ts';
import type { OptionsDialog } from './index.ts';
import { buildBGATranscodeFolder } from './library.ts';
/**
 * Diagnostics, session behaviour and the BGA transcode, which most players never touch, plus the reset for every
 * remembered setting.
 */
export function buildDeveloperFolder(this: OptionsDialog, developer: OptionContainer): void {
  const compute = { workers: getBrowserWorkerCount() };
  developer
    .addBinding(compute, 'workers', {
      label: 'CPU workers',
      min: 1,
      max: Math.max(1, navigator.hardwareConcurrency || 2),
      step: 1,
    })
    .on('change', ({ value: count }) => {
      setBrowserWorkerCount(count);
      try {
        storeWorkerCount(globalThis.localStorage, getBrowserWorkerCount());
      } catch {
        /* Storage can be disabled. */
      }
    });
  developer.addBinding(this.guiState, 'autoPauseOnBlur', { label: 'Auto pause on blur' }).on('change', ({ value }) => {
    this.guiState.autoPauseOnBlur = value;
    // Push live so a chart already in flight starts honoring the new policy on its next visibility / blur event,
    // without forcing the user to restart the song.
    this.gameplayView?.setAutoPauseOnBlur(value);
  });
  // Native monitor samples the scene clock and keeps a bounded FPS history.
  const sceneHost = this.sceneHost;
  const stats = {
    get fps(): number {
      return monitorFrameRate(sceneHost.app.ticker);
    },
  };
  developer.addBinding(stats, 'fps', {
    label: 'FPS',
    readonly: true,
    view: 'graph',
    min: 0,
    max: 240,
    interval: 500,
    bufferSize: 60,
  });
  buildBGATranscodeFolder.call(this, developer.addFolder(OPTION_FOLDERS.bgaTranscode));
  developer.addButton({ title: 'Reset settings and reload' }).on('click', () => {
    void this.resetSettings();
  });
}
