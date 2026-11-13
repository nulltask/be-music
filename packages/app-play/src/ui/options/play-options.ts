import { selectBinding, type PaneBinding } from '../../pane-controls.ts';
import { resolveGaugeTypes } from '@be-music/player-engine/ruleset';
// The Options dialog's Play options folder, split into pages, the Replay / ghost folder on its last page, the View
// folder and the Select folder. They are built with the dialog as `this` (`OptionsDialog`).
import type { OptionContainer } from '../options-controls.ts';
import {
  DIFFICULTY_FILTER_CYCLE,
  CLASSIC_HI_SPEED_STEPS,
  NORMAL_HI_SPEED_GREEN_NUMBERS,
  snapClassicHiSpeed,
  HISPEED_MAX,
  HISPEED_MIN,
  HISPEED_STEP,
  JUDGE_POSITION_LIMIT,
  KEYS_FILTER_CYCLE,
  parseRankingScoreTarget,
  PLAY_OPTION_CHOICES,
  resolveScoreTarget,
  SCORE_TARGET_IDS,
  SORT_CYCLE,
  type PlayOptions,
} from '@be-music/player-scene-model';
import { parseReplay } from '@be-music/player-engine/replay';
import { storeReplayView } from '../../replay-view-settings.ts';
import type { OptionsDialog } from './index.ts';
import { buildLR2ManiaRows } from './lr2-mania.ts';
import { PLAY_OPTION_PAGES, VIEW_OPTION_PAGES } from './folders.ts';
import { bottomShiftableGaugeItems, laneOptionItems, practiceGaugeItems } from './play-option-items.ts';
/**
 * How the player plays: auto play, hi-speed, gauge, lane options and assists.
 *
 * Play options — the playMode / chartOptions / assists / judge / gauge settings that get recorded into the replay.
 * Two-way synced with the LR2 select scene's PLAY OPTION panel where a counterpart exists (the panel pushes user
 * edits back through `onPlayOptionsChange`; these controllers push through `setPlayOptions`). Most are latched at
 * song start and DISABLED during a play. The ones a play takes live (hi-speed, the covers and LIFT, the judge timing
 * and CONSTANT visibility) and the select screen's sort and filters, which a play does not read, stay enabled.
 *
 * The options are many, so the folder splits them into pages (`PLAY_OPTION_PAGES`). The ones that only change what the
 * lanes show go to the View folder (`viewFolder`, split into `VIEW_OPTION_PAGES`), and the select screen's sort and
 * filters to the Select folder (`select`). Returns the Practice and Replay / ghost pages, for the Tempo and Replay /
 * ghost folders.
 */
export function buildPlayOptionsFolder(
  this: OptionsDialog,
  folder: OptionContainer,
  viewFolder: OptionContainer,
  select: OptionContainer,
): { readonly practice: OptionContainer; readonly replay: OptionContainer } {
  // The judge ruleset, above the pages: every judge rule (windows, note selection, empty POOR, long notes, gauge, score —
  // see docs/replay.md) and the choices of several options on the pages follow it. No skin has a counterpart.
  this.trackPlayOption(
    selectBinding(folder, this.guiState, 'judgeRuleset', 'Judgment windows', {
      LR2: 'lr2',
      beatoraja: 'beatoraja',
      '????': '____',
    }).on('change', () => {
      this.refreshRulesetChoices();
      this.deps.refreshSelectRecords();
    }),
  );
  // What the options picked do to a play's record, from the resolver a finished play's record goes through.
  this.recordConsequenceController = folder.addBinding(this.recordConsequence, 'text', {
    label: 'Record kept',
    readonly: true,
  });
  // `lanes` is the Arrangement page and `notes` the Modifiers page.
  const [judge, lanes, notes, assist, practice, replay] = folder.addTab({
    pages: PLAY_OPTION_PAGES.map((title) => ({ title })),
  }).pages;
  const viewTabs = viewFolder.addTab({ pages: VIEW_OPTION_PAGES.map((title) => ({ title })) });
  this.viewTabs = viewTabs;
  const [hiSpeed, covers, effects] = viewTabs.pages;
  if (!judge || !lanes || !notes || !assist || !practice || !replay || !hiSpeed || !covers || !effects)
    return { practice: folder, replay: folder };
  const trackPlayOption = (controller: PaneBinding): PaneBinding => this.trackPlayOption(controller);
  trackPlayOption(
    assist.addBinding(this.guiState, 'autoPlay', { label: 'Auto play' }).on('change', ({ value }) => {
      this.setPlayOptions({ autoPlay: value });
    }),
  );
  this.gaugeController = selectBinding(
    judge,
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
  this.judgeAlgorithmController = selectBinding(judge, this.guiState, 'judgeAlgorithm', 'Judge algorithm', {
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
      lanes,
      this.guiState,
      key,
      `Random ${side}`,
      Object.fromEntries(laneOptionItems(this.guiState.judgeRuleset).map((item) => [item.text, item.value])),
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
    lanes
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
      lanes
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
    const controller = lanes
      .addBinding(this.guiState, key, { label: `Seed ${side} (-1=random)` })
      .on('change', ({ value }) => this.setPlayOptions({ [key]: value }));
    this.trackPlayOption(controller);
    if (side === '1P') this.randomSeed1PController = controller;
    else this.randomSeed2PController = controller;
  }
  this.sevenToNinePatternController = selectBinding(lanes, this.guiState, 'sevenToNinePattern', '7-to-9 (beatoraja)', {
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
  this.sevenToNineTypeController = selectBinding(lanes, this.guiState, 'sevenToNineType', '7-to-9 scratch', {
    Fixed: 0,
    'Avoid repeated hits': 1,
    Alternate: 2,
  });
  trackPlayOption(
    this.sevenToNineTypeController.on('change', ({ value }) => this.setPlayOptions({ sevenToNineType: value })),
  );
  const reuse = lanes.addButton({ title: 'Reuse previous arrangement' }).on('click', () => {
    const changes = this.deps.reusePreviousArrangement?.();
    if (changes) {
      this.setPlayOptions(changes);
      this.refreshPlayOptionControllers();
      this.setStatus('Previous arrangement selected for the same chart. Live input remains enabled.');
    } else this.setStatus('Play a chart with the current judgment rules first to retain its arrangement.');
  });
  const fresh = lanes.addButton({ title: 'New arrangement' }).on('click', () => {
    this.deps.clearArrangement?.();
    // The menu's seeds too, which the saved settings keep.
    this.guiState.randomSeed1P = '-1';
    this.guiState.randomSeed2P = '-1';
    this.setPlayOptions({ randomSeed1P: '-1', randomSeed2P: '-1' });
    this.refreshPlayOptionControllers();
    this.setStatus('A new arrangement will be drawn for the next play.');
  });
  // Every ruleset reuses its own previous arrangement (#774) and seeds its lane randoms (#933).
  for (const controller of [reuse, fresh]) this.trackPlayOption(controller);
  trackPlayOption(
    selectBinding(judge, this.guiState, 'bmsonTotalMode', 'bmson TOTAL 0', {
      'Native compatibility': 'beatoraja',
      'No recovery (bmson spec)': 'spec',
    }).on('change', ({ value }) => this.setPlayOptions({ bmsonTotalMode: value })),
  );
  this.gaugeAutoShiftController = selectBinding(judge, this.guiState, 'gaugeAutoShift', 'Gauge auto-shift', {
    NONE: 'NONE',
    CONTINUE: 'CONTINUE',
    'SURVIVAL TO GROOVE': 'SURVIVAL_TO_GROOVE',
    'BEST CLEAR': 'BEST_CLEAR',
    'SELECT TO UNDER': 'SELECT_TO_UNDER',
  });
  trackPlayOption(
    this.gaugeAutoShiftController.on('change', ({ value }) => this.setPlayOptions({ gaugeAutoShift: value })),
  );
  this.bottomShiftableGaugeController = selectBinding(
    judge,
    this.guiState,
    'bottomShiftableGauge',
    'Lowest auto-shift gauge',
    bottomShiftableGaugeItems(this.guiState.judgeRuleset).map((item) => item.value),
  );
  trackPlayOption(
    this.bottomShiftableGaugeController.on('change', ({ value }) =>
      this.setPlayOptions({ bottomShiftableGauge: value }),
    ),
  );
  // LR2's mania chart generators: 0 is off, 10–100 the rate, as LR2's panel steps them. They build the chart before the
  // play, so they are locked during one.
  for (const [key, label] of [
    ['lr2AddNotes', 'ADD NOTES (LR2)'],
    ['lr2Loudness', 'LOUDNESS (LR2)'],
    ['lr2AddLongNotes', 'ADD LONGNOTES (LR2)'],
    ['lr2AddMines', 'ADD MINES (LR2)'],
  ] as const) {
    trackPlayOption(
      notes
        .addBinding(this.guiState, key, { label, min: 0, max: 100, step: 10 })
        .on('change', ({ value }) => this.setPlayOptions({ [key]: value })),
    );
  }
  this.scrollModifierController = selectBinding(notes, this.guiState, 'scrollModifier', 'Scroll', {
    OFF: 'OFF',
    'REMOVE (beatoraja)': 'REMOVE',
    'ADD (beatoraja)': 'ADD',
    'SOFTLANDING LEVEL 1 (LR2)': 'SOFTLANDING-1',
    'SOFTLANDING LEVEL 2 (LR2)': 'SOFTLANDING-2',
  });
  trackPlayOption(
    this.scrollModifierController.on('change', ({ value }) => {
      this.setPlayOptions({ scrollModifier: value });
      this.refreshRulesetChoices();
    }),
  );
  this.scrollSectionController = trackPlayOption(
    notes
      .addBinding(this.guiState, 'scrollSection', { label: 'Scroll section lines', min: 1, max: 1024, step: 1 })
      .on('change', ({ value }) => this.setPlayOptions({ scrollSection: value })),
  );
  this.scrollRateController = trackPlayOption(
    notes
      .addBinding(this.guiState, 'scrollRate', { label: 'Scroll rate', min: 0, max: 1, step: 0.01 })
      .on('change', ({ value }) => this.setPlayOptions({ scrollRate: value })),
  );
  this.mineModifierController = selectBinding(notes, this.guiState, 'mineModifier', 'Mines (beatoraja)', {
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
    lanes.addBinding(this.guiState, 'dpFlip', { label: 'DP flip' }).on('change', ({ value }) => {
      this.setPlayOptions({ dpFlip: value });
    }),
  );
  trackPlayOption(
    assist.addBinding(this.guiState, 'autoScratch1P', { label: 'Auto scratch 1P' }).on('change', ({ value }) => {
      this.setPlayOptions({ autoScratch1P: value });
    }),
  );
  trackPlayOption(
    assist.addBinding(this.guiState, 'autoScratch2P', { label: 'Auto scratch 2P' }).on('change', ({ value }) => {
      this.setPlayOptions({ autoScratch2P: value });
    }),
  );
  // beatoraja's GUIDE SE: the sound set's sound for each judgment. Read as the play starts, when the sounds are decoded.
  trackPlayOption(
    assist.addBinding(this.guiState, 'guideSE', { label: 'GUIDE SE (beatoraja)' }).on('change', ({ value }) => {
      this.setPlayOptions({ guideSE: value });
    }),
  );
  // The PC edition's ANY KEY (#751), offered with the `____` judge rules (`refreshRulesetChoices`); saves no record.
  this.anyKeyController = trackPlayOption(assist.addBinding(this.guiState, 'anyKey', { label: 'ANY KEY (PC)' }));
  this.longNoteModifierController = selectBinding(notes, this.guiState, 'longNoteModifier', 'Long notes', {
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
  this.battleModeController = selectBinding(lanes, this.guiState, 'battleMode', 'Battle', {
    OFF: 'OFF',
    'SP TO DP': 'SP-TO-DP',
  });
  trackPlayOption(
    this.battleModeController.on('change', ({ value }) => {
      this.setPlayOptions({ battleMode: value });
      this.refreshRulesetChoices();
    }),
  );
  // Two-player play (LR2 BATTLE): the 2P player's gauge, and That-Which-Must-Not-Be-Named's M-RAN per player.
  this.gauge2PController = selectBinding(
    lanes,
    this.guiState,
    'gauge2P',
    'Gauge 2P',
    resolveGaugeTypes(this.guiState.judgeRuleset),
  );
  trackPlayOption(this.gauge2PController.on('change', ({ value }) => this.setPlayOptions({ gauge2P: value })));
  this.mRanControllers = (['mRan1P', 'mRan2P'] as const).map((key) =>
    trackPlayOption(
      lanes
        .addBinding(this.guiState, key, { label: key === 'mRan1P' ? 'M-RAN 1P' : 'M-RAN 2P' })
        .on('change', ({ value }) => this.setPlayOptions({ [key]: value })),
    ),
  );
  // LR2 keeps the scratch through a hidden command at decide (`randSC`, buttons 12 + 13); the dialog has a switch instead.
  this.dBattleScratchController = trackPlayOption(
    lanes
      .addBinding(this.guiState, 'dBattleScratch', { label: 'D-BATTLE scratch (LR2)' })
      .on('change', ({ value }) => this.setPlayOptions({ dBattleScratch: value })),
  );
  this.lr2ExtraModeController = trackPlayOption(
    notes.addBinding(this.guiState, 'lr2ExtraMode', { label: 'EXTRA MODE (LR2)' }).on('change', ({ value }) => {
      this.setPlayOptions({ lr2ExtraMode: value });
      this.refreshRulesetChoices();
    }),
  );
  this.lr2ExtraLevelController = selectBinding(notes, this.guiState, 'lr2ExtraLevel', 'EXTRA minimum level (LR2)', {
    'LEVEL 1': 0,
    'LEVEL 2': 1,
    'LEVEL 3': 2,
  });
  trackPlayOption(
    this.lr2ExtraLevelController.on('change', ({ value }) => this.setPlayOptions({ lr2ExtraLevel: value })),
  );
  this.longNoteModeController = selectBinding(judge, this.guiState, 'longNoteMode', 'LN MODE (beatoraja)', {
    'LONG NOTE': 'LN',
    'CHARGE NOTE': 'CN',
    'HELL CHARGE NOTE': 'HCN',
  });
  trackPlayOption(
    this.longNoteModeController.on('change', ({ value }) => this.setPlayOptions({ longNoteMode: value })),
  );
  // LR2's mania option GAMBOL: part of LR2's judge rules, so it is offered under them only.
  this.lr2GambolController = trackPlayOption(
    selectBinding(judge, this.guiState, 'lr2Gambol', 'GAMBOL (LR2)', {
      OFF: 0,
      'LEVEL 1': 1,
      'LEVEL 2': 2,
    }).on('change', ({ value }) => this.setPlayOptions({ lr2Gambol: value })),
  );
  this.customJudgeController = trackPlayOption(
    judge.addBinding(this.guiState, 'customJudge', { label: 'CUSTOM JUDGE (beatoraja)' }).on('change', ({ value }) => {
      this.setPlayOptions({ customJudge: value });
      this.refreshRulesetChoices();
    }),
  );
  // PlayerConfig.validate: PGREAT 25..400 %, every other rate 0..400 %.
  this.customJudgeRateControllers = (
    [
      ['customJudgeKeyPerfectGreat', 'Key PGREAT %', 25],
      ['customJudgeKeyGreat', 'Key GREAT %', 0],
      ['customJudgeKeyGood', 'Key GOOD %', 0],
      ['customJudgeScratchPerfectGreat', 'Scratch PGREAT %', 25],
      ['customJudgeScratchGreat', 'Scratch GREAT %', 0],
      ['customJudgeScratchGood', 'Scratch GOOD %', 0],
      ['customJudgeLongNoteMargin', 'LN margin %', 0],
    ] as const
  ).map(([key, label, min]) =>
    trackPlayOption(
      judge
        .addBinding(this.guiState, key, { label, min, max: 400, step: 1 })
        .on('change', ({ value }) => this.setPlayOptions({ [key]: value })),
    ),
  );
  // PRACTICE (beatoraja's PracticeConfiguration), under every ruleset (#933): the bars to loop are picked on the chart's
  // score as the chart starts (`practice-bars.ts`); a 0 JUDGERANK / TOTAL is the chart's.
  this.practiceControllers = [
    trackPlayOption(
      practice.addBinding(this.guiState, 'practice', { label: 'PRACTICE' }).on('change', ({ value }) => {
        this.setPlayOptions({ practice: value });
        this.refreshRulesetChoices();
      }),
    ),
  ];
  const addPracticeNumbers = (
    entries: readonly (readonly [
      'practiceStartGauge' | 'practiceJudgeRank' | 'practiceTotal',
      string,
      number,
      number,
      number,
    ])[],
  ): void => {
    for (const [key, label, min, max, step] of entries) {
      this.practiceControllers.push(
        trackPlayOption(
          practice
            .addBinding(this.guiState, key, { label, min, max, step })
            .on('change', ({ value }) => this.setPlayOptions({ [key]: value })),
        ),
      );
    }
  };
  addPracticeNumbers([
    ['practiceStartGauge', 'GAUGE VALUE', 1, 120, 1],
    ['practiceJudgeRank', 'JUDGERANK (0 = chart)', 0, 400, 1],
    ['practiceTotal', 'TOTAL (0 = chart)', 0, 5000, 1],
  ]);
  // The judge ruleset's own gauges; refreshRulesetChoices relists them when the ruleset changes.
  const practiceGauge = selectBinding(
    practice,
    this.guiState,
    'practiceGauge',
    'GAUGE TYPE',
    practiceGaugeItems(this.guiState.judgeRuleset).map((item) => item.value),
  );
  this.practiceGaugeController = practiceGauge;
  trackPlayOption(practiceGauge.on('change', ({ value }) => this.setPlayOptions({ practiceGauge: value })));
  const practiceCategory = selectBinding(practice, this.guiState, 'practiceGaugeCategory', 'GAUGE CATEGORY', {
    'Play mode': 'MODE',
    FIVEKEYS: 'FIVEKEYS',
    SEVENKEYS: 'SEVENKEYS',
    PMS: 'PMS',
    KEYBOARD: 'KEYBOARD',
    LR2: 'LR2',
  });
  trackPlayOption(practiceCategory.on('change', ({ value }) => this.setPlayOptions({ practiceGaugeCategory: value })));
  this.practiceGaugeCategoryController = practiceCategory;
  // JUDGERANK and TOTAL, after GAUGE VALUE.
  this.practiceJudgeRankAndTotalControllers = this.practiceControllers.slice(2, 4);
  this.practiceControllers.push(practiceGauge);
  this.extraNoteDepthController = trackPlayOption(
    notes
      .addBinding(this.guiState, 'extraNoteDepth', { label: 'EXTRA depth (beatoraja)', min: 0, max: 100, step: 1 })
      .on('change', ({ value }) => this.setPlayOptions({ extraNoteDepth: value })),
  );
  this.extraNoteScratchController = trackPlayOption(
    notes
      .addBinding(this.guiState, 'extraNoteScratch', { label: 'EXTRA scratch (beatoraja)' })
      .on('change', ({ value }) => this.setPlayOptions({ extraNoteScratch: value })),
  );
  this.longNoteRateController = trackPlayOption(
    notes
      .addBinding(this.guiState, 'longNoteRate', {
        label: 'Long-note add rate (beatoraja)',
        min: 0,
        max: 1,
        step: 0.01,
      })
      .on('change', ({ value }) => this.setPlayOptions({ longNoteRate: value })),
  );
  // The built-in and LR2 select screens' sort and filters (an LR2 skin's buttons change them too); the list keeps
  // the bar under the cursor. A play does not read them, so they stay enabled during one.
  selectBinding(select, this.guiState, 'sort', 'Sort', [...SORT_CYCLE]).on('change', ({ value }) => {
    this.setPlayOptions({ sort: value });
  });
  selectBinding(select, this.guiState, 'keysFilter', 'Key filter', [...KEYS_FILTER_CYCLE]).on('change', ({ value }) => {
    this.setPlayOptions({ keysFilter: value });
  });
  selectBinding(select, this.guiState, 'difficultyFilter', 'Difficulty filter', [...DIFFICULTY_FILTER_CYCLE]).on(
    'change',
    ({ value }) => {
      this.setPlayOptions({ difficultyFilter: value });
    },
  );
  this.hsFixController = selectBinding(hiSpeed, this.guiState, 'hsFix', 'HS-FIX', PLAY_OPTION_CHOICES.hsFix!);
  trackPlayOption(this.hsFixController.on('change', ({ value }) => this.setPlayOptions({ hsFix: value })));
  trackPlayOption(
    selectBinding(covers, this.guiState, 'displayAreaInfo', 'Display area info', {
      OFF: 'OFF',
      ON: 'ON',
      'SUDDEN+ ONLY': 'SUDDEN_ONLY',
      'HID+/LIFT ONLY': 'HIDDEN_LIFT_ONLY',
    }).on('change', ({ value }) => {
      this.setPlayOptions({ displayAreaInfo: value });
    }),
  );
  // SUDDEN+ / HIDDEN+, the switch and the height stay enabled during a play and move its covers live, as LIFT does.
  const setCovers = (changes: Partial<PlayOptions>): void => this.setCoverOptions(changes);
  for (const key of ['hiddenSudden1P', 'hiddenSudden2P'] as const) {
    selectBinding(
      covers,
      this.guiState,
      key,
      key === 'hiddenSudden1P' ? 'Effect 1P' : 'Effect 2P',
      PLAY_OPTION_CHOICES[key]!,
    ).on('change', ({ value }) => setCovers({ [key]: value }));
  }
  covers
    .addBinding(this.guiState, 'laneCover', { label: 'Lane cover' })
    .on('change', ({ value }) => setCovers({ laneCover: value }));
  covers
    .addBinding(this.guiState, 'shutter', { label: 'Cover height', min: 0, max: 1, step: 0.01 })
    .on('change', ({ value }) => setCovers({ shutter: value }));
  trackPlayOption(
    effects
      .addBinding(this.guiState, 'bpmGuide', { label: 'BPM GUIDE (beatoraja)' })
      .on('change', ({ value }) => this.setPlayOptions({ bpmGuide: value })),
  );
  trackPlayOption(
    effects
      .addBinding(this.guiState, 'bpmChangeWarning', { label: 'BPM change warning (AC)' })
      .on('change', ({ value }) => this.setPlayOptions({ bpmChangeWarning: value })),
  );
  for (const side of ['1P', '2P'] as const) {
    const heightKey = side === '1P' ? 'lift1P' : 'lift2P';
    const enabledKey = side === '1P' ? 'liftOn1P' : 'liftOn2P';
    covers.addBinding(this.guiState, enabledKey, { label: `LIFT ${side} (beatoraja)` }).on('change', ({ value }) => {
      this.setPlayOptions({ [enabledKey]: value });
      this.gameplayView?.controller.dispatch({
        type: 'cover',
        command: { type: 'cover-set', covers: [{ side, liftOn: value, lift: this.guiState[heightKey] }], side },
      });
    });
    covers
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
    effects
      .addBinding(this.guiState, 'visualConstant', { label: 'Visual CONSTANT (beatoraja)' })
      .on('change', ({ value }) => this.setPlayOptions({ visualConstant: value })),
  );
  effects
    .addBinding(this.guiState, 'noteDurationMs', { label: 'Note duration (ms)', min: 1, max: 10000, step: 1 })
    .on('change', ({ value }) => {
      this.setPlayOptions({ noteDurationMs: value });
      this.gameplayView?.controller.dispatch({ type: 'constant-visibility', durationMs: value });
    });
  effects
    .addBinding(this.guiState, 'constantFadeMs', { label: 'CONSTANT fade (ms)', min: -1000, max: 1000, step: 1 })
    .on('change', ({ value }) => {
      this.setPlayOptions({ constantFadeMs: value });
      this.gameplayView?.controller.dispatch({ type: 'constant-visibility', fadeMs: value });
    });
  this.judgeTimingAutoAdjustController = trackPlayOption(
    selectBinding(judge, this.guiState, 'judgeTimingAutoAdjust', 'Auto judge timing', {
      OFF: 'OFF',
      beatoraja: 'BEATORAJA',
      'LR2 ON': 'LR2-ON',
      'LR2 SILENT': 'LR2-SILENT',
    }).on('change', ({ value }) => this.setPlayOptions({ judgeTimingAutoAdjust: value })),
  );
  this.judgeTimingController = judge
    .addBinding(this.guiState, 'judgeTimingMs', { label: 'Judge timing (ms)', min: -500, max: 500, step: 1 })
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
    hiSpeed.addBinding(normal, 'enabled', { label: 'Normal HI-SPEED (AC 32 measured)' }).on('change', ({ value }) => {
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
      hiSpeed,
      normal,
      'level',
      'Normal HS level',
      NORMAL_HI_SPEED_GREEN_NUMBERS.map((_, index) => index + 1),
    ).on('change', ({ value }) => this.setPlayOptions({ normalHiSpeedLevel: value })),
  );
  this.fixedDisplayAreaController = trackPlayOption(
    hiSpeed
      .addBinding(this.guiState, 'fixedDisplayArea', { label: 'Fixed display area (AC 34)' })
      .on('change', ({ value }) => this.setPlayOptions({ fixedDisplayArea: value })),
  );
  this.floatingHiSpeedController = trackPlayOption(
    hiSpeed
      .addBinding(this.guiState, 'floatingHiSpeed', { label: 'FLOATING HI-SPEED (AC 32 measured)' })
      .on('change', ({ value }) => {
        this.setPlayOptions({ floatingHiSpeed: value, ...(value ? { hsFix: 'OFF' } : {}) });
        this.refreshRulesetChoices();
        this.refreshPlayOptionControllers();
      }),
  );
  const remember = (value: number): void => this.deps.rememberHiSpeed(value, 'menu');
  this.floatingSpeedController = hiSpeed.addBinding(
    hiSpeedControl(this.guiState, () => this.guiState.floatingHiSpeed, onGrid(0.01), remember),
    'hiSpeed',
    { label: 'Floating speed', min: 0.5, max: 10, step: 0.01 },
  );
  this.classicHiSpeedController = trackPlayOption(
    hiSpeed.addBinding(this.guiState, 'classicHiSpeed', { label: 'CLASSIC HI-SPEED' }).on('change', ({ value }) => {
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
    hiSpeed,
    hiSpeedControl(
      this.guiState,
      () => this.guiState.classicHiSpeed,
      (value) => snapClassicHiSpeed(value) ?? CLASSIC_HI_SPEED_STEPS[0]!,
      remember,
    ),
    'hiSpeed',
    'Classic speed',
    CLASSIC_HI_SPEED_STEPS,
  );
  // Hi-speed — the same range and step as the in-game `ArrowUp` / `ArrowDown` keys. Unlike the options above it is
  // visual only, so it stays enabled during a play and applies to it live.
  const regular = (): boolean =>
    !this.guiState.classicHiSpeed && !this.guiState.floatingHiSpeed && !(this.guiState.normalHiSpeedLevel > 0);
  this.hiSpeedController = hiSpeed.addBinding(
    hiSpeedControl(this.guiState, regular, onGrid(HISPEED_STEP), remember),
    'hiSpeed',
    { label: 'Hi-speed', min: HISPEED_MIN, max: HISPEED_MAX, step: HISPEED_STEP },
  );
  buildNoteDisplayRows.call(this, effects);
  buildLR2ManiaRows.call(this, effects);
  this.refreshRulesetChoices();
  return { practice, replay };
}

/**
 * The View folder's rows about which notes the lanes draw: judged notes kept or hidden, and the chart's invisible
 * notes. Both apply to a running play live.
 */
function buildNoteDisplayRows(this: OptionsDialog, effects: OptionContainer): void {
  // Picks between LR2 / beatoraja's "a judged note stays until its time" and "a judged note goes the moment it is
  // judged". Pushed live into the running gameplay view so a mid-song toggle takes effect on the very next paint — the
  // visibility check is a single per-frame branch with no backing state to rebuild.
  selectBinding(effects, this.guiState, 'judgedNoteDisplay', 'Judged notes', {
    'Keep until its time (LR2)': 'KEEP_SCROLLING',
    'Hide on judge': 'HIDE',
  }).on('change', ({ value }) => {
    this.guiState.judgedNoteDisplay = value;
    this.gameplayView?.setJudgedNoteDisplay(value);
  });
  // AC 34's detail options. Live: the views read both at each frame.
  effects
    .addBinding(this.guiState, 'laneBrightness', { label: 'Lane brightness (AC)', min: 0, max: 100, step: 10 })
    .on('change', ({ value }) => this.setPlayOptions({ laneBrightness: value }));
  // The built-in skins' judge detail and judgment counts. AC 34 lists the timing display, its keys / scratch split and
  // the realtime judgment counts; a beatoraja skin has the first and the last as its own options.
  selectBinding(effects, this.guiState, 'judgeDetail', 'Judge detail (built-in skins)', {
    OFF: 'OFF',
    'FAST / SLOW': 'FAST_SLOW',
    '±ms': 'MS',
  }).on('change', ({ value }) => this.setPlayOptions({ judgeDetail: value }));
  effects
    .addBinding(this.guiState, 'judgeDetailSplit', { label: 'Judge detail: keys and scratch apart' })
    .on('change', ({ value }) => this.setPlayOptions({ judgeDetailSplit: value }));
  effects
    .addBinding(this.guiState, 'judgeCounts', { label: 'Judgment counts (built-in skins)' })
    .on('change', ({ value }) => this.setPlayOptions({ judgeCounts: value }));
  // The built-in skins' judgment and combo, moved up (-) or down (+) the lanes. LR2 and beatoraja skins place their own.
  effects
    .addBinding(this.guiState, 'judgePosition', {
      label: 'Judgment position (built-in skins, %)',
      min: -JUDGE_POSITION_LIMIT,
      max: JUDGE_POSITION_LIMIT,
      step: 5,
    })
    .on('change', ({ value }) => this.setPlayOptions({ judgePosition: value }));
  selectBinding(effects, this.guiState, 'judgeDisplay', 'Judgment display (AC)', {
    'Skin default': 'SKIN',
    OFF: 'OFF',
  }).on('change', ({ value }) => this.setPlayOptions({ judgeDisplay: value }));
  // beatoraja's judge area and mark processed note. Live: the playfield reads both at each frame.
  effects
    .addBinding(this.guiState, 'showJudgeArea', { label: 'Show judge area (beatoraja)' })
    .on('change', ({ value }) => this.setPlayOptions({ showJudgeArea: value }));
  effects
    .addBinding(this.guiState, 'markProcessedNotes', { label: 'Mark processed notes (beatoraja)' })
    .on('change', ({ value }) => this.setPlayOptions({ markProcessedNotes: value }));
  // AC 34's オートスクラッチ表示. Live: the playfield reads the option at each frame.
  selectBinding(effects, this.guiState, 'autoScratchNotes', 'Auto scratch notes (AC)', {
    Show: 'SHOW',
    Hide: 'HIDE',
  }).on('change', ({ value }) => this.setPlayOptions({ autoScratchNotes: value }));
  // Chart-authoring overlay — paints invisible / keysound notes (BMS channels `3x` / `4x`) as thin green bars in their
  // playable lane. Live: the gameplay view always extracts the invisible notes and preloads the green sprite, so the
  // flag flips the per-frame render branch on the very next paint.
  effects
    .addBinding(this.guiState, 'showInvisibleNotes', { label: 'Show invisible notes' })
    .on('change', ({ value }) => {
      this.guiState.showInvisibleNotes = value;
      this.gameplayView?.setShowInvisibleNotes(value);
    });
}
/**
 * Replay / ghost: which of what a replay recorded the player seeing a replay shows (the tempo, the hi-speed,
 * SUDDEN+ / HIDDEN+ and LIFT), the rest staying the player's own; and the ghost shown beside a play. Read when a play
 * starts, so disabled during one.
 */
export function buildReplayViewFolder(this: OptionsDialog, folder: OptionContainer): void {
  const remember = () => storeReplayView(this.guiState.replayView);
  const labels = { tempo: 'Tempo', hiSpeed: 'Hi-speed', covers: 'SUDDEN+ / HIDDEN+', lift: 'LIFT' } as const;
  for (const key of ['tempo', 'hiSpeed', 'covers', 'lift'] as const) {
    this.trackPlayOption(
      folder.addBinding(this.guiState.replayView, key, { label: labels[key] }).on('change', remember),
    );
  }
  // The ghost with the play (`services/ghost.ts`): which replay it plays and how it shows. Disabled during a play like
  // the other options, and on a course bar; "Ghost status" says whether the bar under the cursor would show it.
  // The score graph's fixed target, in beatoraja's names. It paces a play that runs no ghost; live.
  selectBinding(
    folder,
    this.guiState,
    'scoreTarget',
    'Target (beatoraja)',
    Object.fromEntries(SCORE_TARGET_IDS.map((id) => [scoreTargetLabel(id), id])),
  ).on('change', ({ value }) => this.setPlayOptions({ scoreTarget: value }));
  // The rate the SCORE RATE target paces towards (beatoraja's `RATE_<n>`); live.
  folder
    .addBinding(this.guiState, 'scoreTargetRate', { label: 'Target score rate (%)', min: 0, max: 100, step: 0.5 })
    .on('change', ({ value }) => this.setPlayOptions({ scoreTargetRate: value }));
  const refresh = () => this.refreshGhostAvailability();
  this.ghostController = selectBinding(folder, this.guiState, 'ghost', 'Ghost', {
    OFF: 'OFF',
    'OWN BEST': 'OWN_BEST',
    'REPLAY SLOT 1': 'REPLAY_SLOT_1',
    'REPLAY SLOT 2': 'REPLAY_SLOT_2',
    'REPLAY SLOT 3': 'REPLAY_SLOT_3',
    'REPLAY SLOT 4': 'REPLAY_SLOT_4',
    'LEADERBOARD TOP': 'LEADERBOARD_TOP',
    'REPLAY FILE': 'REPLAY_FILE',
  });
  this.ghostController.on('change', refresh);
  this.ghostModeController = selectBinding(folder, this.guiState, 'ghostMode', 'Ghost mode', {
    'SECOND PLAYFIELD': 'PLAYFIELD',
    PACEMAKER: 'PACEMAKER',
    'PACEMAKER + LANES': 'LANE_OVERLAY',
  });
  this.ghostModeController.on('change', refresh);
  this.ghostStatusController = folder.addBinding(this.ghostStatus, 'text', { label: 'Ghost status', readonly: true });
  const fileButton = folder.addButton({ title: 'Ghost replay file…' });
  fileButton.on('click', () => {
    void pickReplayFile().then(async (file) => {
      if (file === undefined) return;
      try {
        this.deps.ghostReplayFile.set(parseReplay(await file.text()), file.name);
        fileButton.title = `Ghost file: ${file.name}`;
        this.setStatus(`Ghost replay file: ${file.name}`);
      } catch (error) {
        this.setStatus(`Ghost replay file could not be read: ${(error as Error).message}`);
      }
      refresh();
    });
  });
  const menu = this;
  this.trackPlayOption({
    get disabled(): boolean {
      return menu.ghostLocked;
    },
    set disabled(locked: boolean) {
      menu.ghostLocked = locked;
      menu.refreshGhostAvailability();
    },
  });
  refresh();
}

/** Asks the player for one replay file (`*.bmplay.json`); `undefined` when none is picked. */
function pickReplayFile(): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => resolve(input.files?.[0]), { once: true });
    input.addEventListener('cancel', () => resolve(undefined), { once: true });
    input.click();
  });
}

/**
 * The hi-speed as one of the menu's hi-speed controls binds it. The controls share the one hi-speed, which a play also
 * changes (its keys, a floating hi-speed following the covers), so each shows it on its own grid (`show`) and takes only
 * an edit made on it: `onEdit` runs, and the hi-speed changes, when the control sets a value other than the one it shows
 * while its mode is in use (`active`). A control left to write back its own rounding would undo the play's change — a
 * floating 2.2458 as 2.25 — or set another mode's hi-speed (a classic list's first step for a play's 2.1).
 */
export function hiSpeedControl(
  guiState: { hiSpeed: number },
  active: () => boolean,
  show: (value: number) => number,
  onEdit: (value: number) => void,
): { hiSpeed: number } {
  return {
    get hiSpeed(): number {
      return show(guiState.hiSpeed);
    },
    set hiSpeed(value: number) {
      if (!active() || value === show(guiState.hiSpeed)) return;
      guiState.hiSpeed = value;
      onEdit(value);
    },
  };
}

/** A value on the grid of `step`, as a slider of that step shows it. */
export function onGrid(step: number): (value: number) => number {
  return (value) => Math.round(Math.round(value / step) * step * 1000) / 1000;
}

/** A score target's name in the dialog: beatoraja's own, with SCORE RATE's rate left to its slider. */
export function scoreTargetLabel(id: PlayOptions['scoreTarget']): string {
  if (id === 'SCORE_RATE') return 'SCORE RATE';
  return parseRankingScoreTarget(id)?.label ?? resolveScoreTarget(id, { totalNotes: 1 })?.label ?? id;
}
