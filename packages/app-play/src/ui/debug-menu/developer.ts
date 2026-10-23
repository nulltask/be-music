import { selectBinding, monitorFrameRate } from '../../pane-controls.ts';
import { getBrowserWorkerCount, setBrowserWorkerCount } from '@be-music/player-browser/compute';
import { storeWorkerCount } from '../../worker-settings.ts';
// The Debug Menu's Developer folder. It is built with the menu as `this` (`DebugMenu`).
import type { FolderApi } from 'tweakpane';
import type { DebugMenu } from './index.ts';
/** Diagnostics and session behaviour most players never touch, plus the reset for every remembered setting. */
export function buildDeveloperFolder(this: DebugMenu, developer: FolderApi): void {
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
  // The judge ruleset — no in-skin counterpart; the Debug Menu is its only surface. It switches every judge rule
  // (windows, note selection, empty POOR, long notes, gauge, score — see docs/replay.md).
  this.trackPlayOption(
    selectBinding(developer, this.guiState, 'judgeRuleset', 'Judgment windows', {
      LR2: 'lr2',
      beatoraja: 'beatoraja',
      '????': '____',
    }).on('change', () => this.deps.refreshSelectRecords()),
  );
  developer.addBinding(this.guiState, 'autoPauseOnBlur', { label: 'Auto pause on blur' }).on('change', ({ value }) => {
    this.guiState.autoPauseOnBlur = value;
    // Push live so a chart already in flight starts honoring the new policy on its next visibility / blur event,
    // without forcing the user to restart the song.
    this.gameplayView?.setAutoPauseOnBlur(value);
  });
  // Chart-authoring debug overlay — paints invisible / keysound notes (BMS channels `3x` / `4x`) as thin green bars
  // in their playable lane. Live-toggleable — the gameplay view always extracts the invisible-note array and preloads
  // the green sprite, so flipping this flag flips the per-frame render branch on the very next paint.
  developer
    .addBinding(this.guiState, 'showInvisibleNotes', { label: 'Show invisible notes' })
    .on('change', ({ value }) => {
      this.guiState.showInvisibleNotes = value;
      this.gameplayView?.setShowInvisibleNotes(value);
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
  developer.addButton({ title: 'Reset settings and reload' }).on('click', () => {
    void this.resetSettings();
  });
}
