import { nextChoice, type PlayOptions } from '@be-music/player-scene-model';

/**
 * beatoraja's select-screen option buttons (`EventFactory`) and the image indices of their labels
 * (`IntegerPropertyFactory`), over the play options they change. Each choice list follows beatoraja's own numbering,
 * so its index is the label's image index.
 */
const CYCLE_BUTTONS: Readonly<Record<number, { key: keyof PlayOptions; choices: readonly unknown[] }>> = {
  /** `notesdisplaytimingautoadjust`. */
  75: { key: 'judgeTimingAutoAdjust', choices: [false, true] },
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

type DoubleOptions = Pick<PlayOptions, 'battleMode' | 'dpFlip'>;

const DOUBLE_OPTIONS: readonly DoubleOptions[] = [
  { battleMode: 'OFF', dpFlip: false },
  { battleMode: 'OFF', dpFlip: true },
  { battleMode: 'BATTLE', dpFlip: false },
  { battleMode: 'BATTLE-AS', dpFlip: false },
];

function doubleOptionIndex(options: Partial<DoubleOptions>): number {
  if (options.battleMode === 'BATTLE') return 2;
  if (options.battleMode === 'BATTLE-AS') return 3;
  return options.dpFlip === true ? 1 : 0;
}

/**
 * The image index of a beatoraja option button's label for the play options: `doubleoption` (54), the depth (350) and
 * the {@link CYCLE_BUTTONS}. `undefined` for any other ref.
 */
export function resolveBeatorajaPlayOptionIndex(ref: number, options: Partial<PlayOptions>): number | undefined {
  if (ref === DOUBLE_OPTION_BUTTON) return doubleOptionIndex(options);
  if (ref === EXTRA_NOTE_DEPTH_BUTTON) return options.extraNoteDepth ?? 0;
  const button = CYCLE_BUTTONS[ref];
  if (button === undefined) return undefined;
  return Math.max(0, button.choices.indexOf(options[button.key] ?? button.choices[0]));
}

/**
 * The play options a click on a beatoraja option button sets (`back`: Shift held, stepping back), as beatoraja's
 * select screen steps them; `undefined` for a button that sets none.
 */
export function resolveBeatorajaOptionButton(
  act: number,
  options: Partial<PlayOptions>,
  back: boolean,
): Partial<PlayOptions> | undefined {
  const step = back ? -1 : 1;
  if (act === DOUBLE_OPTION_BUTTON) {
    return { ...nextChoice(DOUBLE_OPTIONS, DOUBLE_OPTIONS[doubleOptionIndex(options)]!, step) };
  }
  if (act === EXTRA_NOTE_DEPTH_BUTTON) return { extraNoteDepth: ((options.extraNoteDepth ?? 0) + (back ? 3 : 1)) % 4 };
  const button = CYCLE_BUTTONS[act];
  if (button === undefined) return undefined;
  return { [button.key]: nextChoice(button.choices, options[button.key] ?? button.choices[0], step) };
}
