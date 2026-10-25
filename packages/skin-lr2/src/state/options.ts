import { LR2_GAUGE_TYPES, type GaugeType } from '@be-music/player-engine/ruleset';
import {
  BGA_CYCLE,
  BGA_SIZE_CYCLE,
  DIFFICULTY_FILTER_CYCLE,
  HIDDEN_SUDDEN_CYCLE,
  HISPEED_MAX,
  HISPEED_MIN,
  HS_FIX_CYCLE,
  KEYS_FILTER_CYCLE,
  RANDOM_CYCLE,
  SORT_CYCLE,
  type BGAMode,
  type DifficultyFilter,
  type PlayOptions,
} from '@be-music/player-scene-model';
import { LR2_BUTTON, LR2_NUM, LR2_OP, LR2_SLIDER, LR2_TEXT } from '../ids/index.ts';

/**
 * LR2's BATTLE button cycle (`config.play.battle` 0-3): OFF, BATTLE (two players), D-BATTLE and SP TO DP. G-BATTLE
 * (4), a ghost battle against a rival's score, is not offered.
 */
export const LR2_BATTLE_CYCLE: readonly PlayOptions['battleMode'][] = ['OFF', 'TWO-PLAYER', 'D-BATTLE', 'SP-TO-DP'];

/**
 * The BATTLE label of the option panel (text 69) as LR2's `optionstr.csv` names it for the selected chart's key mode:
 * BATTLE on a double-play chart is COUPLE, SP TO DP is DP-TO-SP or 9-TO-7, and an option the chart cannot take is
 * DISABLE (`SetObjectStrings_SongSelect`).
 */
function battleLabel(battle: PlayOptions['battleMode'], keyModeOp: number | undefined): string {
  const double = keyModeOp === LR2_OP.KEYS_10 || keyModeOp === LR2_OP.KEYS_14;
  const nine = keyModeOp === LR2_OP.KEYS_9;
  switch (battle) {
    case 'TWO-PLAYER':
      return double ? 'COUPLE' : nine ? 'DISABLE' : 'BATTLE';
    case 'D-BATTLE':
      return double || nine ? 'DISABLE' : 'D-BATTLE';
    case 'SP-TO-DP':
      return double ? 'DP-TO-SP' : nine ? '9-TO-7' : 'SP-TO-DP';
    default:
      return 'OFF';
  }
}

/**
 * LR2's battle ops (10-13) for the key filter and BATTLE option: op 10 a double-play filter (DOUBLE, 14KEYS, 10KEYS)
 * or D-BATTLE / SP TO DP, op 11 and 13 BATTLE, op 12 either. LR2 reads them off the select screen's settings on every
 * screen.
 */
export function resolveLR2BattleOps(options: Partial<Pick<PlayOptions, 'keysFilter' | 'battleMode'>>): number[] {
  const doubleFilter = options.keysFilter === 'KEYS_10' || options.keysFilter === 'KEYS_14';
  const battle = options.battleMode === 'TWO-PLAYER';
  const doubleBattle = options.battleMode === 'D-BATTLE' || options.battleMode === 'SP-TO-DP';
  const ops: number[] = [];
  if (doubleFilter || doubleBattle) ops.push(LR2_OP.DOUBLE);
  if (battle) ops.push(LR2_OP.BATTLE, LR2_OP.GHOST_BATTLE_OR_BATTLE);
  if (doubleFilter || battle || doubleBattle) ops.push(LR2_OP.DOUBLE_OR_BATTLE);
  return ops;
}

/** Whether a gauge is one of LR2's red (survival) gauges: HARD and DEATH. */
export function isLR2RedGauge(gauge: GaugeType): boolean {
  return gauge === 'HARD' || gauge === 'DEATH' || gauge === 'EX-HARD';
}

/** Whether the BGA shows: ON, or AUTOPLAY ONLY while AUTOPLAY is on. */
export function isLR2BGAShown(bga: BGAMode, autoPlay: boolean): boolean {
  return bga === 'ON' || (bga === 'AUTOPLAY_ONLY' && autoPlay);
}

/**
 * The play-option ops a select screen lights from the player's options: the BGA (40 / 41) and its size (30 / 31), the
 * score graph (38 / 39), each side's auto scratch (54-57) and gauge (42-45: HARD and DEATH are the red gauges) and the
 * difficulty filter (46 / 47).
 */
export function resolveLR2PlayOptionOps(options: PlayOptions): number[] {
  return [
    ...resolveLR2BattleOps(options),
    isLR2BGAShown(options.bga, options.autoPlay) ? LR2_OP.BGA_ON : LR2_OP.BGA_OFF,
    options.bgaSize === 'EXTEND' ? LR2_OP.BGA_EXTEND : LR2_OP.BGA_NORMAL,
    options.scoreGraph ? LR2_OP.SCORE_GRAPH_ON : LR2_OP.SCORE_GRAPH_OFF,
    options.autoScratch1P ? LR2_OP.AUTO_SCRATCH_1P_ON : LR2_OP.AUTO_SCRATCH_1P_OFF,
    options.autoScratch2P ? LR2_OP.AUTO_SCRATCH_2P_ON : LR2_OP.AUTO_SCRATCH_2P_OFF,
    isLR2RedGauge(options.gauge1P) ? LR2_OP.GAUGE_1P_RED : LR2_OP.GAUGE_1P_NORMAL,
    isLR2RedGauge(options.gauge2P) ? LR2_OP.GAUGE_2P_RED : LR2_OP.GAUGE_2P_NORMAL,
    options.difficultyFilter !== 'ALL' ? LR2_OP.DIFFICULTY_FILTER_ON : LR2_OP.DIFFICULTY_FILTER_OFF,
  ];
}

/** The difficulty filter each of LR2's direct difficulty buttons (91 ALL … 96 INSANE) sets. */
export const LR2_DIFFICULTY_FILTER_BUTTONS: Readonly<Record<number, DifficultyFilter>> = {
  [LR2_BUTTON.DIFFICULTY_FILTER_ALL]: 'ALL',
  [LR2_BUTTON.DIFFICULTY_FILTER_BEGINNER]: 'BEGINNER',
  [LR2_BUTTON.DIFFICULTY_FILTER_NORMAL]: 'NORMAL',
  [LR2_BUTTON.DIFFICULTY_FILTER_HYPER]: 'HYPER',
  [LR2_BUTTON.DIFFICULTY_FILTER_ANOTHER]: 'ANOTHER',
  [LR2_BUTTON.DIFFICULTY_FILTER_INSANE]: 'INSANE',
};

/** The play-style label of the option panel (text 60) for a key-mode op. */
function playStyleLabel(keyModeOp: number | undefined): string {
  switch (keyModeOp) {
    case LR2_OP.KEYS_5:
      return '5KEYS';
    case LR2_OP.KEYS_7:
      return '7KEYS';
    case LR2_OP.KEYS_10:
      return '10KEYS';
    case LR2_OP.KEYS_14:
      return '14KEYS';
    case LR2_OP.KEYS_9:
      return '9KEYS';
    default:
      return 'SINGLE';
  }
}

/**
 * The option panel's labels (texts 60-85): each option's setting as the LR2 default skin names it, the play style from
 * the selected chart's key-mode op (`SINGLE` without one). The options be-music does not have read as their off
 * setting. `undefined` for any other text.
 */
export function resolveLR2OptionText(
  st: number,
  options: PlayOptions,
  keyModeOp: number | undefined,
): string | undefined {
  switch (st) {
    case LR2_TEXT.OPTION_PLAY_STYLE:
      return playStyleLabel(keyModeOp);
    case LR2_TEXT.OPTION_SORT:
      return options.sort;
    case LR2_TEXT.OPTION_DIFFICULTY_FILTER:
      return options.difficultyFilter;
    case LR2_TEXT.OPTION_RANDOM_1P:
      return options.random1P;
    case LR2_TEXT.OPTION_RANDOM_2P:
      return options.random2P;
    case LR2_TEXT.OPTION_GAUGE_1P:
      return options.gauge1P;
    case LR2_TEXT.OPTION_GAUGE_2P:
      return options.gauge2P;
    case LR2_TEXT.OPTION_ASSIST_1P:
      return options.autoScratch1P ? 'AUTOSCRATCH' : 'OFF';
    case LR2_TEXT.OPTION_ASSIST_2P:
      return options.autoScratch2P ? 'AUTOSCRATCH' : 'OFF';
    case LR2_TEXT.OPTION_FLIP:
      return options.dpFlip ? 'ON' : 'OFF';
    case LR2_TEXT.OPTION_SCORE_GRAPH:
      return options.scoreGraph ? 'ON' : 'OFF';
    case LR2_TEXT.OPTION_LANE_COVER:
      // The ON / OFF switch; the height is the slider next to it.
      return options.laneCover ? 'ON' : 'OFF';
    case LR2_TEXT.OPTION_BGA_SIZE:
      return options.bgaSize;
    case LR2_TEXT.OPTION_BGA:
      return options.bga === 'AUTOPLAY_ONLY' ? 'AUTOPLAY' : options.bga;
    case LR2_TEXT.OPTION_EFFECT_1P:
      return options.hiddenSudden1P;
    case LR2_TEXT.OPTION_EFFECT_2P:
      return options.hiddenSudden2P;
    case LR2_TEXT.OPTION_BATTLE:
      return battleLabel(options.battleMode, keyModeOp);
    case LR2_TEXT.OPTION_GHOST:
    case LR2_TEXT.OPTION_SCROLL_TYPE:
    case LR2_TEXT.OPTION_JUDGE_AUTO_ADJUST:
    case LR2_TEXT.OPTION_REPLAY_SAVE:
      return 'OFF';
    case LR2_TEXT.OPTION_COLOR_DEPTH:
      return '32 BIT';
    case LR2_TEXT.OPTION_VSYNC:
      return 'ON';
    case LR2_TEXT.OPTION_SCREEN_MODE:
      return 'FULL';
    case LR2_TEXT.OPTION_TRIAL_LINE_1:
    case LR2_TEXT.OPTION_TRIAL_LINE_2:
      return '';
    default:
      return undefined;
  }
}

/**
 * The option numbers (10-15): each side's hi-speed × 100 (both sides read the one hi-speed). The judge timing, the
 * target rate and the lane cover numbers read 0 until the options exist. `undefined` for any other number.
 */
export function resolveLR2OptionNumber(num: number, options: Pick<PlayOptions, 'hiSpeed'>): number | undefined {
  switch (num) {
    case LR2_NUM.HISPEED_1P:
    case LR2_NUM.HISPEED_2P:
      return Math.round(options.hiSpeed * 100);
    case LR2_NUM.JUDGE_TIMING:
    case LR2_NUM.TARGET_RATE:
    case LR2_NUM.LANE_COVER_1P:
    case LR2_NUM.LANE_COVER_2P:
      return 0;
    default:
      return undefined;
  }
}

/**
 * The hi-speed and lane cover sliders (2-5): each side's hi-speed over the hi-speed range and the lane cover height
 * (both sides read the one setting). `undefined` for any other slider.
 */
export function resolveLR2OptionSlider(
  type: number,
  options: Pick<PlayOptions, 'hiSpeed' | 'shutter'>,
): number | undefined {
  switch (type) {
    case LR2_SLIDER.HISPEED_1P:
    case LR2_SLIDER.HISPEED_2P:
      return lr2HiSpeedSlider(options.hiSpeed);
    case LR2_SLIDER.LANE_COVER_1P:
    case LR2_SLIDER.LANE_COVER_2P:
      return Math.max(0, Math.min(1, options.shutter));
    default:
      return undefined;
  }
}

/** A hi-speed as a slider position: its place in the hi-speed range, 0..1. */
export function lr2HiSpeedSlider(hiSpeed: number): number {
  const span = HISPEED_MAX - HISPEED_MIN;
  return span <= 0 ? 0 : Math.max(0, Math.min(1, (hiSpeed - HISPEED_MIN) / span));
}

/** The index of `value` in `choices`, 0 when it is not one of them. */
function cell<T>(choices: readonly T[], value: T): number {
  return Math.max(0, choices.indexOf(value));
}

/**
 * The cell an option button draws (`#SRC_BUTTON` types 10-12, 40-46, 50-55, 70-73, 91-96): the index of the option's
 * value in its LR2 cycle order (an on / off option: 0 off, 1 on; a direct difficulty button: 1 while its difficulty
 * is the filter). `undefined` for any other button; the caller clamps it to the button's cells.
 */
export function resolveLR2OptionButton(type: number, options: PlayOptions): number | undefined {
  switch (type) {
    case LR2_BUTTON.BGA:
      return cell(BGA_CYCLE, options.bga);
    case LR2_BUTTON.BGA_SIZE:
      return cell(BGA_SIZE_CYCLE, options.bgaSize);
    case LR2_BUTTON.SCORE_GRAPH:
      return options.scoreGraph ? 1 : 0;
    case LR2_BUTTON.DIFFICULTY_FILTER:
      return cell(DIFFICULTY_FILTER_CYCLE, options.difficultyFilter);
    case LR2_BUTTON.KEY_MODE_FILTER:
      return cell(KEYS_FILTER_CYCLE, options.keysFilter);
    case LR2_BUTTON.SORT:
      return cell(SORT_CYCLE, options.sort);
    case LR2_BUTTON.HS_FIX:
      return cell(HS_FIX_CYCLE, options.hsFix);
    case LR2_BUTTON.EFFECT_1P:
      return cell(HIDDEN_SUDDEN_CYCLE, options.hiddenSudden1P);
    case LR2_BUTTON.EFFECT_2P:
      return cell(HIDDEN_SUDDEN_CYCLE, options.hiddenSudden2P);
    case LR2_BUTTON.LANE_COVER:
      return options.laneCover ? 1 : 0;
    case LR2_BUTTON.AUTO_SCRATCH_1P:
      return options.autoScratch1P ? 1 : 0;
    case LR2_BUTTON.AUTO_SCRATCH_2P:
      return options.autoScratch2P ? 1 : 0;
    case LR2_BUTTON.FLIP:
      return options.dpFlip ? 1 : 0;
    case LR2_BUTTON.BATTLE:
      return Math.max(0, LR2_BATTLE_CYCLE.indexOf(options.battleMode));
    case LR2_BUTTON.RANDOM_1P:
      return cell(RANDOM_CYCLE, options.random1P);
    case LR2_BUTTON.RANDOM_2P:
      return cell(RANDOM_CYCLE, options.random2P);
    case LR2_BUTTON.GAUGE_1P:
      return cell(
        LR2_GAUGE_TYPES,
        options.gauge1P === 'EX-HARD' ? 'HARD' : options.gauge1P === 'ASSIST-EASY' ? 'EASY' : options.gauge1P,
      );
    case LR2_BUTTON.GAUGE_2P:
      return cell(
        LR2_GAUGE_TYPES,
        options.gauge2P === 'EX-HARD' ? 'HARD' : options.gauge2P === 'ASSIST-EASY' ? 'EASY' : options.gauge2P,
      );
    default: {
      const difficulty = LR2_DIFFICULTY_FILTER_BUTTONS[type];
      if (difficulty === undefined) return undefined;
      return options.difficultyFilter === difficulty ? 1 : 0;
    }
  }
}
