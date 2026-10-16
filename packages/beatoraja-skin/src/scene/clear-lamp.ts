import type { ClearLamp } from '@be-music/player/ruleset';
import { BEATORAJA_OP } from '../runtime-ids.ts';

const LAMP_OPS: Readonly<Record<ClearLamp, number>> = {
  NO_PLAY: BEATORAJA_OP.CLEAR_LAMP_NOPLAY,
  FAILED: BEATORAJA_OP.CLEAR_LAMP_FAILED,
  ASSIST_EASY: BEATORAJA_OP.CLEAR_LAMP_ASSIST_EASY,
  EASY: BEATORAJA_OP.CLEAR_LAMP_EASY,
  NORMAL: BEATORAJA_OP.CLEAR_LAMP_NORMAL,
  HARD: BEATORAJA_OP.CLEAR_LAMP_HARD,
  EX_HARD: BEATORAJA_OP.CLEAR_LAMP_EXHARD,
  FULL_COMBO: BEATORAJA_OP.CLEAR_LAMP_FULLCOMBO,
  PERFECT: BEATORAJA_OP.CLEAR_LAMP_PERFECT,
  MAX: BEATORAJA_OP.CLEAR_LAMP_MAX,
};

/**
 * The beatoraja skin op (`BEATORAJA_OP.CLEAR_LAMP_*`) that shows `lamp`. The lamp itself comes from `resolveClearLamp`
 * (`@be-music/player/ruleset`), the one clear-lamp rule every family uses (the LR2 / default result, the records and
 * the beatoraja result and select), so a play gets the same lamp whichever skin shows it.
 */
export function beatorajaClearLampOp(lamp: ClearLamp): number {
  return LAMP_OPS[lamp] ?? BEATORAJA_OP.CLEAR_LAMP_NOPLAY;
}
