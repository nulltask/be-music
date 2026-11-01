import { optionValueName } from '@be-music/player-engine/ruleset';
import { nextChoice, type PlayOptions, type RandomMode } from '@be-music/player-scene-model';

/**
 * beatoraja's select-screen option buttons (`EventFactory`) and the image indices of their labels
 * (`IntegerPropertyFactory`), over the play options they change. Each choice list follows beatoraja's own numbering,
 * so its index is the label's image index.
 */
const CYCLE_BUTTONS: Readonly<Record<number, { key: keyof PlayOptions; choices: readonly unknown[] }>> = {
  /** `notesdisplaytimingautoadjust`: off, or beatoraja's calibration (LR2's modes read as off). */
  75: { key: 'judgeTimingAutoAdjust', choices: ['OFF', 'BEATORAJA'] },
  /** `gaugeautoshift`: NONE, CONTINUE, SURVIVAL TO GROOVE, BEST CLEAR, SELECT TO UNDER. */
  78: { key: 'gaugeAutoShift', choices: ['NONE', 'CONTINUE', 'SURVIVAL_TO_GROOVE', 'BEST_CLEAR', 'SELECT_TO_UNDER'] },
  /** `lnmode`: the mode of a chart that leaves its long notes undefined. */
  308: { key: 'longNoteMode', choices: ['LN', 'CN', 'HCN'] },
  /** `judgealgorithm`: `JudgeAlgorithm.defaultAlgorithm`. */
  340: { key: 'judgeAlgorithm', choices: ['combo', 'duration', 'lowest'] },
  /** `bottomshiftablegauge`. */
  341: { key: 'bottomShiftableGauge', choices: ['ASSIST-EASY', 'EASY', 'GROOVE'] },
  /** `minemode`: OFF, then `MineNoteModifier.Mode`. */
  351: { key: 'mineModifier', choices: ['OFF', 'REMOVE', 'ADD_RANDOM', 'ADD_NEAR', 'ADD_BLANK'] },
  /** `scrollmode`: OFF, then `ScrollSpeedModifier.Mode`. */
  352: { key: 'scrollModifier', choices: ['OFF', 'REMOVE', 'ADD'] },
  /** `longnotemode`: OFF, then `LongNoteModifier.Mode` (AC LEGACY NOTE is no beatoraja mode). */
  353: { key: 'longNoteModifier', choices: ['OFF', 'REMOVE', 'ADD_LN', 'ADD_CN', 'ADD_HCN', 'ADD_ALL'] },
  /** `seventonine_pattern`. */
  360: { key: 'sevenToNinePattern', choices: [0, 1, 2, 3, 4, 5, 6] },
  /** `seventonine_type`. */
  361: { key: 'sevenToNineType', choices: [0, 1, 2] },
};

/** beatoraja's `optiondp` (54) steps `doubleoption`: OFF, FLIP, BATTLE, BATTLE AS. */
const DOUBLE_OPTION_BUTTON = 54;
/** beatoraja's `extranotedepth` (350) steps the depth through 0-3, though the config holds up to 100. */
const EXTRA_NOTE_DEPTH_BUTTON = 350;

/**
 * beatoraja's `option1p` (42) and `option2p` (43) step the 1P / 2P lane option through ten slots, which name the
 * `Random.OPTION_GENERAL` options outside PMS and the `Random.OPTION_PMS` ones in PMS (where S-RANDOM is beatoraja's
 * `S_RANDOM_NO_THRESHOLD`). The slot is the label's image index. The buttons step beatoraja's own RANDOM, S-RANDOM and
 * CONVERGE, and another source's reads as the slot of its bare name (ADR 0019).
 */
const RANDOM_BUTTONS: Readonly<Record<number, 'random1P' | 'random2P'>> = { 42: 'random1P', 43: 'random2P' };

const RANDOM_OPTIONS: readonly RandomMode[] = [
  'OFF',
  'MIRROR',
  'beatoraja:RANDOM',
  'R-RANDOM',
  'beatoraja:S-RANDOM',
  'SPIRAL',
  'H-RANDOM',
  'ALL-SCR',
  'RANDOM-EX',
  'S-RANDOM-EX',
];

const PMS_RANDOM_OPTIONS: readonly RandomMode[] = [
  'OFF',
  'MIRROR',
  'beatoraja:RANDOM',
  'R-RANDOM',
  'beatoraja:S-RANDOM',
  'SPIRAL',
  'H-RANDOM',
  'beatoraja:CONVERGE',
  'RANDOM_PLAYABLE',
  'S_RANDOM_PLAYABLE',
];

/**
 * The slot of a lane option. The two lists share their first seven slots and name different options in the rest, so a
 * choice made for one play mode keeps its slot; an option beatoraja does not offer (SCATTER, …) reads as slot 0, as
 * beatoraja reads a slot out of range as OFF.
 */
function randomSlot(mode: RandomMode | undefined): number {
  const name = optionValueName(mode ?? 'OFF');
  const slot = RANDOM_OPTIONS.findIndex((option) => optionValueName(option) === name);
  return slot >= 0
    ? slot
    : Math.max(
        0,
        PMS_RANDOM_OPTIONS.findIndex((option) => optionValueName(option) === name),
      );
}

/** The play mode an option button steps the lane options for: PMS, or any other mode. */
export interface BeatorajaOptionButtonMode {
  /** The focused chart is PMS (9 keys), whose lane options are beatoraja's `Random.OPTION_PMS`. */
  readonly pms?: boolean;
}

type DoubleOptions = Pick<PlayOptions, 'battleMode' | 'dpFlip'>;

const DOUBLE_OPTIONS: readonly DoubleOptions[] = [
  { battleMode: 'OFF', dpFlip: false },
  { battleMode: 'OFF', dpFlip: true },
  { battleMode: 'beatoraja:BATTLE', dpFlip: false },
  { battleMode: 'BATTLE-AS', dpFlip: false },
];

/** The `doubleoption` slot: any source's one-player BATTLE reads as beatoraja's BATTLE (ADR 0019). */
function doubleOptionIndex(options: Partial<DoubleOptions>): number {
  if (options.battleMode !== undefined && optionValueName(options.battleMode) === 'BATTLE') return 2;
  if (options.battleMode === 'BATTLE-AS') return 3;
  return options.dpFlip === true ? 1 : 0;
}

/**
 * The image index of a beatoraja option button's label for the play options: the lane options (42 / 43), `doubleoption`
 * (54), the depth (350) and the {@link CYCLE_BUTTONS}. `undefined` for any other ref.
 */
export function resolveBeatorajaPlayOptionIndex(ref: number, options: Partial<PlayOptions>): number | undefined {
  const random = RANDOM_BUTTONS[ref];
  if (random !== undefined) return randomSlot(options[random]);
  if (ref === DOUBLE_OPTION_BUTTON) return doubleOptionIndex(options);
  if (ref === EXTRA_NOTE_DEPTH_BUTTON) return options.extraNoteDepth ?? 0;
  const button = CYCLE_BUTTONS[ref];
  if (button === undefined) return undefined;
  return Math.max(0, button.choices.indexOf(options[button.key] ?? button.choices[0]));
}

/**
 * The play options a click on a beatoraja option button sets (`back`: Shift held, stepping back), as beatoraja's
 * select screen steps them; `undefined` for a button that sets none. The lane option buttons (42 / 43) step through the
 * options of the play mode `mode` names, from the current option's slot.
 */
export function resolveBeatorajaOptionButton(
  act: number,
  options: Partial<PlayOptions>,
  back: boolean,
  mode: BeatorajaOptionButtonMode = {},
): Partial<PlayOptions> | undefined {
  const step = back ? -1 : 1;
  const random = RANDOM_BUTTONS[act];
  if (random !== undefined) {
    const choices = mode.pms === true ? PMS_RANDOM_OPTIONS : RANDOM_OPTIONS;
    return { [random]: choices[(randomSlot(options[random]) + step + choices.length) % choices.length]! };
  }
  if (act === DOUBLE_OPTION_BUTTON) {
    return { ...nextChoice(DOUBLE_OPTIONS, DOUBLE_OPTIONS[doubleOptionIndex(options)]!, step) };
  }
  if (act === EXTRA_NOTE_DEPTH_BUTTON) return { extraNoteDepth: ((options.extraNoteDepth ?? 0) + (back ? 3 : 1)) % 4 };
  const button = CYCLE_BUTTONS[act];
  if (button === undefined) return undefined;
  return { [button.key]: nextChoice(button.choices, options[button.key] ?? button.choices[0], step) };
}
