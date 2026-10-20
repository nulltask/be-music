import type { ClearLamp } from '@be-music/player-engine/ruleset';
import { LR2_BAR_LAMP_KINDS, LR2_OP } from '../ids/index.ts';
import type { LR2BarLampKind } from '../skin.ts';

/** LR2's six clear lamps (`#SRC_BAR_LAMP` kinds, ops 100-105) for each of be-music's lamps. */
const LR2_LAMP_KINDS: Readonly<Record<ClearLamp, LR2BarLampKind>> = {
  NO_PLAY: 'noplay',
  FAILED: 'failed',
  ASSIST_EASY: 'easy',
  EASY: 'easy',
  NORMAL: 'clear',
  HARD: 'hard',
  EX_HARD: 'hard',
  FULL_COMBO: 'fullcombo',
  PERFECT: 'fullcombo',
  MAX: 'fullcombo',
};

/**
 * The LR2 clear lamp of a record (`#SRC_BAR_LAMP` kind): LR2 has one lamp below NORMAL (EASY, which ASSIST EASY
 * joins), one above it (HARD, which EX HARD joins) and FULL COMBO for PERFECT and MAX too. No record reads `noplay`.
 */
export function resolveLR2BarLamp(lamp: ClearLamp | undefined): LR2BarLampKind {
  return lamp === undefined ? 'noplay' : LR2_LAMP_KINDS[lamp];
}

/** LR2's clear-lamp op (100 NO PLAY … 105 FULL COMBO) for a record's lamp, in the bar-lamp order. */
export function resolveLR2LampOp(lamp: ClearLamp | undefined): number {
  return LR2_OP.LAMP_NO_PLAY + LR2_BAR_LAMP_KINDS.indexOf(resolveLR2BarLamp(lamp));
}
