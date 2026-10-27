import type { ClearLamp } from '@be-music/player-engine/ruleset';
import type { PlayOptions } from '@be-music/player-scene-model';
import { BEATORAJA_BUTTON, BEATORAJA_NUM } from '../runtime-ids.ts';
import { beatorajaClearLampOp } from './clear-lamp.ts';

const CLEAR_INDICES: Readonly<Record<ClearLamp, number>> = {
  NO_PLAY: 0,
  FAILED: 1,
  ASSIST_EASY: 3,
  EASY: 4,
  NORMAL: 5,
  HARD: 6,
  EX_HARD: 7,
  FULL_COMBO: 8,
  PERFECT: 9,
  MAX: 10,
};
const LAMP_OP_INDICES = new Map(
  Object.entries(CLEAR_INDICES).map(([lamp, index]) => [beatorajaClearLampOp(lamp as ClearLamp), index]),
);
const HS_FIX_INDICES: Readonly<Record<PlayOptions['hsFix'], number>> = {
  OFF: 0,
  STARTBPM: 1,
  MAXBPM: 2,
  MINBPM: 4,
  AVERAGE: 3,
  CONSTANT: 3,
};

const LONG_NOTE_MODE_INDICES: Readonly<Record<PlayOptions['longNoteMode'], number>> = { LN: 0, CN: 1, HCN: 2 };

/** The option and record facts shared by image refs and Lua `event_index`. */
export interface BeatorajaOptionIndexInput {
  /** The long-note mode the chart names itself (`#LNMODE`, bmson `ln_type`), numbered from 1. */
  readonly lnMode?: number;
  /** The player's LN MODE, which the LNMODE image shows for a chart without its own mode, and on the select screen. */
  readonly longNoteMode?: PlayOptions['longNoteMode'];
  readonly hsFix?: PlayOptions['hsFix'];
  readonly lamp?: ClearLamp;
  /** The selected record's lamp op when the host already resolved the lamp into an op. */
  readonly lampOp?: number;
}

/**
 * Image-index properties, distinct from ordinary number properties. The LNMODE image (308) is the chart's own mode on
 * the screens that pass one (beatoraja's play and result), else the player's LN MODE. Unsupported refs return `undefined` for a
 * family's existing MODE, SORT or lane-judge resolver. The browser's AVERAGE option uses main BPM (index 3);
 * CONSTANT currently uses that same effective reference, as it does in playback.
 */
export function resolveBeatorajaOptionIndex(ref: number, input: BeatorajaOptionIndexInput): number | undefined {
  switch (ref) {
    case BEATORAJA_BUTTON.LNMODE:
      if (input.lnMode !== undefined) return input.lnMode === 2 ? 1 : input.lnMode === 3 ? 2 : 0;
      return LONG_NOTE_MODE_INDICES[input.longNoteMode ?? 'LN'] ?? 0;
    case BEATORAJA_BUTTON.HSFIX:
      return HS_FIX_INDICES[input.hsFix ?? 'OFF'] ?? 0;
    case BEATORAJA_NUM.CLEAR:
      return input.lamp !== undefined
        ? (CLEAR_INDICES[input.lamp] ?? 0)
        : (LAMP_OP_INDICES.get(input.lampOp ?? -1) ?? 0);
    default:
      return undefined;
  }
}
