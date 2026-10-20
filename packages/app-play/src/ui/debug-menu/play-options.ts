// The Debug Menu's Play options folder and the Replay / ghost folder inside it. They are built with the menu as `this`
// (`DebugMenu`).

import type { Controller, GUI } from 'lil-gui';
import {
  DIFFICULTY_FILTER_CYCLE,
  HISPEED_MAX,
  HISPEED_MIN,
  HISPEED_STEP,
  KEYS_FILTER_CYCLE,
  SORT_CYCLE,
} from '@be-music/player-scene-model';
import { storeReplayView } from '../../replay-view-settings.ts';
import type { DemoGUIState } from '../../types.ts';
import type { DebugMenu } from './index.ts';

/**
 * How the player plays: auto play, hi-speed, gauge, lane options and assists.
 *
 * Play options — the playMode / chartOptions / assists / judge / gauge settings that get recorded into the replay.
 * Two-way synced with the LR2 select scene's PLAY OPTION panel where a counterpart exists (the panel pushes user
 * edits back through `onPlayOptionsChange`; these controllers push through `setPlayOptions`). All of them are latched
 * at song start and DISABLED during a play — mid-song changes never apply.
 */
export function buildPlayOptionsFolder(this: DebugMenu, folder: GUI): void {
  const trackPlayOption = (controller: Controller): Controller => this.trackPlayOption(controller);
  trackPlayOption(
    folder
      .add(this.guiState, 'autoPlay')
      .name('Auto play')
      .onChange((value: boolean) => {
        this.setPlayOptions({ autoPlay: value });
      }),
  );
  trackPlayOption(
    folder
      .add(this.guiState, 'gauge', ['GROOVE', 'EASY', 'HARD', 'DEATH'])
      .name('Gauge')
      .onChange((value: DemoGUIState['gauge']) => {
        this.setPlayOptions({ gauge1P: value });
      }),
  );
  trackPlayOption(
    folder
      .add(this.guiState, 'random1P', ['OFF', 'MIRROR', 'RANDOM', 'S-RANDOM', 'SCATTER'])
      .name('Random 1P')
      .onChange((value: DemoGUIState['random1P']) => {
        this.setPlayOptions({ random1P: value });
      }),
  );
  trackPlayOption(
    folder
      .add(this.guiState, 'random2P', ['OFF', 'MIRROR', 'RANDOM', 'S-RANDOM', 'SCATTER'])
      .name('Random 2P')
      .onChange((value: DemoGUIState['random2P']) => {
        this.setPlayOptions({ random2P: value });
      }),
  );
  trackPlayOption(
    folder
      .add(this.guiState, 'dpFlip')
      .name('DP flip')
      .onChange((value: boolean) => {
        this.setPlayOptions({ dpFlip: value });
      }),
  );
  trackPlayOption(
    folder
      .add(this.guiState, 'autoScratch1P')
      .name('Auto scratch 1P')
      .onChange((value: boolean) => {
        this.setPlayOptions({ autoScratch1P: value });
      }),
  );
  trackPlayOption(
    folder
      .add(this.guiState, 'autoScratch2P')
      .name('Auto scratch 2P')
      .onChange((value: boolean) => {
        this.setPlayOptions({ autoScratch2P: value });
      }),
  );
  // The built-in and LR2 select screens' sort and filters (an LR2 skin's buttons change them too); the list keeps
  // the bar under the cursor.
  trackPlayOption(
    folder
      .add(this.guiState, 'sort', [...SORT_CYCLE])
      .name('Sort')
      .onChange((value: DemoGUIState['sort']) => {
        this.setPlayOptions({ sort: value });
      }),
  );
  trackPlayOption(
    folder
      .add(this.guiState, 'keysFilter', [...KEYS_FILTER_CYCLE])
      .name('Key filter')
      .onChange((value: DemoGUIState['keysFilter']) => {
        this.setPlayOptions({ keysFilter: value });
      }),
  );
  trackPlayOption(
    folder
      .add(this.guiState, 'difficultyFilter', [...DIFFICULTY_FILTER_CYCLE])
      .name('Difficulty filter')
      .onChange((value: DemoGUIState['difficultyFilter']) => {
        this.setPlayOptions({ difficultyFilter: value });
      }),
  );
  // Hi-speed — the same range and step as the in-game `ArrowUp` / `ArrowDown` keys. Unlike the options above it is
  // visual only, so it stays enabled during a play and applies to it live.
  this.hiSpeedController = folder
    .add(this.guiState, 'hiSpeed', HISPEED_MIN, HISPEED_MAX, HISPEED_STEP)
    .name('Hi-speed')
    .onChange((value: number) => this.deps.rememberHiSpeed(value, 'menu'));
}

/**
 * Replay / ghost: which of what a replay recorded the player seeing a replay shows (the tempo, the hi-speed,
 * SUDDEN+ / HIDDEN+ and LIFT), the rest staying the player's own. Read when a play starts, so disabled during one.
 */
export function buildReplayViewFolder(this: DebugMenu, folder: GUI): void {
  const remember = () => storeReplayView(this.guiState.replayView);
  const labels = { tempo: 'Tempo', hiSpeed: 'Hi-speed', covers: 'SUDDEN+ / HIDDEN+', lift: 'LIFT' } as const;
  for (const key of ['tempo', 'hiSpeed', 'covers', 'lift'] as const) {
    this.trackPlayOption(folder.add(this.guiState.replayView, key).name(labels[key]).onChange(remember));
  }
}
