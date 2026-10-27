import type { PlayOptions } from '@be-music/player-scene-model';
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
    expect(resolveBeatorajaOptionButton(75, { judgeTimingAutoAdjust: 'OFF' }, false)).toEqual({
      judgeTimingAutoAdjust: 'BEATORAJA',
    });
    // beatoraja's switch reads LR2's modes as off, and turns them off.
    expect(resolveBeatorajaPlayOptionIndex(75, { judgeTimingAutoAdjust: 'LR2-SILENT' })).toBe(0);
    expect(resolveBeatorajaOptionButton(75, { judgeTimingAutoAdjust: 'LR2-ON' }, false)).toEqual({
      judgeTimingAutoAdjust: 'OFF',
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

  test('option1p / option2p (42 / 43) step the lane options in beatoraja Random.OPTION_GENERAL order outside PMS', () => {
    const order = [
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
    ];
    for (const [act, key] of [
      [42, 'random1P'],
      [43, 'random2P'],
    ] as const) {
      const seen: unknown[] = [];
      let options: Partial<PlayOptions> = {};
      for (let i = 0; i < order.length; i += 1) {
        options = resolveBeatorajaOptionButton(act, options, false)!;
        seen.push(options[key]);
      }
      expect(seen).toEqual([...order.slice(1), 'OFF']);
      expect(resolveBeatorajaOptionButton(act, { [key]: 'OFF' }, true)).toEqual({ [key]: 'S-RANDOM-EX' });
      expect(resolveBeatorajaOptionButton(act, { [key]: 'S-RANDOM-EX' }, false, { pms: false })).toEqual({
        [key]: 'OFF',
      });
    }
  });

  test('option1p / option2p (42 / 43) step the lane options in beatoraja Random.OPTION_PMS order in PMS', () => {
    const order = [
      'OFF',
      'MIRROR',
      'RANDOM',
      'R-RANDOM',
      'S-RANDOM',
      'SPIRAL',
      'H-RANDOM',
      'CONVERGE',
      'RANDOM_PLAYABLE',
      'S_RANDOM_PLAYABLE',
    ];
    const seen: unknown[] = [];
    let options: Partial<PlayOptions> = { random2P: 'OFF' };
    for (let i = 0; i < order.length; i += 1) {
      options = resolveBeatorajaOptionButton(43, options, false, { pms: true })!;
      seen.push(options.random2P);
    }
    expect(seen).toEqual([...order.slice(1), 'OFF']);
    expect(resolveBeatorajaOptionButton(42, { random1P: 'OFF' }, true, { pms: true })).toEqual({
      random1P: 'S_RANDOM_PLAYABLE',
    });
  });

  test('a lane option of the other play mode steps on from its slot, as beatoraja keeps the slot', () => {
    // ALL-SCR and CONVERGE share slot 7.
    expect(resolveBeatorajaOptionButton(42, { random1P: 'ALL-SCR' }, false, { pms: true })).toEqual({
      random1P: 'RANDOM_PLAYABLE',
    });
    expect(resolveBeatorajaOptionButton(42, { random1P: 'CONVERGE' }, true)).toEqual({ random1P: 'H-RANDOM' });
    // An option beatoraja does not offer reads as slot 0 (OFF).
    expect(resolveBeatorajaOptionButton(42, { random1P: 'SCATTER' }, false)).toEqual({ random1P: 'MIRROR' });
  });

  test('the lane option labels (42 / 43) show the option slot', () => {
    expect(resolveBeatorajaPlayOptionIndex(42, {})).toBe(0);
    expect(resolveBeatorajaPlayOptionIndex(42, { random1P: 'R-RANDOM' })).toBe(3);
    expect(resolveBeatorajaPlayOptionIndex(42, { random1P: 'S-RANDOM-EX' })).toBe(9);
    expect(resolveBeatorajaPlayOptionIndex(43, { random2P: 'CONVERGE' })).toBe(7);
    expect(resolveBeatorajaPlayOptionIndex(43, { random2P: 'S_RANDOM_PLAYABLE' })).toBe(9);
    expect(resolveBeatorajaPlayOptionIndex(43, { random1P: 'MIRROR', random2P: 'SPIRAL' })).toBe(5);
    expect(resolveBeatorajaPlayOptionIndex(42, { random1P: 'SYNCHRONIZE-RANDOM' })).toBe(0);
  });
});
