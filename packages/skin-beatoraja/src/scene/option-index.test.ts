import { describe, expect, test } from 'vite-plus/test';
import { BEATORAJA_BUTTON, BEATORAJA_NUM } from '../runtime-ids.ts';
import { beatorajaClearLampOp } from './clear-lamp.ts';
import { resolveBeatorajaOptionIndex } from './option-index.ts';

describe('beatoraja image-index properties', () => {
  test('uses zero-based LN indices without changing authored mode numbering', () => {
    for (const [lnMode, index] of [
      [1, 0],
      [2, 1],
      [3, 2],
      [0, 0],
      [99, 0],
    ]) {
      expect(resolveBeatorajaOptionIndex(BEATORAJA_BUTTON.LNMODE, { lnMode })).toBe(index);
    }
    expect(resolveBeatorajaOptionIndex(BEATORAJA_BUTTON.LNMODE, {})).toBe(0);
    // A chart without its own mode shows the player's LN MODE.
    expect(resolveBeatorajaOptionIndex(BEATORAJA_BUTTON.LNMODE, { longNoteMode: 'HCN' })).toBe(2);
    expect(resolveBeatorajaOptionIndex(BEATORAJA_BUTTON.LNMODE, { lnMode: 2, longNoteMode: 'HCN' })).toBe(1);
  });
  test('translates the selected HS reference to beatoraja indices', () => {
    for (const [hsFix, index] of [
      ['OFF', 0],
      ['STARTBPM', 1],
      ['MAXBPM', 2],
      ['MINBPM', 4],
      ['AVERAGE', 3],
      ['CONSTANT', 3],
    ] as const) {
      expect(resolveBeatorajaOptionIndex(BEATORAJA_BUTTON.HSFIX, { hsFix })).toBe(index);
    }
  });
  test('maps every supported clear lamp and lamp op to the external clear index', () => {
    for (const [lamp, index] of [
      ['NO_PLAY', 0],
      ['FAILED', 1],
      ['ASSIST_EASY', 3],
      ['EASY', 4],
      ['NORMAL', 5],
      ['HARD', 6],
      ['EX_HARD', 7],
      ['FULL_COMBO', 8],
      ['PERFECT', 9],
      ['MAX', 10],
    ] as const) {
      expect(resolveBeatorajaOptionIndex(BEATORAJA_NUM.CLEAR, { lamp })).toBe(index);
      expect(resolveBeatorajaOptionIndex(BEATORAJA_NUM.CLEAR, { lampOp: beatorajaClearLampOp(lamp) })).toBe(index);
    }
    expect(resolveBeatorajaOptionIndex(BEATORAJA_NUM.CLEAR, {})).toBe(0);
    expect(resolveBeatorajaOptionIndex(BEATORAJA_NUM.CLEAR, { lampOp: -1 })).toBe(0);
  });
  test('leaves unrelated image refs to their family resolver', () => {
    expect(resolveBeatorajaOptionIndex(BEATORAJA_BUTTON.MODE, {})).toBeUndefined();
    expect(resolveBeatorajaOptionIndex(500, {})).toBeUndefined();
  });
});
