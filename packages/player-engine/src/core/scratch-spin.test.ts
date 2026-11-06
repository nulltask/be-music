import { describe, expect, test } from 'vite-plus/test';
import { createLaneBindings } from './lane-layout.ts';
import { createScratchSpinByToken, isScratchSpin, resolvePressSpin, resolveScratchSpin } from './scratch-spin.ts';

describe('scratch spin', () => {
  test('isScratchSpin accepts the two directions only', () => {
    expect(isScratchSpin('cw')).toBe(true);
    expect(isScratchSpin('ccw')).toBe(true);
    expect(isScratchSpin('up')).toBe(false);
    expect(isScratchSpin(undefined)).toBe(false);
  });

  test('odd-even: a scratch lane’s keys alternate, and key aliases share their key’s spin', () => {
    const spins = createScratchSpinByToken([
      { isScratch: true, inputKeys: [['Shift-Left'], ['ctrl-left', 'control-left'], ['a']] },
      { isScratch: false, inputKeys: [['z'], ['x']] },
      { isScratch: true },
    ]);
    expect(Object.fromEntries(spins)).toEqual({
      'shift-left': 'cw',
      'ctrl-left': 'ccw',
      'control-left': 'ccw',
      a: 'cw',
    });
  });

  test('a press takes the spin of its first scratch token', () => {
    const spins = new Map([
      ['shift-left', 'cw' as const],
      ['ctrl-left', 'ccw' as const],
    ]);
    expect(resolveScratchSpin(['ctrl-left', 'ctrl'], spins)).toBe('ccw');
    expect(resolveScratchSpin(['SHIFT-LEFT', 'shift'], spins)).toBe('cw');
    expect(resolveScratchSpin(['z'], spins)).toBeUndefined();
  });

  test('a lane-input press takes its reported spin, none for null, else its keys’ spin', () => {
    const spins = new Map([['shift-left', 'cw' as const]]);
    expect(resolvePressSpin('ccw', ['shift-left'], spins)).toBe('ccw');
    expect(resolvePressSpin(null, ['shift-left'], spins)).toBeUndefined();
    expect(resolvePressSpin(undefined, ['shift-left'], spins)).toBe('cw');
    expect(resolvePressSpin(undefined, ['z'], spins)).toBeUndefined();
  });

  test.each([
    ['linux', ['ctrl-left', 'control-left', 'space'], ['ctrl-right', 'control-right']],
    ['darwin', ['option-left', 'alt-left', 'space'], ['option-right', 'alt-right']],
  ] as const)(
    'the default keys of each scratch are Shift (cw) and a second key (ccw) on %s',
    (platform, left, right) => {
      const bindings = createLaneBindings(['11', '16', '21', '26'], { platform, playVariant: '14' });
      const scratch1P = bindings.find((binding) => binding.channel === '16')!;
      expect(scratch1P.inputKeys).toEqual([['shift-left'], left]);
      expect(bindings.find((binding) => binding.channel === '26')!.inputKeys).toEqual([['shift-right'], right]);
      expect(bindings.find((binding) => binding.channel === '11')!.inputKeys).toBeUndefined();
      const spins = createScratchSpinByToken(bindings);
      expect(spins.get('shift-left')).toBe('cw');
      expect(spins.get(left[0])).toBe('ccw');
      // Space turns the 1P turntable down with the second key, as LR2's default key config has it.
      expect(spins.get('space')).toBe('ccw');
      expect(spins.get(right[1])).toBe('ccw');
      expect(spins.has('z')).toBe(false);
    },
  );
});
