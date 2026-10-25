import { selectBinding, type PaneBinding } from '../../pane-controls.ts';
import { resolveGaugeTypes } from '@be-music/player-engine/ruleset';
// The Debug Menu's Play options folder and the Replay / ghost folder inside it. They are built with the menu as `this`
// (`DebugMenu`).
import type { FolderApi } from 'tweakpane';
import {
  DIFFICULTY_FILTER_CYCLE,
  CLASSIC_HI_SPEED_STEPS,
  NORMAL_HI_SPEED_GREEN_NUMBERS,
  snapClassicHiSpeed,
  HISPEED_MAX,
  HISPEED_MIN,
  HISPEED_STEP,
  KEYS_FILTER_CYCLE,
  resolveRandomModes,
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
  this.gaugeController = selectBinding(
    folder,
    this.guiState,
    'gauge',
    'Gauge',
    resolveGaugeTypes(this.guiState.judgeRuleset),
  );
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
  for (const side of ['1P', '2P'] as const) {
    const key = `random${side}` as const;
    const controller = selectBinding(
      folder,
      this.guiState,
      key,
      `Random ${side}`,
      resolveRandomModes(this.guiState.judgeRuleset),
    );
    if (side === '1P') this.random1PController = controller;
    else this.random2PController = controller;
    trackPlayOption(
      controller.on('change', ({ value }) => {
        this.setPlayOptions({ [key]: value });
        this.refreshRulesetChoices();
      }),
    );
  }
  trackPlayOption(
    folder
      .addBinding(this.guiState, 'hRandomThresholdBPM', {
        label: 'H-RANDOM threshold BPM (beatoraja)',
        min: 1,
        max: 1000,
        step: 1,
      })
      .on('change', ({ value }) => this.setPlayOptions({ hRandomThresholdBPM: value })),
  );
  for (const side of ['1P', '2P'] as const) {
    const key = `randomFixedLane${side}` as const;
    trackPlayOption(
      folder
        .addBinding(this.guiState, key, {
          label: `Fixed key ${side} (LR2; 0=default)`,
          min: 0,
          max: 9,
          step: 1,
        })
        .on('change', ({ value }) => this.setPlayOptions({ [key]: value })),
    );
  }
  for (const side of ['1P', '2P'] as const) {
    const key = `randomSeed${side}` as const;
    const controller = folder
      .addBinding(this.guiState, key, { label: `Seed ${side} (-1=random)` })
      .on('change', ({ value }) => this.setPlayOptions({ [key]: value }));
    this.trackPlayOption(controller);
    if (side === '1P') this.randomSeed1PController = controller;
    else this.randomSeed2PController = controller;
    this.randomSeedControllers.push(controller);
  }
  this.sevenToNinePatternController = selectBinding(folder, this.guiState, 'sevenToNinePattern', '7-to-9 (beatoraja)', {
    OFF: 0,
    'SC1 KEY2–8': 1,
    'SC1 KEY3–9': 2,
    'SC2 KEY3–9': 3,
    'SC8 KEY1–7': 4,
    'SC9 KEY1–7': 5,
    'SC9 KEY2–8': 6,
  });
  trackPlayOption(
    this.sevenToNinePatternController.on('change', ({ value }) => this.setPlayOptions({ sevenToNinePattern: value })),
  );
  this.sevenToNineTypeController = selectBinding(folder, this.guiState, 'sevenToNineType', '7-to-9 scratch', {
    Fixed: 0,
    'Avoid repeated hits': 1,
    Alternate: 2,
  });
  trackPlayOption(
    this.sevenToNineTypeController.on('change', ({ value }) => this.setPlayOptions({ sevenToNineType: value })),
  );
  const reuse = folder.addButton({ title: 'Reuse previous arrangement' }).on('click', () => {
    const changes = this.deps.reusePreviousArrangement?.();
    if (changes) {
      this.setPlayOptions(changes);
      this.refreshPlayOptionControllers();
      this.setStatus('Previous arrangement selected for the same chart. Live input remains enabled.');
    } else this.setStatus('Play a chart with beatoraja rules first to retain its arrangement.');
  });
  const fresh = folder.addButton({ title: 'New arrangement' }).on('click', () => {
    this.deps.clearArrangement?.();
    this.setPlayOptions({ randomSeed1P: '-1', randomSeed2P: '-1' });
    this.refreshPlayOptionControllers();
    this.setStatus('A new arrangement will be drawn for the next play.');
  });
  for (const controller of [reuse, fresh]) {
    this.trackPlayOption(controller);
    this.randomSeedControllers.push(controller);
  }
  this.gaugeAutoShiftController = selectBinding(
    folder,
    this.guiState,
    'gaugeAutoShift',
    'Gauge auto-shift (beatoraja)',
    {
      NONE: 'NONE',
      CONTINUE: 'CONTINUE',
      'SURVIVAL TO GROOVE': 'SURVIVAL_TO_GROOVE',
      'BEST CLEAR': 'BEST_CLEAR',
      'SELECT TO UNDER': 'SELECT_TO_UNDER',
    },
  );
  trackPlayOption(
    this.gaugeAutoShiftController.on('change', ({ value }) => this.setPlayOptions({ gaugeAutoShift: value })),
  );
  this.bottomShiftableGaugeController = selectBinding(
    folder,
    this.guiState,
    'bottomShiftableGauge',
    'Lowest auto-shift gauge',
    {
      'ASSIST EASY': 'ASSIST-EASY',
      EASY: 'EASY',
      NORMAL: 'GROOVE',
    },
  );
  trackPlayOption(
    this.bottomShiftableGaugeController.on('change', ({ value }) =>
      this.setPlayOptions({ bottomShiftableGauge: value }),
    ),
  );
  this.scrollModifierController = selectBinding(folder, this.guiState, 'scrollModifier', 'Scroll (beatoraja)', {
    OFF: 'OFF',
    REMOVE: 'REMOVE',
    ADD: 'ADD',
  });
  trackPlayOption(
    this.scrollModifierController.on('change', ({ value }) => {
      this.setPlayOptions({ scrollModifier: value });
      this.refreshRulesetChoices();
    }),
  );
  this.scrollSectionController = trackPlayOption(
    folder
      .addBinding(this.guiState, 'scrollSection', { label: 'Scroll section lines', min: 1, max: 1024, step: 1 })
      .on('change', ({ value }) => this.setPlayOptions({ scrollSection: value })),
  );
  this.scrollRateController = trackPlayOption(
    folder
      .addBinding(this.guiState, 'scrollRate', { label: 'Scroll rate', min: 0, max: 1, step: 0.01 })
      .on('change', ({ value }) => this.setPlayOptions({ scrollRate: value })),
  );
  this.mineModifierController = selectBinding(folder, this.guiState, 'mineModifier', 'Mines (beatoraja)', {
    OFF: 'OFF',
    REMOVE: 'REMOVE',
    'ADD RANDOM': 'ADD_RANDOM',
    'ADD NEAR': 'ADD_NEAR',
    'ADD ALL': 'ADD_BLANK',
  });
  trackPlayOption(
    this.mineModifierController.on('change', ({ value }) => this.setPlayOptions({ mineModifier: value })),
  );
  this.refreshRulesetChoices();
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
  this.longNoteModifierController = selectBinding(folder, this.guiState, 'longNoteModifier', 'Long notes', {
    OFF: 'OFF',
    'LEGACY NOTE (AC 34)': 'LEGACY',
    'LN REMOVE (beatoraja)': 'REMOVE',
    'ADD LN (beatoraja)': 'ADD_LN',
    'ADD CN (beatoraja)': 'ADD_CN',
    'ADD HCN (beatoraja)': 'ADD_HCN',
    'ADD ALL (beatoraja)': 'ADD_ALL',
  });
  trackPlayOption(
    this.longNoteModifierController.on('change', ({ value }) => {
      this.setPlayOptions({ longNoteModifier: value });
      this.refreshRulesetChoices();
    }),
  );
  this.battleModeController = selectBinding(folder, this.guiState, 'battleMode', 'Battle', {
    OFF: 'OFF',
    'SP TO DP': 'SP-TO-DP',
  });
  trackPlayOption(
    this.battleModeController.on('change', ({ value }) => {
      this.setPlayOptions({ battleMode: value });
      this.refreshRulesetChoices();
    }),
  );
  // LR2 reads the scratch key held through the decide animation; the Debug Menu has no decide animation.
  this.dBattleScratchController = trackPlayOption(
    folder
      .addBinding(this.guiState, 'dBattleScratch', { label: 'D-BATTLE scratch (LR2)' })
      .on('change', ({ value }) => this.setPlayOptions({ dBattleScratch: value })),
  );
  this.lr2ExtraModeController = trackPlayOption(
    folder.addBinding(this.guiState, 'lr2ExtraMode', { label: 'EXTRA MODE (LR2)' }).on('change', ({ value }) => {
      this.setPlayOptions({ lr2ExtraMode: value });
      this.refreshRulesetChoices();
    }),
  );
  this.lr2ExtraLevelController = selectBinding(folder, this.guiState, 'lr2ExtraLevel', 'EXTRA minimum level (LR2)', {
    'LEVEL 1': 0,
    'LEVEL 2': 1,
    'LEVEL 3': 2,
  });
  trackPlayOption(
    this.lr2ExtraLevelController.on('change', ({ value }) => this.setPlayOptions({ lr2ExtraLevel: value })),
  );
  this.extraNoteDepthController = trackPlayOption(
    folder
      .addBinding(this.guiState, 'extraNoteDepth', { label: 'EXTRA depth (beatoraja)', min: 0, max: 100, step: 1 })
      .on('change', ({ value }) => this.setPlayOptions({ extraNoteDepth: value })),
  );
  this.extraNoteScratchController = trackPlayOption(
    folder
      .addBinding(this.guiState, 'extraNoteScratch', { label: 'EXTRA scratch (beatoraja)' })
      .on('change', ({ value }) => this.setPlayOptions({ extraNoteScratch: value })),
  );
  this.longNoteRateController = trackPlayOption(
    folder
      .addBinding(this.guiState, 'longNoteRate', {
        label: 'Long-note add rate (beatoraja)',
        min: 0,
        max: 1,
        step: 0.01,
      })
      .on('change', ({ value }) => this.setPlayOptions({ longNoteRate: value })),
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
  this.hsFixController = selectBinding(folder, this.guiState, 'hsFix', 'HS-FIX', PLAY_OPTION_CHOICES.hsFix!);
  trackPlayOption(this.hsFixController.on('change', ({ value }) => this.setPlayOptions({ hsFix: value })));
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
  for (const side of ['1P', '2P'] as const) {
    const heightKey = side === '1P' ? 'lift1P' : 'lift2P';
    const enabledKey = side === '1P' ? 'liftOn1P' : 'liftOn2P';
    folder.addBinding(this.guiState, enabledKey, { label: `LIFT ${side} (beatoraja)` }).on('change', ({ value }) => {
      this.setPlayOptions({ [enabledKey]: value });
      this.gameplayView?.controller.dispatch({
        type: 'cover',
        command: { type: 'cover-set', covers: [{ side, liftOn: value, lift: this.guiState[heightKey] }], side },
      });
    });
    folder
      .addBinding(this.guiState, heightKey, { label: `LIFT height ${side}`, min: 0, max: 1, step: 0.001 })
      .on('change', ({ value }) => {
        this.setPlayOptions({ [heightKey]: value });
        this.gameplayView?.controller.dispatch({
          type: 'cover',
          command: { type: 'cover-set', covers: [{ side, lift: value }], side },
        });
      });
  }
  trackPlayOption(
    folder
      .addBinding(this.guiState, 'visualConstant', { label: 'Visual CONSTANT (beatoraja)' })
      .on('change', ({ value }) => this.setPlayOptions({ visualConstant: value })),
  );
  folder
    .addBinding(this.guiState, 'noteDurationMs', { label: 'Note duration (ms)', min: 1, max: 10000, step: 1 })
    .on('change', ({ value }) => {
      this.setPlayOptions({ noteDurationMs: value });
      this.gameplayView?.controller.dispatch({ type: 'constant-visibility', durationMs: value });
    });
  folder
    .addBinding(this.guiState, 'constantFadeMs', { label: 'CONSTANT fade (ms)', min: -1000, max: 1000, step: 1 })
    .on('change', ({ value }) => {
      this.setPlayOptions({ constantFadeMs: value });
      this.gameplayView?.controller.dispatch({ type: 'constant-visibility', fadeMs: value });
    });
  this.judgeTimingAutoAdjustController = trackPlayOption(
    folder
      .addBinding(this.guiState, 'judgeTimingAutoAdjust', { label: 'Auto judge timing (beatoraja)' })
      .on('change', ({ value }) => this.setPlayOptions({ judgeTimingAutoAdjust: value })),
  );
  this.judgeTimingController = folder
    .addBinding(this.guiState, 'judgeTimingMs', { label: 'Judge timing (beatoraja, ms)', min: -500, max: 500, step: 1 })
    .on('change', ({ value }) => {
      this.setPlayOptions({ judgeTimingMs: value });
      this.gameplayView?.setJudgeTimingMs(value);
    });
  const state = this.guiState;
  const normal = {
    get enabled() {
      return state.normalHiSpeedLevel > 0;
    },
    set enabled(value: boolean) {
      state.normalHiSpeedLevel = value ? state.normalHiSpeedLevel || 3 : 0;
    },
    get level() {
      return state.normalHiSpeedLevel || 3;
    },
    set level(value: number) {
      if (state.normalHiSpeedLevel > 0) state.normalHiSpeedLevel = value;
    },
  };
  this.normalHiSpeedController = trackPlayOption(
    folder.addBinding(normal, 'enabled', { label: 'Normal HI-SPEED (AC 32 measured)' }).on('change', ({ value }) => {
      if (value) {
        state.classicHiSpeed = false;
        state.hsFix = 'OFF';
      }
      this.setPlayOptions({
        normalHiSpeedLevel: state.normalHiSpeedLevel,
        ...(value ? { classicHiSpeed: false, hsFix: 'OFF' } : {}),
      });
      this.refreshRulesetChoices();
      this.refreshPlayOptionControllers();
    }),
  );
  this.normalHiSpeedLevelController = trackPlayOption(
    selectBinding(
      folder,
      normal,
      'level',
      'Normal HS level',
      NORMAL_HI_SPEED_GREEN_NUMBERS.map((_, index) => index + 1),
    ).on('change', ({ value }) => this.setPlayOptions({ normalHiSpeedLevel: value })),
  );
  this.fixedDisplayAreaController = trackPlayOption(
    folder
      .addBinding(this.guiState, 'fixedDisplayArea', { label: 'Fixed display area (AC 34)' })
      .on('change', ({ value }) => this.setPlayOptions({ fixedDisplayArea: value })),
  );
  this.floatingHiSpeedController = trackPlayOption(
    folder
      .addBinding(this.guiState, 'floatingHiSpeed', { label: 'FLOATING HI-SPEED (AC 32 measured)' })
      .on('change', ({ value }) => {
        this.setPlayOptions({ floatingHiSpeed: value, ...(value ? { hsFix: 'OFF' } : {}) });
        this.refreshRulesetChoices();
        this.refreshPlayOptionControllers();
      }),
  );
  this.floatingSpeedController = folder
    .addBinding(this.guiState, 'hiSpeed', { label: 'Floating speed', min: 0.5, max: 10, step: 0.01 })
    .on('change', ({ value }) => this.deps.rememberHiSpeed(value, 'menu'));
  this.classicHiSpeedController = trackPlayOption(
    folder.addBinding(this.guiState, 'classicHiSpeed', { label: 'CLASSIC HI-SPEED' }).on('change', ({ value }) => {
      this.setPlayOptions({ classicHiSpeed: value, ...(value ? { hsFix: 'OFF', normalHiSpeedLevel: 0 } : {}) });
      if (value) {
        this.guiState.hsFix = 'OFF';
        this.guiState.normalHiSpeedLevel = 0;
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
