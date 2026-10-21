import { getBrowserWorkerCount, setBrowserWorkerCount } from '@be-music/player-browser/compute';
import { storeWorkerCount } from '../../worker-settings.ts';
// The Debug Menu's Developer folder. It is built with the menu as `this` (`DebugMenu`).

import type { GUI } from 'lil-gui';
import { clearDemoSettings } from './folders.ts';
import type { DebugMenu } from './index.ts';

/** Diagnostics and session behaviour most players never touch, plus the reset for every remembered setting. */
export function buildDeveloperFolder(this: DebugMenu, developer: GUI): void {
  const compute = { workers: getBrowserWorkerCount() };
  developer
    .add(compute, 'workers', 1, Math.max(1, navigator.hardwareConcurrency || 2), 1)
    .name('CPU workers')
    .onChange((count: number) => {
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
    developer
      .add(this.guiState, 'judgeRuleset', { LR2: 'lr2', beatoraja: 'beatoraja', IIDX: 'iidx' })
      .name('Judgment windows')
      // Each ruleset keeps its own best records: the select screen switches to the new ruleset's.
      .onChange(() => this.deps.refreshSelectRecords()),
  );

  developer
    .add(this.guiState, 'autoPauseOnBlur')
    .name('Auto pause on blur')
    .onChange((value: boolean) => {
      this.guiState.autoPauseOnBlur = value;
      // Push live so a chart already in flight starts honoring the new policy on its next visibility / blur event,
      // without forcing the user to restart the song.
      this.gameplayView?.setAutoPauseOnBlur(value);
    });
  // Chart-authoring debug overlay — paints invisible / keysound notes (BMS channels `3x` / `4x`) as thin green bars
  // in their playable lane. Live-toggleable — the gameplay view always extracts the invisible-note array and preloads
  // the green sprite, so flipping this flag flips the per-frame render branch on the very next paint.
  developer
    .add(this.guiState, 'showInvisibleNotes')
    .name('Show invisible notes')
    .onChange((value: boolean) => {
      this.guiState.showInvisibleNotes = value;
      this.gameplayView?.setShowInvisibleNotes(value);
    });
  // Renderer frame rate, sampled twice a second while the folder is on screen (no work while it's closed).
  const stats = { fps: '—' };
  const fpsController = developer.add(stats, 'fps').name('FPS').disable();
  window.setInterval(() => {
    if (!this.deps.stageMounted() || developer._closed || this.gui?._closed) return;
    stats.fps = this.sceneHost.app.ticker.FPS.toFixed(0);
    fpsController.updateDisplay();
  }, 500);
  developer
    .add(
      {
        reset: () => {
          if (
            !window.confirm(
              'Reset every Debug Menu setting (volumes, skins, skin settings, compressor tuning, folders) to its default and reload? Best records are kept.',
            )
          ) {
            return;
          }
          clearDemoSettings();
          window.location.reload();
        },
      },
      'reset',
    )
    .name('Reset settings and reload');
}
