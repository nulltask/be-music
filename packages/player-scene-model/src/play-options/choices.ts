import { clampExtraNoteDepth } from '@be-music/player-engine/lanes';
import { clampScrollSection, clampScrollRate } from '@be-music/player-engine/lanes';
import { clampFloatingHiSpeed } from './floating-hi-speed.ts';
import { clampLongNoteRate, clampHRandomThresholdBPM, parseLaneRandomSeed } from '@be-music/player-engine/lanes';
import { resolveConstantVisibility } from './constant-visibility.ts';
import { clampJudgeTimingMs } from './judge-timing.ts';
import { JUDGE_TIMING_AUTO_ADJUST_MODES } from '@be-music/player-engine/display';
import { clamp } from '@be-music/shared-utils/core';
import {
  BEATORAJA_PRACTICE_GAUGE_TYPES,
  LR2_GAUGE_TYPES,
  clampCustomJudgeRate,
  isGaugeType,
  type RulesetId,
} from '@be-music/player-engine/ruleset';
import type { BrowseSort, DifficultyFilter, KeysFilter } from '../browse/list-options.ts';
import { DEFAULT_HISPEED, snapHiSpeed, snapClassicHiSpeed } from './hi-speed.ts';
import type {
  BGAMode,
  BGASize,
  HiddenSuddenMode,
  HSFix,
  PlayOptionChoices,
  PlayOptions,
  RandomMode,
} from './options.ts';

/** The lane cover height a play starts with: a quarter of the lane. */
export const SHUTTER_DEFAULT = 0.25;

/**
 * Cycle order for {@link PlayOptions.bga}. Matches the LR2 default-skin cell order on the `#SRC_BUTTON,type=72` sprite —
 * `divx*divy` produces 3 cells (`OFF` / `ON` / `AUTOPLAY ONLY`) and clicks advance through them in this order.
 */
export const BGA_CYCLE: readonly BGAMode[] = ['OFF', 'ON', 'AUTOPLAY_ONLY'];

/** Cycle order for {@link PlayOptions.bgaSize}. LR2 button cell order on `#SRC_BUTTON,type=73`: NORMAL, EXTEND. */
export const BGA_SIZE_CYCLE: readonly BGASize[] = ['NORMAL', 'EXTEND'];

/**
 * Cycle order for {@link PlayOptions.difficultyFilter}. Matches the LR2 `#SRC_BUTTON,type=10` cell order (off / easy /
 * normal / hard / expert / insane).
 */
export const DIFFICULTY_FILTER_CYCLE: readonly DifficultyFilter[] = [
  'ALL',
  'BEGINNER',
  'NORMAL',
  'HYPER',
  'ANOTHER',
  'INSANE',
];

/**
 * Cycle order for {@link PlayOptions.keysFilter}. Matches the LR2 `#SRC_BUTTON,type=11` cell order (off / 5keys / 7keys
 * / 10keys / 14keys / 9keys).
 */
export const KEYS_FILTER_CYCLE: readonly KeysFilter[] = ['ALL', 'KEYS_5', 'KEYS_7', 'KEYS_10', 'KEYS_14', 'KEYS_9'];

/** Cycle order for {@link PlayOptions.sort}. LR2 button cells 0 / 1 / 2 / 3 = off / level / title / clear. */
export const SORT_CYCLE: readonly BrowseSort[] = ['OFF', 'LEVEL', 'TITLE', 'CLEAR'];

/**
 * Cycle order for {@link PlayOptions.hsFix}. LR2 button cells 0..4 on `#SRC_BUTTON,type=55`: off / maxbpm / minbpm /
 * average / constant.
 */
export const HS_FIX_CYCLE: readonly HSFix[] = ['OFF', 'MAXBPM', 'MINBPM', 'AVERAGE', 'CONSTANT'];

/**
 * Cycle order for {@link PlayOptions.hiddenSudden1P} / `hiddenSudden2P`. LR2 button cells 0..3 on `#SRC_BUTTON,type=50`
 * (1P) and `type=51` (2P): off / hidden / sudden / hid+sud.
 */
export const HIDDEN_SUDDEN_CYCLE: readonly HiddenSuddenMode[] = ['OFF', 'HIDDEN', 'SUDDEN', 'HID+SUD'];

/** Cycle for boolean OFF/ON LR2 buttons (e.g. autoscratch). */
export const BOOLEAN_CYCLE: readonly boolean[] = [false, true];

/** Source display spelling, without changing the recorded gauge identifier. */
export function formatGaugeLabel(id: string | undefined): string | undefined {
  return id === 'P-ATTACK' ? 'P.ATTACK' : id === 'G-ATTACK' ? 'G.ATTACK' : id;
}

/**
 * Cycle order for {@link PlayOptions.random1P} / `random2P`. LR2 button cells 0..3 on `#SRC_BUTTON,type=42 / 43`: off /
 * mirror / random / s-random. Additional source choices are returned by resolveRandomModes.
 */
export const RANDOM_CYCLE: readonly RandomMode[] = ['OFF', 'MIRROR', 'RANDOM', 'S-RANDOM'];

/**
 * Available lane options under `ruleset`; LR2's sprite cycle stays separate. An option only one source defines (R-RANDOM,
 * SPIRAL, H-RANDOM, ALL-SCR, RANDOM-EX, S-RANDOM-EX and the PMS arrangements from beatoraja, SCATTER from LR2) is offered
 * under every ruleset and runs that source's algorithm (#774). RANDOM and S-RANDOM run the ruleset's own algorithm, and
 * CONVERGE names LR2's concentration and beatoraja's PMS arrangement, so it stays with those two rulesets.
 * `duplicatedBattle1P` is the 1P side of a chart copied onto both sides (BATTLE, BATTLE AS, D-BATTLE), which also takes
 * SYNCHRONIZE RANDOM and SYMMETRY RANDOM.
 */
export function resolveRandomModes(ruleset: RulesetId, duplicatedBattle1P = false): readonly RandomMode[] {
  return [
    'OFF',
    'MIRROR',
    'RANDOM',
    'R-RANDOM',
    'S-RANDOM',
    'SPIRAL',
    'H-RANDOM',
    'ALL-SCR',
    'RANDOM-EX',
    'S-RANDOM-EX',
    'RANDOM_PLAYABLE',
    'S_RANDOM_PLAYABLE',
    'SCATTER',
    'SCATTER-CORRECTED',
    ...(ruleset === '____' ? [] : (['CONVERGE'] as const)),
    ...(duplicatedBattle1P ? (['SYNCHRONIZE-RANDOM', 'SYMMETRY-RANDOM'] as const) : []),
  ];
}

/** The battle modes that copy one SP chart onto both sides, whose 1P side takes the battle arrangements. */
export function isDuplicatedBattleChoice(mode: PlayOptions['battleMode'] | undefined): boolean {
  return mode === 'BATTLE' || mode === 'BATTLE-AS' || mode === 'D-BATTLE';
}

/** The play options a player starts with. */
export const DEFAULT_PLAY_OPTIONS: Readonly<PlayOptions> = {
  hiSpeed: DEFAULT_HISPEED,
  classicHiSpeed: false,
  floatingHiSpeed: false,
  fixedDisplayArea: false,
  normalHiSpeedLevel: 0,
  judgeTimingMs: 0,
  visualConstant: false,
  noteDurationMs: 500,
  constantFadeMs: 100,
  bpmGuide: false,
  judgeTimingAutoAdjust: 'OFF',
  autoPlay: false,
  bga: 'ON',
  // BGA renders at LR2's `#DST_BGA,...,30` rect (NORMAL) at `'NORMAL'` — a 256×256 window squeezed in beside the lane
  // chrome. `'EXTEND'` uses the larger `op 31` rect (392×392) which fills more of the playfield and is the default LR2
  // experience players expect.
  bgaSize: 'EXTEND',
  // Score graph (the per-judge prediction line gated on op 39) on by default: ship with the richer LR2 chrome visible
  // up-front rather than hidden behind a panel toggle.
  scoreGraph: true,
  difficultyFilter: 'ALL',
  keysFilter: 'ALL',
  sort: 'OFF',
  hsFix: 'OFF',
  displayAreaInfo: 'OFF',
  hiddenSudden1P: 'OFF',
  hiddenSudden2P: 'OFF',
  shutter: SHUTTER_DEFAULT,
  laneCover: false,
  lift1P: 0.1,
  lift2P: 0.1,
  liftOn1P: false,
  liftOn2P: false,
  judgeAlgorithm: 'combo',
  longNoteModifier: 'OFF',
  longNoteRate: 1,
  extraNoteDepth: 0,
  extraNoteScratch: false,
  sevenToNinePattern: 0,
  sevenToNineType: 0,
  battleMode: 'OFF',
  dBattleScratch: false,
  mRan1P: false,
  mRan2P: false,
  longNoteMode: 'LN',
  customJudge: false,
  practice: false,
  practiceStartMs: 0,
  practiceEndMs: 0,
  practiceGauge: 'NORMAL',
  practiceGaugeCategory: 'MODE',
  practiceStartGauge: 20,
  practiceJudgeRank: 0,
  practiceTotal: 0,
  customJudgeKeyPerfectGreat: 400,
  customJudgeKeyGreat: 400,
  customJudgeKeyGood: 100,
  customJudgeScratchPerfectGreat: 400,
  customJudgeScratchGreat: 400,
  customJudgeScratchGood: 100,
  customJudgeLongNoteMargin: 100,
  lr2ExtraMode: false,
  lr2ExtraLevel: 0,
  mineModifier: 'OFF',
  scrollModifier: 'OFF',
  scrollSection: 4,
  scrollRate: 0.5,
  gaugeAutoShift: 'NONE',
  bottomShiftableGauge: 'ASSIST-EASY',
  autoScratch1P: false,
  autoScratch2P: false,
  dpFlip: false,
  random1P: 'OFF',
  hRandomThresholdBPM: 120,
  randomSeed1P: '-1',
  randomSeed2P: '-1',
  randomFixedLane1P: 0,
  randomFixedLane2P: 0,
  random2P: 'OFF',
  gauge1P: 'GROOVE',
  gauge2P: 'GROOVE',
};

/**
 * Choices of every enum / on-off play option, in their LR2 button cycle order: what a skin can pick from. `hiSpeed` and
 * `shutter` are numbers, without a fixed set of choices.
 */
export const PLAY_OPTION_CHOICES: PlayOptionChoices = {
  autoPlay: BOOLEAN_CYCLE,
  bga: BGA_CYCLE,
  bgaSize: BGA_SIZE_CYCLE,
  scoreGraph: BOOLEAN_CYCLE,
  difficultyFilter: DIFFICULTY_FILTER_CYCLE,
  keysFilter: KEYS_FILTER_CYCLE,
  sort: SORT_CYCLE,
  hsFix: [...HS_FIX_CYCLE, 'STARTBPM'],
  displayAreaInfo: ['OFF', 'ON', 'SUDDEN_ONLY', 'HIDDEN_LIFT_ONLY'],
  hiddenSudden1P: HIDDEN_SUDDEN_CYCLE,
  hiddenSudden2P: HIDDEN_SUDDEN_CYCLE,
  laneCover: BOOLEAN_CYCLE,
  liftOn1P: BOOLEAN_CYCLE,
  liftOn2P: BOOLEAN_CYCLE,
  judgeAlgorithm: ['combo', 'duration', 'lowest'],
  longNoteModifier: ['OFF', 'LEGACY', 'REMOVE', 'ADD_LN', 'ADD_CN', 'ADD_HCN', 'ADD_ALL'],
  mineModifier: ['OFF', 'REMOVE', 'ADD_RANDOM', 'ADD_NEAR', 'ADD_BLANK'],
  scrollModifier: ['OFF', 'REMOVE', 'ADD'],
  gaugeAutoShift: ['NONE', 'CONTINUE', 'SURVIVAL_TO_GROOVE', 'BEST_CLEAR', 'SELECT_TO_UNDER'],
  bottomShiftableGauge: ['ASSIST-EASY', 'EASY', 'GROOVE'],
  classicHiSpeed: BOOLEAN_CYCLE,
  floatingHiSpeed: BOOLEAN_CYCLE,
  fixedDisplayArea: BOOLEAN_CYCLE,
  bpmGuide: BOOLEAN_CYCLE,
  judgeTimingAutoAdjust: JUDGE_TIMING_AUTO_ADJUST_MODES,
  visualConstant: BOOLEAN_CYCLE,
  extraNoteScratch: BOOLEAN_CYCLE,
  sevenToNinePattern: [0, 1, 2, 3, 4, 5, 6],
  sevenToNineType: [0, 1, 2],
  battleMode: ['OFF', 'SP-TO-DP', 'D-BATTLE', 'BATTLE', 'BATTLE-AS', 'TWO-PLAYER'],
  dBattleScratch: BOOLEAN_CYCLE,
  mRan1P: BOOLEAN_CYCLE,
  mRan2P: BOOLEAN_CYCLE,
  longNoteMode: ['LN', 'CN', 'HCN'],
  customJudge: BOOLEAN_CYCLE,
  practice: BOOLEAN_CYCLE,
  practiceGauge: [...BEATORAJA_PRACTICE_GAUGE_TYPES],
  practiceGaugeCategory: ['MODE', 'FIVEKEYS', 'SEVENKEYS', 'PMS', 'KEYBOARD', 'LR2'],
  lr2ExtraMode: BOOLEAN_CYCLE,
  lr2ExtraLevel: [0, 1, 2],
  autoScratch1P: BOOLEAN_CYCLE,
  autoScratch2P: BOOLEAN_CYCLE,
  dpFlip: BOOLEAN_CYCLE,
  random1P: resolveRandomModes('lr2', true),
  random2P: resolveRandomModes('lr2'),
  gauge1P: LR2_GAUGE_TYPES,
  gauge2P: LR2_GAUGE_TYPES,
};

/**
 * Snaps a hi-speed to the 1/1000 grid and clamps it to the hi-speed range (`snapHiSpeed`), falling back to the default
 * for non-finite input.
 */
export function clampHiSpeed(value: number): number {
  return snapHiSpeed(value) ?? DEFAULT_PLAY_OPTIONS.hiSpeed;
}

/**
 * Clamps a lane cover height to [0, 1] and snaps it to the 1/100 grid, so repeated +0.05 nudges land on round values
 * rather than drifting through float rounding. Non-finite input falls back to {@link SHUTTER_DEFAULT}.
 */
export function clampShutter(value: number): number {
  if (!Number.isFinite(value)) return SHUTTER_DEFAULT;
  const snapped = Math.round(value * 100) / 100;
  return clamp(snapped, 0, 1);
}

/** Numeric play options, each with the clamp applied to a value set for it. */
const NUMERIC_PLAY_OPTION_CLAMPS: { readonly [K in keyof PlayOptions]?: (value: number) => number } = {
  hRandomThresholdBPM: clampHRandomThresholdBPM,
  longNoteRate: clampLongNoteRate,
  practiceStartMs: (value) => Math.max(0, Math.round(value / 100) * 100),
  practiceEndMs: (value) => Math.max(0, Math.round(value / 100) * 100),
  practiceStartGauge: (value) => clamp(Math.trunc(value), 1, 120),
  practiceJudgeRank: (value) => (value <= 0 ? 0 : clamp(Math.trunc(value), 1, 400)),
  practiceTotal: (value) => (value <= 0 ? 0 : clamp(Math.trunc(value), 10, 5000)),
  customJudgeKeyPerfectGreat: (value) => clampCustomJudgeRate('keyPerfectGreat', value),
  customJudgeKeyGreat: (value) => clampCustomJudgeRate('keyGreat', value),
  customJudgeKeyGood: (value) => clampCustomJudgeRate('keyGood', value),
  customJudgeScratchPerfectGreat: (value) => clampCustomJudgeRate('scratchPerfectGreat', value),
  customJudgeScratchGreat: (value) => clampCustomJudgeRate('scratchGreat', value),
  customJudgeScratchGood: (value) => clampCustomJudgeRate('scratchGood', value),
  customJudgeLongNoteMargin: (value) => clampCustomJudgeRate('longNoteMargin', value),
  extraNoteDepth: clampExtraNoteDepth,
  scrollSection: clampScrollSection,
  scrollRate: clampScrollRate,
  randomFixedLane1P: (value) => (Number.isFinite(value) ? Math.max(0, Math.min(9, Math.trunc(value))) : 0),
  randomFixedLane2P: (value) => (Number.isFinite(value) ? Math.max(0, Math.min(9, Math.trunc(value))) : 0),
  hiSpeed: clampHiSpeed,
  judgeTimingMs: clampJudgeTimingMs,
  noteDurationMs: (value) => resolveConstantVisibility({ durationMs: value }).durationMs,
  constantFadeMs: (value) => resolveConstantVisibility({ fadeMs: value }).fadeMs,
  normalHiSpeedLevel: (value) => Math.max(0, Math.min(20, Math.round(value))),
  shutter: clampShutter,
  lift1P: clampShutter,
  lift2P: clampShutter,
};

/**
 * Validates a value set for a play option from untyped input (a be-music skin's `setPlayOption`, stored settings).
 * Returns the value to store — clamped for the numeric options (`hiSpeed`, `shutter`) — or `undefined` when the change
 * must be ignored: an unknown key, a value outside the option's choices, or a non-finite / non-numeric value for a
 * numeric option.
 */
export function resolvePlayOptionValue<K extends keyof PlayOptions>(
  key: K,
  value: unknown,
): PlayOptions[K] | undefined {
  if (!Object.hasOwn(DEFAULT_PLAY_OPTIONS, key)) return undefined;
  if (key === 'randomSeed1P' || key === 'randomSeed2P') return parseLaneRandomSeed(value) as PlayOptions[K] | undefined;
  if (key === 'gauge1P' || key === 'gauge2P') return isGaugeType(value) ? (value as PlayOptions[K]) : undefined;
  // Settings and replays from before the modes store beatoraja's switch as a boolean.
  if (key === 'judgeTimingAutoAdjust' && typeof value === 'boolean')
    return (value ? 'BEATORAJA' : 'OFF') as PlayOptions[K];
  const choices = PLAY_OPTION_CHOICES[key] as readonly unknown[] | undefined;
  if (choices) return choices.includes(value) ? (value as PlayOptions[K]) : undefined;
  const clamp = NUMERIC_PLAY_OPTION_CLAMPS[key];
  if (!clamp || typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return clamp(value) as PlayOptions[K];
}

/**
 * The choice `step` places after `current` in `key`'s choices, wrapping around either end — what a skin's
 * `cyclePlayOption(key, step)` moves to. Any negative `step` goes back one and anything else forward one. A value
 * outside the choices lands on the first choice; options without a fixed set of choices (`hiSpeed`, `shutter`, or an
 * unknown key) return `undefined`.
 */
export function cyclePlayOptionValue<K extends keyof PlayOptions>(
  key: K,
  current: PlayOptions[K],
  step: number = 1,
): PlayOptions[K] | undefined {
  if (!Object.hasOwn(PLAY_OPTION_CHOICES, key)) return undefined;
  const choices = PLAY_OPTION_CHOICES[key] as readonly PlayOptions[K][] | undefined;
  if (!choices || choices.length === 0) return undefined;
  return nextChoice(choices, current, step);
}

/**
 * The value after `current` in `choices` (before it for a negative `step`), wrapping around either end; the first
 * choice when `current` is not one of them. What a cycling button (LR2's `#SRC_BUTTON` types 40, 42, 50, 72, 73, …)
 * moves to on a click.
 */
export function nextChoice<T>(choices: readonly T[], current: T, step: number = 1): T {
  const index = choices.indexOf(current);
  if (index < 0) return choices[0]!;
  const delta = step < 0 ? -1 : 1;
  return choices[(index + delta + choices.length) % choices.length]!;
}

/** The play options that filter or reorder the bar list: changing one changes the list ({@link BrowseListOptions}). */
const LIST_PLAY_OPTIONS: ReadonlySet<keyof PlayOptions> = new Set(['difficultyFilter', 'keysFilter', 'sort']);

/** Whether changing play option `key` changes the bar list (its sort or a filter). */
export function isListPlayOption(key: keyof PlayOptions): boolean {
  return LIST_PLAY_OPTIONS.has(key);
}

/**
 * Play options as stored by a host, made whole and valid: each field of `stored` that {@link resolvePlayOptionValue}
 * accepts (clamped for the numeric ones) over {@link DEFAULT_PLAY_OPTIONS}; anything else is dropped.
 */
export function resolvePlayOptions(stored: Readonly<Partial<Record<keyof PlayOptions, unknown>>> = {}): PlayOptions {
  const options: PlayOptions = { ...DEFAULT_PLAY_OPTIONS };
  for (const key of Object.keys(DEFAULT_PLAY_OPTIONS) as Array<keyof PlayOptions>) {
    if (!Object.hasOwn(stored, key)) continue;
    const value = resolvePlayOptionValue(key, stored[key]);
    if (value !== undefined) (options as Record<keyof PlayOptions, unknown>)[key] = value;
  }
  if (options.floatingHiSpeed) {
    options.hsFix = 'OFF';
    options.hiSpeed =
      clampFloatingHiSpeed(typeof stored.hiSpeed === 'number' ? stored.hiSpeed : options.hiSpeed) ?? options.hiSpeed;
  } else if (options.classicHiSpeed) {
    options.normalHiSpeedLevel = 0;
    options.hsFix = 'OFF';
    options.hiSpeed = snapClassicHiSpeed(options.hiSpeed)!;
  } else if (options.normalHiSpeedLevel > 0) {
    options.hsFix = 'OFF';
    if (typeof stored.hiSpeed === 'number' && Number.isFinite(stored.hiSpeed) && stored.hiSpeed > 0)
      options.hiSpeed = stored.hiSpeed;
  }
  return options;
}
