import { selectBinding, type PaneBinding } from '../../pane-controls.ts';
// The Debug Menu's Play options folder and the Replay / ghost folder inside it. They are built with the menu as `this`
// (`DebugMenu`).
import type { FolderApi } from 'tweakpane';
import {
  DIFFICULTY_FILTER_CYCLE,
  CLASSIC_HI_SPEED_STEPS,
  snapClassicHiSpeed,
  HISPEED_MAX,
  HISPEED_MIN,
  HISPEED_STEP,
  KEYS_FILTER_CYCLE,
  RANDOM_CYCLE,
  PLAY_OPTION_CHOICES,
  SORT_CYCLE,
} from '@be-music/player-scene-model';
import { storeReplayView } from '../../replay-view-settings.ts';
import type { DebugMenu } from './index.ts';
/**
 * How the player plays: auto play, hi-speed, gauge, lane options and assists.
 *
 * Play options — the playMode / chartOptions / assists / judge / gauge settings that get recorded into the replay.
 * Two-way synced with the LR2 select scene's PLAY OPTION panel where a counterpart exists (the panel pushes user
 * edits back through `onPlayOptionsChange`; these controllers push through `setPlayOptions`). All of them are latched
 * at song start and DISABLED during a play — mid-song changes never apply.
 */
export function buildPlayOptionsFolder(this: DebugMenu, folder: FolderApi): void {
  const trackPlayOption = (controller: PaneBinding): PaneBinding => this.trackPlayOption(controller);
  trackPlayOption(
    folder.addBinding(this.guiState, 'autoPlay', { label: 'Auto play' }).on('change', ({ value }) => {
      this.setPlayOptions({ autoPlay: value });
    }),
  );
  this.gaugeController = selectBinding(folder, this.guiState, 'gauge', 'Gauge', ['GROOVE', 'EASY', 'HARD', 'DEATH']);
  trackPlayOption(
    this.gaugeController.on('change', ({ value }) => {
      this.setPlayOptions({ gauge1P: value });
    }),
  );
  this.judgeAlgorithmController = selectBinding(folder, this.guiState, 'judgeAlgorithm', 'Judge algorithm', {
    Combo: 'combo',
    Duration: 'duration',
    Lowest: 'lowest',
  });
  trackPlayOption(
    this.judgeAlgorithmController.on('change', ({ value }) => this.setPlayOptions({ judgeAlgorithm: value })),
  );
  this.refreshRulesetChoices();
  trackPlayOption(
    selectBinding(folder, this.guiState, 'random1P', 'Random 1P', RANDOM_CYCLE).on('change', ({ value }) => {
      this.setPlayOptions({ random1P: value });
    }),
  );
  trackPlayOption(
    selectBinding(folder, this.guiState, 'random2P', 'Random 2P', RANDOM_CYCLE).on('change', ({ value }) => {
      this.setPlayOptions({ random2P: value });
    }),
  );
  trackPlayOption(
    folder.addBinding(this.guiState, 'dpFlip', { label: 'DP flip' }).on('change', ({ value }) => {
      this.setPlayOptions({ dpFlip: value });
    }),
  );
  trackPlayOption(
    folder.addBinding(this.guiState, 'autoScratch1P', { label: 'Auto scratch 1P' }).on('change', ({ value }) => {
      this.setPlayOptions({ autoScratch1P: value });
    }),
  );
  trackPlayOption(
    folder.addBinding(this.guiState, 'autoScratch2P', { label: 'Auto scratch 2P' }).on('change', ({ value }) => {
      this.setPlayOptions({ autoScratch2P: value });
    }),
  );
  trackPlayOption(
    selectBinding(folder, this.guiState, 'longNoteModifier', 'Long notes', {
      OFF: 'OFF',
      'LEGACY NOTE (AC 34)': 'LEGACY',
      'LN REMOVE (beatoraja)': 'REMOVE',
    }).on('change', ({ value }) => this.setPlayOptions({ longNoteModifier: value })),
  );
  this.trackPlayOption(
    folder.addButton({ title: 'A-SCR & LEGACY NOTE (AC 34)' }).on('click', () => {
      const changes = { autoScratch1P: true, autoScratch2P: true, longNoteModifier: 'LEGACY' } as const;
      Object.assign(this.guiState, changes);
      this.setPlayOptions(changes);
      this.refreshPlayOptionControllers();
    }),
  );
  // The built-in and LR2 select screens' sort and filters (an LR2 skin's buttons change them too); the list keeps
  // the bar under the cursor.
  trackPlayOption(
    selectBinding(folder, this.guiState, 'sort', 'Sort', [...SORT_CYCLE]).on('change', ({ value }) => {
      this.setPlayOptions({ sort: value });
    }),
  );
  trackPlayOption(
    selectBinding(folder, this.guiState, 'keysFilter', 'Key filter', [...KEYS_FILTER_CYCLE]).on(
      'change',
      ({ value }) => {
        this.setPlayOptions({ keysFilter: value });
      },
    ),
  );
  trackPlayOption(
    selectBinding(folder, this.guiState, 'difficultyFilter', 'Difficulty filter', [...DIFFICULTY_FILTER_CYCLE]).on(
      'change',
      ({ value }) => {
        this.setPlayOptions({ difficultyFilter: value });
      },
    ),
  );
  this.hsFixController = trackPlayOption(
    selectBinding(folder, this.guiState, 'hsFix', 'HS-FIX', PLAY_OPTION_CHOICES.hsFix!).on('change', ({ value }) => {
      this.setPlayOptions({ hsFix: value });
    }),
  );
  trackPlayOption(
    selectBinding(folder, this.guiState, 'displayAreaInfo', 'Display area info', {
      OFF: 'OFF',
      ON: 'ON',
      'SUDDEN+ ONLY': 'SUDDEN_ONLY',
      'HID+/LIFT ONLY': 'HIDDEN_LIFT_ONLY',
    }).on('change', ({ value }) => {
      this.setPlayOptions({ displayAreaInfo: value });
    }),
  );
  for (const key of ['hiddenSudden1P', 'hiddenSudden2P'] as const) {
    trackPlayOption(
      selectBinding(
        folder,
        this.guiState,
        key,
        key === 'hiddenSudden1P' ? 'Effect 1P' : 'Effect 2P',
        PLAY_OPTION_CHOICES[key]!,
      ).on('change', ({ value }) => this.setPlayOptions({ [key]: value })),
    );
  }
  trackPlayOption(
    folder
      .addBinding(this.guiState, 'laneCover', { label: 'Lane cover' })
      .on('change', ({ value }) => this.setPlayOptions({ laneCover: value })),
  );
  trackPlayOption(
    folder
      .addBinding(this.guiState, 'shutter', { label: 'Cover height', min: 0, max: 1, step: 0.01 })
      .on('change', ({ value }) => this.setPlayOptions({ shutter: value })),
  );
  trackPlayOption(
    folder
      .addBinding(this.guiState, 'bpmGuide', { label: 'BPM GUIDE (beatoraja)' })
      .on('change', ({ value }) => this.setPlayOptions({ bpmGuide: value })),
  );
  this.classicHiSpeedController = trackPlayOption(
    folder.addBinding(this.guiState, 'classicHiSpeed', { label: 'CLASSIC HI-SPEED' }).on('change', ({ value }) => {
      this.setPlayOptions({ classicHiSpeed: value, ...(value ? { hsFix: 'OFF' } : {}) });
      if (value) {
        this.guiState.hsFix = 'OFF';
        this.deps.rememberHiSpeed(snapClassicHiSpeed(this.guiState.hiSpeed)!, 'menu');
      }
      this.refreshRulesetChoices();
      this.refreshPlayOptionControllers();
    }),
  );
  this.classicSpeedController = selectBinding(
    folder,
    this.guiState,
    'hiSpeed',
    'Classic speed',
    CLASSIC_HI_SPEED_STEPS,
  ).on('change', ({ value }) => this.deps.rememberHiSpeed(value, 'menu'));
  // Hi-speed — the same range and step as the in-game `ArrowUp` / `ArrowDown` keys. Unlike the options above it is
  // visual only, so it stays enabled during a play and applies to it live.
  this.hiSpeedController = folder
    .addBinding(this.guiState, 'hiSpeed', { label: 'Hi-speed', min: HISPEED_MIN, max: HISPEED_MAX, step: HISPEED_STEP })
    .on('change', ({ value }) => this.deps.rememberHiSpeed(value, 'menu'));
  this.refreshRulesetChoices();
}
/**
 * Replay / ghost: which of what a replay recorded the player seeing a replay shows (the tempo, the hi-speed,
 * SUDDEN+ / HIDDEN+ and LIFT), the rest staying the player's own. Read when a play starts, so disabled during one.
 */
export function buildReplayViewFolder(this: DebugMenu, folder: FolderApi): void {
  const remember = () => storeReplayView(this.guiState.replayView);
  const labels = { tempo: 'Tempo', hiSpeed: 'Hi-speed', covers: 'SUDDEN+ / HIDDEN+', lift: 'LIFT' } as const;
  for (const key of ['tempo', 'hiSpeed', 'covers', 'lift'] as const) {
    this.trackPlayOption(
      folder.addBinding(this.guiState.replayView, key, { label: labels[key] }).on('change', remember),
    );
  }
}
