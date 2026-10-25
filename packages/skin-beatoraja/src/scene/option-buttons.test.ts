import { describe, expect, test } from 'vite-plus/test';
import { resolveBeatorajaOptionButton, resolveBeatorajaPlayOptionIndex } from './option-buttons.ts';

describe('beatoraja option buttons', () => {
  test('optiondp (54) steps OFF, FLIP, BATTLE and BATTLE AS, Shift stepping back', () => {
    expect(resolveBeatorajaOptionButton(54, { battleMode: 'OFF', dpFlip: false }, false)).toEqual({
      battleMode: 'OFF',
      dpFlip: true,
    });
    expect(resolveBeatorajaOptionButton(54, { battleMode: 'OFF', dpFlip: true }, false)).toEqual({
      battleMode: 'BATTLE',
      dpFlip: false,
    });
    expect(resolveBeatorajaOptionButton(54, { battleMode: 'BATTLE-AS' }, false)).toEqual({
      battleMode: 'OFF',
      dpFlip: false,
    });
    expect(resolveBeatorajaOptionButton(54, { battleMode: 'OFF' }, true)).toEqual({
      battleMode: 'BATTLE-AS',
      dpFlip: false,
    });
    expect(resolveBeatorajaPlayOptionIndex(54, { battleMode: 'BATTLE' })).toBe(2);
    expect(resolveBeatorajaPlayOptionIndex(54, { dpFlip: true })).toBe(1);
    // An LR2 battle mode is no doubleoption.
    expect(resolveBeatorajaPlayOptionIndex(54, { battleMode: 'TWO-PLAYER' })).toBe(0);
  });

  test('extranotedepth (350) steps 0-3 modulo 4, as beatoraja does over its 0-100 config', () => {
    expect(resolveBeatorajaOptionButton(350, { extraNoteDepth: 3 }, false)).toEqual({ extraNoteDepth: 0 });
    expect(resolveBeatorajaOptionButton(350, { extraNoteDepth: 0 }, true)).toEqual({ extraNoteDepth: 3 });
    expect(resolveBeatorajaOptionButton(350, { extraNoteDepth: 50 }, false)).toEqual({ extraNoteDepth: 3 });
    expect(resolveBeatorajaPlayOptionIndex(350, { extraNoteDepth: 2 })).toBe(2);
  });

  test('steps each option in beatoraja’s numbering, which its label image follows', () => {
    expect(resolveBeatorajaOptionButton(308, { longNoteMode: 'HCN' }, false)).toEqual({ longNoteMode: 'LN' });
    expect(resolveBeatorajaOptionButton(75, { judgeTimingAutoAdjust: false }, false)).toEqual({
      judgeTimingAutoAdjust: true,
    });
    expect(resolveBeatorajaOptionButton(78, { gaugeAutoShift: 'NONE' }, true)).toEqual({
      gaugeAutoShift: 'SELECT_TO_UNDER',
    });
    expect(resolveBeatorajaOptionButton(353, { longNoteModifier: 'OFF' }, false)).toEqual({
      longNoteModifier: 'REMOVE',
    });
    expect(resolveBeatorajaOptionButton(361, {}, false)).toEqual({ sevenToNineType: 1 });
    expect(resolveBeatorajaPlayOptionIndex(340, { judgeAlgorithm: 'lowest' })).toBe(2);
    expect(resolveBeatorajaPlayOptionIndex(341, { bottomShiftableGauge: 'GROOVE' })).toBe(2);
    expect(resolveBeatorajaPlayOptionIndex(351, { mineModifier: 'ADD_BLANK' })).toBe(4);
    expect(resolveBeatorajaPlayOptionIndex(352, {})).toBe(0);
    expect(resolveBeatorajaPlayOptionIndex(360, { sevenToNinePattern: 6 })).toBe(6);
    // AC LEGACY NOTE has no beatoraja index.
    expect(resolveBeatorajaPlayOptionIndex(353, { longNoteModifier: 'LEGACY' })).toBe(0);
    expect(resolveBeatorajaOptionButton(315, {}, false)).toBeUndefined();
    expect(resolveBeatorajaPlayOptionIndex(315, {})).toBeUndefined();
  });
});
